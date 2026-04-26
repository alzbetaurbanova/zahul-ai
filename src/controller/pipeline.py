# src/controller/think.py

import asyncio
import re
import traceback
import discord
from src.controller.messenger import DiscordMessenger
from src.models.aicharacter import ActiveCharacter
from src.models.dimension import ActiveChannel
from src.models.prompts import PromptEngineer
from src.models.queue import QueueItem
from src.plugins.manager import PluginManager
from src.utils.llm_new import generate_response
from api.models.models import BotConfig
from api.db.database import Database

# --- HELPER FUNCTIONS FOR MULTI-CHARACTER LOGIC ---

def find_all_triggered_characters(message: discord.Message, channel: ActiveChannel, db: Database) -> list[ActiveCharacter]:
    """
    Scans a message to find ALL whitelisted characters triggered by keywords.
    Instead of returning names, it returns a list of instantiated ActiveCharacter objects.
    """
    if not channel.whitelist:
        return []

    triggered_characters = []
    # Use a set to prevent adding the same character twice if multiple of their triggers match
    triggered_names = set() 
    message_lower = message.content.lower()

    for name in channel.whitelist:
        char_data = db.get_character(name)
        if not char_data or char_data['name'] in triggered_names:
            continue

        name_trigger = char_data.get("name", "").lower()
        raw_triggers = char_data.get("triggers") or []
        triggers = [t.lower() for t in raw_triggers]
        extended_triggers = triggers + ([name_trigger] if name_trigger else [])

        for trigger in extended_triggers:
            if not trigger:
                continue
            # Use whole-word matching for better accuracy
            if re.search(r'\b' + re.escape(trigger) + r'\b', message_lower):
                # We found a match, so create the character object and add it
                triggered_characters.append(ActiveCharacter(char_data, db))
                triggered_names.add(char_data['name'])
                break # Move to the next character in the whitelist

    return triggered_characters


async def _generate_and_send_for_character(
    character: ActiveCharacter,
    zahul, db: Database,
    message: discord.Message,
    channel: ActiveChannel,
    messenger: DiscordMessenger,
    plugin_manager: PluginManager,
    server_id: str = None,
):
    """
    Contains the core logic for generating and sending a message for ONE character.
    """
    # Avoid character talking to themselves
    if character.name.lower() == message.author.display_name.lower():
        return

    print(f"Processing chat for {character.name} in {channel.name}...")
    
    prompter = PromptEngineer(character, message, channel, plugin_manager, messenger)
    prompt = await prompter.create_prompt()

    queue_item = QueueItem(
        prompt=prompt,
        bot=character.name,
        user=message.author.display_name,
        stop=prompter.stopping_strings,
        message=message,
        history_count=getattr(prompter, 'history_count', 0),
        server_id=server_id,
    )
    
    queue_item = await generate_response(queue_item, db)

    if not queue_item.result:
        queue_item.result = "//[OOC: The AI failed to generate a response.]"

    clean_up(queue_item)

    is_error = queue_item.result.startswith('//[OOC:')
    channel_id = 'dm' if isinstance(message.channel, discord.DMChannel) else str(message.channel.id)
    trigger_text = re.sub(r'^\[Replying To [^\]]+\]\n?', '', message.content).strip()
    request_messages = [
        {"role": "system", "content": queue_item.prompt},
        {"role": "user", "content": message.content},
    ]
    db.log_discord(
        character=character.name,
        channel_id=channel_id,
        user=message.author.name,
        trigger=trigger_text,
        response=queue_item.result,
        model=queue_item.model_used or '',
        input_tokens=queue_item.input_tokens,
        output_tokens=queue_item.output_tokens,
        conversation_history=request_messages,
        source='chat',
        status='error' if is_error else 'ok',
        error_message=queue_item.result if is_error else None,
        temperature=queue_item.temperature,
        history_count=queue_item.history_count,
    )

    await messenger.send_message(character, message, queue_item)


# --- CORRECT WORKER FUNCTION ---
async def process_message(zahul, db: Database, message: discord.Message, messenger: DiscordMessenger, queue: asyncio.Queue, plugin_manager:PluginManager):
    try:
        bot_config = BotConfig(**db.list_configs())

        # --- 1. Load Channel ---
        is_dm = isinstance(message.channel, discord.DMChannel)
        server_id = 'DM_VIRTUAL_SERVER' if is_dm else str(message.guild.id)
        if is_dm:
            if message.author.name not in (bot_config.dm_list or []):
                await message.channel.send("🚫 You do not have permission to talk to this bot in DM.")
                return
            channel = ActiveChannel.from_dm(message.channel, message.author, db)
        else:
            channel = ActiveChannel.from_id(str(message.channel.id), db)

        if not channel:
            return

        await message.add_reaction('✨')

        # --- 2. Determine ALL Characters to Respond ---
        responding_characters = find_all_triggered_characters(message, channel, db)
        
        # If no triggers were found, check for fallbacks (mentions, DMs, etc.)
        if not responding_characters:
            is_mention = message.guild and message.guild.me in message.mentions
            if (is_dm or is_mention) and bot_config.default_character:
                char_data = db.get_character(bot_config.default_character)
                if char_data:
                    # Create the default character and add it to our list
                    responding_characters.append(ActiveCharacter(char_data, db))

        if not responding_characters:
            # If still no one to respond, SOMETHING IS WRONG
            print("Something Is Wrong, Observer Found But Pipeline Don't")
            try:
                await message.remove_reaction('✨', zahul.user)
            except discord.NotFound: 
                pass
            return

        # --- 3. Loop and Generate Response for Each Character ---
        generation_tasks = []
        for character in responding_characters:
            task = _generate_and_send_for_character(
                character, zahul, db, message, channel, messenger, plugin_manager, server_id
            )
            generation_tasks.append(task)
        
        # Run all generation tasks concurrently for speed
        await asyncio.gather(*generation_tasks)

        # --- 4. Final Cleanup ---
        try:
            await message.remove_reaction('✨', zahul.user)
        except discord.NotFound: 
            pass

    except Exception as e:
        print(f"Error processing message: {e}\n{traceback.format_exc()}")
        try:
            await message.add_reaction('❌')
        except: pass
    
    finally:
        # Mark the single queue item as done after all characters have responded.
        queue.task_done()

# --- MANAGER FUNCTION (This part was already correct) ---
async def think(zahul, db: Database, queue: asyncio.Queue, plugin_manager:PluginManager) -> None:
    messenger = DiscordMessenger(zahul)
    
    # Keep track of running tasks
    background_tasks = set()

    print("🧠 AI Core started. Waiting for messages...")

    while True:
        # 1. Clean up finished tasks
        background_tasks = {t for t in background_tasks if not t.done()}

        # 2. Get dynamic config
        try:
            bot_config = BotConfig(**db.list_configs())
            concurrency_limit = bot_config.concurrency
            if concurrency_limit < 1: 
                concurrency_limit = 1
        except Exception:
            concurrency_limit = 1

        # 3. Check Concurrency Limit
        if len(background_tasks) >= concurrency_limit:
            await asyncio.wait(background_tasks, return_when=asyncio.FIRST_COMPLETED)
            continue 

        # 4. Get Message
        message: discord.Message = await queue.get()

        # 5. Spawn Worker
        task = asyncio.create_task(
            process_message(zahul, db, message, messenger, queue,plugin_manager)
        )
        
        background_tasks.add(task)

def clean_up(queue_item: QueueItem) -> QueueItem:
    """
    Removes LLM artifacts/stop strings from the generated result.
    Modifies the QueueItem in place.
    """
    if not queue_item.result:
        return queue_item

    artifacts = ["[End]", "[Reply]"]

    for artifact in artifacts:
        queue_item.result = queue_item.result.replace(artifact, "")

    queue_item.result = queue_item.result.strip()
    return queue_item