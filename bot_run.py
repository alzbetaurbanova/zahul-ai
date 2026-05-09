import asyncio
import time
import re
import discord

from discord import app_commands
import traceback
from typing import Optional
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

SK_TZ = ZoneInfo("Europe/Bratislava")

# --- Scheduler runtime state ---
_last_schedule_fire: dict = {}  # task_id -> "YYYY-MM-DD" of last fire




def _resolve_history_limit(task: dict, char_data: dict, effective_config) -> int:
    """Priority: task > character > server override > global config."""
    if task.get('history_limit') is not None:
        return task['history_limit']
    if char_data.get('history_limit') is not None:
        return char_data['history_limit']
    return effective_config.history_limit

# --- Autocap runtime state ---
_autocap_unlimited: bool = False           # True = no cap, ignores DB value
_autocap_previous: Optional[int] = None   # last manually set value (restored by /autocap on)
_autocap_revert_task: Optional[asyncio.Task] = None

from api.db.database import Database
from api.models.models import BotConfig
from src.models.dimension import ActiveChannel
import src.controller.observer as observer
import src.controller.pipeline as pipeline
from src.plugins.manager import PluginManager

# --- Helper to load config from DB ---
def get_bot_config(db: Database) -> BotConfig:
    """Fetches all config key-values from the DB and returns a BotConfig object."""
    return BotConfig(**db.list_configs())


class Zahul(discord.Client):
    def __init__(self, *, intents: discord.Intents):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.db = Database()
        self.config = get_bot_config(self.db)
        self.queue = asyncio.Queue()
        self.plugin_manager = PluginManager(plugin_package_path="src.plugins")
        self.auto_reply_count = 0
        self._panel_dm_runner_started = False

    async def setup_hook(self):
        """This is called when the bot is preparing to connect."""
        # --- Context Menus ---
        self.tree.add_command(app_commands.ContextMenu(
            name='Edit Bot Message',
            callback=self.edit_message_context
        ))
        self.tree.add_command(app_commands.ContextMenu(
            name='Delete Bot Message',
            callback=self.delete_message_context
        ))
        self.tree.add_command(app_commands.ContextMenu(
            name='Edit / View Caption',
            callback=self.edit_caption_context
        ))

        # --- Slash Commands ---
        # Register command groups, passing the database instance to them
        self.tree.add_command(register_channel_command(self.db))
        self.tree.add_command(unregister_channel_command(self.db))
        self.tree.add_command(WhitelistCommands(self.db))
        self.tree.add_command(FallbackGroup())
        self.tree.add_command(AutocapGroup())
        self.tree.add_command(tokens_command)
        self.tree.add_command(about_command(self.db))
        self.tree.add_command(reminder_command)
        
        # Sync commands globally. For development, you might sync to a specific guild.
        await self.tree.sync()

        self.think_task = asyncio.create_task(pipeline.think(self, self.db, self.queue, self.plugin_manager))
        self.scheduler_task = asyncio.create_task(_run_scheduler(self))

    async def on_ready(self):
        print(f"Discord Bot is logged in as {self.user} (ID: {self.user.id})")
        app_info = await self.application_info()
        self.invite_link = f"https://discord.com/oauth2/authorize?client_id={app_info.id}&permissions=533113207808&scope=bot" # Set the attribute here
        invite_link = f"https://discord.com/oauth2/authorize?client_id={app_info.id}&permissions=533113207808&scope=bot"
        print(f"Bot Invite Link: {invite_link}")
        print("Discord Bot is up and running.")
        if not self._panel_dm_runner_started:
            self._panel_dm_runner_started = True
            asyncio.create_task(self._flush_panel_dm_queue_runner())

    async def _flush_panel_dm_queue_runner(self):
        """Drain panel notification DMs: early retries after connect, then periodic while online."""
        from api.discord_panel_dm_queue import flush_discord_panel_dm_queue
        for delay_sec in (2, 15, 45):
            await asyncio.sleep(delay_sec)
            try:
                await flush_discord_panel_dm_queue(self)
            except Exception as e:
                print(f"Panel DM queue flush failed (delay={delay_sec}s): {e}")
                traceback.print_exc()
        while True:
            await asyncio.sleep(120)
            try:
                if self.is_ready():
                    await flush_discord_panel_dm_queue(self)
            except Exception as e:
                print(f"Panel DM periodic flush failed: {e}")
                traceback.print_exc()

    async def on_message(self, message: discord.Message):
        # We pass the bot instance (self) and db instance (self.db) to the observer
        await observer.bot_behavior(message, self)

    # --- Context Menu Callbacks ---
    async def edit_message_context(self, interaction: discord.Interaction, message: discord.Message):
        if not message.webhook_id and message.author != self.user:
            await interaction.response.send_message("This is not a bot's message.", ephemeral=True)
            return
        await interaction.response.send_modal(EditMessageModal(message))

    async def delete_message_context(self, interaction: discord.Interaction, message: discord.Message):
        if not message.webhook_id and message.author != self.user:
            await interaction.response.send_message("This is not a bot's message.", ephemeral=True)
            return

        try:
            if isinstance(interaction.channel, discord.DMChannel):
                await message.delete()
            else:
                webhook = await self.fetch_webhook(message.webhook_id)
                
                # Setup keyword arguments
                kwargs = {}
                if isinstance(interaction.channel, discord.Thread):
                    kwargs['thread'] = interaction.channel
                
                # Only pass 'thread' if it exists in kwargs
                await webhook.delete_message(message.id, **kwargs)
            
            await interaction.response.send_message("Message deleted.", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"Failed to delete message: {e}", ephemeral=True)
            # It is good practice to import traceback if you use it
            import traceback
            print(traceback.format_exc())

    async def edit_caption_context(self, interaction: discord.Interaction, message: discord.Message):
        # Pass the database instance to the modal
        await interaction.response.send_modal(EditCaptionModal(message, self.db))

    def run(self, *args, **kwargs):
        """Starts the bot after fetching the token from the database."""
        try:
            token = self.config.discord_key
            if not token:
                raise ValueError("Discord key is not set in the database.")
            
            # Start background tasks
            #asyncio.create_task(pipeline.think(self.db, self.queue))
            
            # Run the bot
            super().run(token, *args, **kwargs)
        except Exception as e:
            print(f"Fatal error during bot startup: {e}")
            print("Please ensure your database is configured correctly via the API/frontend.")

# --- Modals ---
class EditMessageModal(discord.ui.Modal, title='Edit Message'):
    def __init__(self, original_message: discord.Message):
        super().__init__()
        self.original_message = original_message
        self.add_item(discord.ui.TextInput(
            label='New Content', style=discord.TextStyle.long, 
            required=True, default=self.original_message.content
        ))

    async def on_submit(self, interaction: discord.Interaction):
        new_content = self.children[0].value
        try:
            if self.original_message.webhook_id:
                webhook = await interaction.client.fetch_webhook(self.original_message.webhook_id)
                
                # Check if the message is in a thread
                if isinstance(self.original_message.channel, discord.Thread):
                    await webhook.edit_message(
                        self.original_message.id, 
                        content=new_content, 
                        thread=self.original_message.channel
                    )
                else:
                    # Regular channel - don't pass thread parameter
                    await webhook.edit_message(
                        self.original_message.id, 
                        content=new_content
                    )
            else:  # It's a DM or a message sent without a webhook
                await self.original_message.edit(content=new_content)
            
            await interaction.response.send_message("Message edited successfully!", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"An error occurred: {e}", ephemeral=True)
            print(traceback.format_exc())

class EditCaptionModal(discord.ui.Modal, title='Edit Image Caption'):
    def __init__(self, original_message: discord.Message, db: Database):
        super().__init__()
        self.original_message = original_message
        self.db = db
        existing_caption = self.db.get_caption(str(self.original_message.id))
        self.add_item(discord.ui.TextInput(
            label='Image Caption', style=discord.TextStyle.long,
            placeholder='Enter a description for the image...',
            required=False, default=existing_caption
        ))

    async def on_submit(self, interaction: discord.Interaction):
        new_caption = self.children[0].value.strip()
        message_id_str = str(self.original_message.id)
        try:
            if new_caption:
                self.db.set_caption(message_id_str, new_caption)
                await interaction.response.send_message("Caption updated!", ephemeral=True)
            else:
                self.db.delete_caption(message_id_str)
                await interaction.response.send_message("Caption removed!", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"An error occurred: {e}", ephemeral=True)

# --- Standalone Commands ---
def about_command(db: Database):
    @app_commands.command(name="about", description="Zobrazí info o postave.")
    async def _about(interaction: discord.Interaction, meno: str):
        char = db.get_character(name=meno)
        if not char:
            await interaction.response.send_message(f"Postava **{meno}** neexistuje.", ephemeral=True)
            return
        about = char.get("data", {}).get("about", "").strip()
        if not about:
            await interaction.response.send_message(f"**{meno}** nemá žiadne info.", ephemeral=True)
            return
        await interaction.response.send_message(f"**{meno}**\n{about}", ephemeral=True)
    return _about


@app_commands.command(name="tokens", description="Zobrazí využitie tokenov.")
async def tokens_command(interaction: discord.Interaction):
    from src.utils.llm_new import get_tokens_used_last_minute, get_daily_tokens_used, get_fallback_info
    bot: Zahul = interaction.client
    cfg = get_bot_config(bot.db)
    tpm_used = get_tokens_used_last_minute()
    tpd_used, tpd_limit = get_daily_tokens_used(limit=cfg.token_limit_tpd)
    info = get_fallback_info()
    primary = cfg.base_llm
    fallback = cfg.fallback_llm
    model_line = f"🤖 Model: **{primary}** (primary)" if info is None else f"🤖 Model: **{fallback}** (fallback) — primary o **{info[0]}**"
    msg = (
        f"{model_line}\n"
        f"📊 **Tokeny za poslednú minútu:** {tpm_used}/{cfg.token_limit_tpm}\n"
        f"📅 **Tokeny dnes:** {tpd_used}/{tpd_limit} (zostatok: {max(0, tpd_limit - tpd_used)})"
    )
    await interaction.response.send_message(msg, ephemeral=True)


class FallbackGroup(app_commands.Group):
    def __init__(self):
        super().__init__(name="fallback", description="Správa fallback modelu")

    @app_commands.command(name="status", description="Zobrazí stav fallback modelu.")
    async def status(self, interaction: discord.Interaction):
        from src.utils.llm_new import get_fallback_info, get_fallback_tokens_used
        info = get_fallback_info()
        if info is None:
            await interaction.response.send_message("✅ Primary model aktívny, do fallbacku si ešte nespadla.", ephemeral=True)
        else:
            back_at, remaining = info
            fb_tokens = get_fallback_tokens_used()
            await interaction.response.send_message(
                f"⚠️ **Fallback aktívny**\n"
                f"Primary späť o **{back_at}** (za ~{remaining} min)\n"
                f"Tokeny spotrebované počas fallbacku: **{fb_tokens}**",
                ephemeral=True
            )

    @app_commands.command(name="on", description="Manuálne zapne fallback model.")
    async def on(self, interaction: discord.Interaction):
        import src.utils.llm_new as llm
        if llm._fallback_active:
            await interaction.response.send_message("⚠️ Fallback už beží.", ephemeral=True)
            return
        llm._fallback_active = True
        llm._fallback_end = time.time() + llm.FALLBACK_DURATION
        llm._save_fallback_state(llm._fallback_end)
        from datetime import datetime
        back_at = datetime.fromtimestamp(llm._fallback_end).strftime("%H:%M")
        await interaction.response.send_message(f"✅ Fallback manuálne zapnutý do **{back_at}**.", ephemeral=True)

    @app_commands.command(name="off", description="Manuálne vypne fallback model.")
    async def off(self, interaction: discord.Interaction):
        import src.utils.llm_new as llm
        if not llm._fallback_active:
            await interaction.response.send_message("✅ Fallback nie je aktívny.", ephemeral=True)
            return
        llm._fallback_active = False
        llm._clear_fallback_state()
        llm.reset_fallback_tokens()
        await interaction.response.send_message("✅ Fallback vypnutý, prepínam na primary.", ephemeral=True)


class AutocapGroup(app_commands.Group):
    def __init__(self):
        super().__init__(name="autocap", description="Chain limit — controls how many times the bot reacts to another bot's message")

    @app_commands.command(name="set", description="Set the bot-to-bot chain limit.")
    @app_commands.describe(value="Number of bot-to-bot replies allowed in a chain")
    async def set_cap(self, interaction: discord.Interaction, value: int):
        global _autocap_unlimited, _autocap_previous, _autocap_revert_task
        if value < 0:
            await interaction.response.send_message("❌ Value must be 0 or higher.", ephemeral=True)
            return
        if _autocap_revert_task and not _autocap_revert_task.done():
            _autocap_revert_task.cancel()
            _autocap_revert_task = None
        _autocap_unlimited = False
        _autocap_previous = value
        bot: Zahul = interaction.client
        bot.db.set_config("auto_cap", value)
        await interaction.response.send_message(f"✅ Chain limit set to **{value}**.", ephemeral=True)

    @app_commands.command(name="off", description="Disable the chain limit (unlimited). Auto-reverts after given hours.")
    @app_commands.describe(hours="Hours until auto-revert to previous value (default: 2)")
    async def off(self, interaction: discord.Interaction, hours: Optional[float] = 2.0):
        global _autocap_unlimited, _autocap_previous, _autocap_revert_task
        bot: Zahul = interaction.client
        if _autocap_revert_task and not _autocap_revert_task.done():
            _autocap_revert_task.cancel()

        if _autocap_previous is None:
            _autocap_previous = get_bot_config(bot.db).auto_cap

        _autocap_unlimited = True

        async def _revert():
            global _autocap_unlimited
            await asyncio.sleep(hours * 3600)
            _autocap_unlimited = False
            try:
                await interaction.followup.send(
                    f"⏰ Chain limit auto-reverted to **{_autocap_previous}** after {hours}h.", ephemeral=True
                )
            except Exception:
                pass

        _autocap_revert_task = asyncio.create_task(_revert())
        from datetime import datetime, timedelta
        revert_at = (datetime.now() + timedelta(hours=hours)).strftime("%H:%M")
        await interaction.response.send_message(
            f"✅ Chain limit **disabled** (unlimited).\n⏰ Auto-reverts to **{_autocap_previous}** at **{revert_at}**.",
            ephemeral=True
        )

    @app_commands.command(name="on", description="Re-enable the chain limit with the last set value.")
    async def on(self, interaction: discord.Interaction):
        global _autocap_unlimited, _autocap_revert_task
        bot: Zahul = interaction.client
        if _autocap_revert_task and not _autocap_revert_task.done():
            _autocap_revert_task.cancel()
            _autocap_revert_task = None
        _autocap_unlimited = False
        restore = _autocap_previous if _autocap_previous is not None else get_bot_config(bot.db).auto_cap
        await interaction.response.send_message(f"✅ Chain limit re-enabled at **{restore}**.", ephemeral=True)

    @app_commands.command(name="reset", description="Reset to the value configured in AI Config panel, cancel any active timer.")
    async def reset(self, interaction: discord.Interaction):
        global _autocap_unlimited, _autocap_previous, _autocap_revert_task
        bot: Zahul = interaction.client
        if _autocap_revert_task and not _autocap_revert_task.done():
            _autocap_revert_task.cancel()
            _autocap_revert_task = None
        _autocap_unlimited = False
        _autocap_previous = None
        default = get_bot_config(bot.db).auto_cap
        await interaction.response.send_message(f"✅ Chain limit reset to **{default}** (from AI Config).", ephemeral=True)

    @app_commands.command(name="status", description="Show current chain limit status.")
    async def status(self, interaction: discord.Interaction):
        bot: Zahul = interaction.client
        if _autocap_unlimited:
            revert_info = f" — reverts to **{_autocap_previous}** when `/autocap on` or timer expires" if _autocap_previous is not None else ""
            await interaction.response.send_message(f"♾️ Chain limit: **unlimited**{revert_info}", ephemeral=True)
        else:
            cap = _autocap_previous if _autocap_previous is not None else get_bot_config(bot.db).auto_cap
            await interaction.response.send_message(f"🔗 Chain limit: **{cap}** bot-to-bot replies per chain.", ephemeral=True)


# --- Scheduler ---

async def _send_scheduled_message(bot: 'Zahul', task: dict):
    """Send a message as a character for a scheduled task."""
    char = bot.db.get_character(task['character'])
    if not char:
        print(f"[Scheduler] Character '{task['character']}' not found for task {task['id']}")
        return

    char_data = char['data']
    char_name = char['name']
    bot_config = BotConfig(**bot.db.list_configs())
    avatar_url = char_data.get('avatar')
    if avatar_url and avatar_url.startswith('/') and bot_config.public_url:
        avatar_url = bot_config.public_url.rstrip('/') + avatar_url
    if avatar_url and not str(avatar_url).startswith(('http://', 'https://')):
        avatar_url = None
    instructions = (task.get('instructions') or '').strip()
    print(f"[Scheduler] sending task {task['id']} type={task.get('type')} mode={task.get('message_mode')} char={char_name} target={task.get('target_type')} id={task.get('target_id')}")

    # Resolve server_id for per-server config overrides
    _server_id = None
    if task.get('target_type') == 'channel':
        _ch = bot.db.get_channel(task['target_id'])
        if _ch:
            _server_id = _ch.get('server_id')

    from src.utils.llm_new import generate_in_character, get_effective_config
    from src.controller.history import get_history
    effective_config = get_effective_config(bot.db, _server_id)
    include_history = task.get('history_limit') is not None
    history_limit = _resolve_history_limit(task, char_data, effective_config)

    # Pre-fetch channel/DM for history injection before LLM call
    _pre_channel = None
    if include_history:
        if task.get('target_type') == 'channel':
            try:
                _pre_channel = bot.get_channel(int(task['target_id']))
                if not _pre_channel:
                    _pre_channel = await bot.fetch_channel(int(task['target_id']))
            except Exception as e:
                print(f"[Scheduler] channel prefetch failed for history: {e}")
        elif task.get('target_type') == 'dm':
            try:
                target = task['target_id']
                dm_user = None
                try:
                    dm_user = await bot.fetch_user(int(target))
                except (ValueError, discord.NotFound):
                    for guild in bot.guilds:
                        member = discord.utils.get(guild.members, name=target)
                        if member:
                            dm_user = member
                            break
                if dm_user:
                    _pre_channel = dm_user.dm_channel or await dm_user.create_dm()
            except Exception as e:
                print(f"[Scheduler] DM prefetch failed for history: {e}")

    history_str = None
    history_count = 0
    if include_history and _pre_channel:
        history_str = await get_history(_pre_channel, bot.db, limit=history_limit)
        history_count = history_str.count('[Reply]') if history_str else 0
        print(f"[Scheduler] history fetched: {history_count} replies, len={len(history_str) if history_str else 0}")

    request_messages = None
    if task.get('message_mode') == 'generate':
        if task.get('type') == 'reminder':
            prefix = f"Reminder: {instructions}\nResponse:" if instructions else "Reminder\nResponse:"
            system_addon = (
                'The assistant should speak about the reminder content in character, not merely react to it. '
                'If the reminder text describes a task or topic, mention that subject and expand on it with friendly, helpful commentary. '
                'Use the word Response: only once, and output only the response text after it.'
            )
            user = '[talk about the reminder text]'
        else:
            prefix = f"{instructions}\nResponse:" if instructions else 'Response:'
            system_addon = (
                'The assistant should follow the instruction above in character and output only the response text. '
                'Do not repeat the original input or instruction in the final message.'
            )
            user = '[follow the instruction]'
        text_suffix, input_tokens, output_tokens, model_used, request_messages, temperature = await generate_in_character(
            character_name=char_name,
            system_addon=system_addon,
            user=user,
            assistant=prefix,
            db=bot.db,
            server_id=_server_id,
            history=history_str,
        )
        if text_suffix.startswith('//[OOC:'):
            print(f"[Scheduler] generate_in_character error for task {task['id']}: {text_suffix}")
            bot.db.log_discord(
                character=char_name, channel_id=f"{task['target_type']}:{task['target_id']}",
                user='system', trigger=instructions or '', response='',
                model=model_used or '', input_tokens=input_tokens, output_tokens=output_tokens,
                conversation_history=request_messages, temperature=temperature,
                source='scheduler', status='error', error_message=text_suffix,
                history_count=history_count, task_id=task['id'],
            )
            return
        text_suffix = text_suffix.strip()
        text_suffix = re.sub(r'^(response|Response):\s*', '', text_suffix)
        if task.get('type') == 'reminder':
            text = (prefix + ' ' + text_suffix).strip()
        else:
            text = text_suffix
    else:
        input_tokens, output_tokens, model_used, temperature = 0, 0, 'exact', None
        if task.get('type') == 'reminder':
            text = f"Reminder: {instructions}" if instructions else 'Reminder'
        else:
            text = f"Schedule: {instructions}" if instructions else 'Schedule'

    if not text:
        return

    try:
        if task['target_type'] == 'channel':
            channel = bot.get_channel(int(task['target_id']))
            if not channel:
                channel = await bot.fetch_channel(int(task['target_id']))
            if not channel:
                print(f"[Scheduler] Channel {task['target_id']} not found")
                return

            parent = channel.parent if isinstance(channel, discord.Thread) else channel
            webhooks = await parent.webhooks()
            webhook = next((w for w in webhooks if w.user == bot.user), None)
            if not webhook:
                webhook = await parent.create_webhook(name='zahul-ai')

            kwargs: dict = {'content': text, 'username': char_name}
            if avatar_url:
                kwargs['avatar_url'] = avatar_url
            if isinstance(channel, discord.Thread):
                kwargs['thread'] = channel
            await webhook.send(**kwargs)

        elif task['target_type'] == 'dm':
            target = task['target_id']
            user = None
            try:
                user = await bot.fetch_user(int(target))
            except (ValueError, discord.NotFound):
                for guild in bot.guilds:
                    member = discord.utils.get(guild.members, name=target)
                    if member:
                        user = member
                        break
            if user:
                await user.send(f"**{char_name}:** {text}")
            else:
                print(f"[Scheduler] DM target '{target}' not found")
                bot.db.log_discord(
                    character=char_name, channel_id=f"dm:{task['target_id']}",
                    user='system', trigger=instructions or '', response=text,
                    model=model_used or '', input_tokens=input_tokens, output_tokens=output_tokens,
                    conversation_history=request_messages, temperature=temperature,
                    source='scheduler', status='error', error_message='DM target not found',
                    history_count=history_count, task_id=task['id'],
                )
                return

        bot.db.log_discord(
            character=char_name, channel_id=f"{task['target_type']}:{task['target_id']}",
            user='system', trigger=instructions or '', response=text,
            model=model_used or '', input_tokens=input_tokens, output_tokens=output_tokens,
            conversation_history=request_messages, temperature=temperature,
            source='scheduler', status='ok', error_message=None,
            history_count=history_count, task_id=task['id'],
        )
    except Exception:
        print(f"[Scheduler] Error sending task {task['id']}:\n{traceback.format_exc()}")


async def _run_scheduler(bot: 'Zahul'):
    """Background loop that fires due reminders and recurring schedules every minute, aligned to wall-clock minutes."""
    global _last_schedule_fire
    await asyncio.sleep(10)  # let the bot fully connect first
    while True:
        try:
            now = datetime.now(SK_TZ)
            now_iso = now.strftime("%Y-%m-%dT%H:%M:%S")

            # Fire due reminders
            due = bot.db.list_due_reminders(now_iso)
            for task in due:
                print(f"[Scheduler] Firing reminder id={task['id']} scheduled_time={task.get('scheduled_time')}")
                try:
                    await _send_scheduled_message(bot, task)
                    bot.db.update_task(task['id'], status='done', error_message=None)
                except Exception as e:
                    err = str(e)
                    print(f"[Scheduler] Reminder id={task['id']} failed: {err}\n{traceback.format_exc()}")
                    bot.db.update_task(task['id'], status='failed', error_message=err)
                    bot.db.log_discord(
                        character=task.get('character', ''), channel_id=f"{task['target_type']}:{task['target_id']}",
                        user='system', trigger=task.get('instructions') or '', response='',
                        model='', input_tokens=0, output_tokens=0, conversation_history=None,
                        source='scheduler', status='error', error_message=err, history_count=0,
                        task_id=task['id'],
                    )

            # Fire active schedules whose time matches now
            current_day = now.weekday()  # 0=Mon, 6=Sun
            current_time = now.strftime("%H:%M")
            today_str = now.strftime("%Y-%m-%d")
            active_schedules = bot.db.list_active_schedules()
            for task in active_schedules:
                pattern = task.get('repeat_pattern') or {}
                ptype = pattern.get('type', 'weekly')
                fire_time = pattern.get('time', '')
                should_fire = False
                if current_time == fire_time:
                    if ptype == 'daily':
                        should_fire = True
                    elif ptype == 'weekly':
                        should_fire = current_day in pattern.get('days', [])
                    elif ptype == 'monthly':
                        should_fire = now.day == pattern.get('day', 1)
                    elif ptype == 'yearly':
                        should_fire = now.month == pattern.get('month', 1) and now.day == pattern.get('day', 1)
                if should_fire and _last_schedule_fire.get(task['id']) != today_str:
                    print(f"[Scheduler] firing schedule task {task['id']} for {task['character']} at {current_time}")
                    try:
                        await _send_scheduled_message(bot, task)
                        bot.db.update_task(task['id'], error_message=None)
                    except Exception as e:
                        err = str(e)
                        print(f"[Scheduler] Schedule id={task['id']} failed: {err}\n{traceback.format_exc()}")
                        bot.db.update_task(task['id'], error_message=err)
                        bot.db.log_discord(
                            character=task.get('character', ''), channel_id=f"{task['target_type']}:{task['target_id']}",
                            user='system', trigger=task.get('instructions') or '', response='',
                            model='', input_tokens=0, output_tokens=0, conversation_history=None,
                            source='scheduler', status='error', error_message=err, history_count=0,
                            task_id=task['id'],
                        )
                    _last_schedule_fire[task['id']] = today_str
        except Exception:
            print(f"[Scheduler] Loop error:\n{traceback.format_exc()}")
        # Sleep until the start of the next wall-clock minute
        now = datetime.now(SK_TZ)
        await asyncio.sleep(60 - now.second - now.microsecond / 1_000_000)


@app_commands.command(name="reminder", description="Set a one-time reminder in this channel or DM.")
@app_commands.describe(
    character="Character who will deliver the message",
    when="Date and time (YYYY-MM-DD HH:MM) — Slovak time",
    text="Message text (exact) or topic hint (generate)",
    mode="How the message is sent: exact text or generated in character",
)
@app_commands.choices(mode=[
    app_commands.Choice(name="Exact", value="exact"),
    app_commands.Choice(name="Generate", value="generate"),
])
async def reminder_command(
    interaction: discord.Interaction,
    character: str,
    when: str,
    text: str,
    mode: app_commands.Choice[str] = None,
):
    bot: Zahul = interaction.client
    if not bot.db.get_character(character):
        await interaction.response.send_message(f"❌ Character **{character}** not found.", ephemeral=True)
        return
    try:
        dt = datetime.strptime(when, "%Y-%m-%d %H:%M:%S").replace(tzinfo=SK_TZ)
    except ValueError:
        try:
            dt = datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=SK_TZ)
        except ValueError:
            await interaction.response.send_message("❌ Invalid format. Use `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS` (Slovak time).", ephemeral=True)
            return
    if dt <= datetime.now(SK_TZ):
        await interaction.response.send_message("❌ That time is already in the past.", ephemeral=True)
        return

    message_mode = mode.value if mode else 'exact'

    if isinstance(interaction.channel, discord.DMChannel):
        target_type = 'dm'
        target_id = str(interaction.user.name)
    else:
        target_type = 'channel'
        target_id = str(interaction.channel_id)

    task_id = bot.db.create_task(
        type='reminder',
        name=f"{character} — {dt.strftime('%Y-%m-%d %H:%M')}",
        character=character,
        target_type=target_type,
        target_id=target_id,
        instructions=text,
        scheduled_time=dt.strftime("%Y-%m-%dT%H:%M:%S"),
        status='upcoming',
        message_mode=message_mode,
    )
    target_desc = f"DM" if target_type == 'dm' else f"<#{interaction.channel_id}>"
    await interaction.response.send_message(
        f"✅ Reminder set! **{character}** → {target_desc} at **{when}** (ID: {task_id}, mode: {message_mode}).",
        ephemeral=True
    )


def register_channel_command(db: Database):
    @app_commands.command(name="register_channel", description="Initializes this channel for the bot.")
    async def _register(interaction: discord.Interaction):
        server_id = str(interaction.guild.id)
        channel_id = str(interaction.channel.id)
        if not db.get_server(server_id):
            db.create_server(server_id, interaction.guild.name)
        if db.get_channel(channel_id):
            await interaction.response.send_message("This channel is already registered.", ephemeral=True)
            return
        default_data = {"name": interaction.channel.name, "whitelist": []}
        db.create_channel(channel_id, server_id, interaction.guild.name, default_data)
        await interaction.response.send_message(f"Channel '{interaction.channel.name}' has been successfully registered!", ephemeral=True)
    return _register


def unregister_channel_command(db: Database):
    @app_commands.command(name="unregister_channel", description="Removes this channel from the bot.")
    async def _unregister(interaction: discord.Interaction):
        channel_id = str(interaction.channel.id)
        if not db.get_channel(channel_id):
            await interaction.response.send_message("This channel is not registered.", ephemeral=True)
            return
        db.delete_channel(channel_id)
        await interaction.response.send_message(f"Channel '{interaction.channel.name}' has been unregistered.", ephemeral=True)
    return _unregister


class WhitelistCommands(app_commands.Group):
    def __init__(self, db: Database):
        super().__init__(name="whitelist", description="Manage character whitelist for this channel")
        self.db = db

    @app_commands.command(name="add", description="Add characters to the whitelist (comma-separated).")
    async def add(self, interaction: discord.Interaction, names: str):
        channel = ActiveChannel.from_id(str(interaction.channel.id), self.db)
        if not channel:
            await interaction.response.send_message("This channel is not registered.", ephemeral=True)
            return
        
        new_names = {name.strip() for name in names.split(',')}
        current_whitelist = set(channel.whitelist)
        current_whitelist.update(new_names)
        channel.set_whitelist(sorted(list(current_whitelist)))
        await interaction.response.send_message(f"Added `{', '.join(new_names)}` to the whitelist.", ephemeral=True)

    @app_commands.command(name="remove", description="Remove characters from the whitelist (comma-separated).")
    async def remove(self, interaction: discord.Interaction, names: str):
        channel = ActiveChannel.from_id(str(interaction.channel.id), self.db)
        if not channel:
            await interaction.response.send_message("This channel is not registered.", ephemeral=True)
            return

        names_to_remove = {name.strip() for name in names.split(',')}
        new_whitelist = [name for name in channel.whitelist if name not in names_to_remove]
        channel.set_whitelist(new_whitelist)
        await interaction.response.send_message(f"Removed `{', '.join(names_to_remove)}` from the whitelist.", ephemeral=True)
        
    @app_commands.command(name="view", description="View the current character whitelist for this channel.")
    async def view(self, interaction: discord.Interaction):
        channel = ActiveChannel.from_id(str(interaction.channel.id), self.db)
        if not channel:
            await interaction.response.send_message("This channel is not registered.", ephemeral=True)
            return

        if not channel.whitelist:
            await interaction.response.send_message("The whitelist is empty. All characters are allowed.", ephemeral=True)
        else:
            character_items = [f"- `{name}`" for name in channel.whitelist]
            
            # 2. Join these items with a newline character.
            # This creates a single string like: "- `Alice`\n- `Bob`"
            formatted_list = "\n".join(character_items)
            
            # 3. Now, use the clean, pre-formatted string in your f-string.
            response_text = f"**Whitelisted Characters:**\n{formatted_list}"
            
            await interaction.response.send_message(response_text, ephemeral=True)