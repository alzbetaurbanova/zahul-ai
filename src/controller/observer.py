# src/controller/observer.py

import re
import discord
# Adjust import paths as needed
from src.models.dimension import ActiveChannel
from typing import TYPE_CHECKING


async def bot_behavior(message: discord.Message, bot) -> None:
    """
    Observes incoming messages and decides if the bot should process them.
    If a message is deemed relevant, it is placed on the processing queue.
    """
    # 1. Basic Pre-checks
    # Ignore messages from the bot itself
    if message.author == bot.user:
        return

    # 2. Handle Direct Messages (DMs)
    if isinstance(message.channel, discord.DMChannel):
        print(f"DM received from {message.author.display_name}. Queuing for default character.")
        await bot.queue.put(message)
        return

    # 3. Handle Guild Messages
    # Fetch the channel configuration from the database
    channel = ActiveChannel.from_id(str(message.channel.id), bot.db)

    if not channel:
        return # Channel is not registered, so we ignore it.

    # Reset the auto-reply counter if a human speaks
    if not message.webhook_id:
        bot.auto_reply_count = 0

    # --- Determine if the bot should activate ---

    # A. Activated by direct mention
    if bot.user in message.mentions:
        print(f"Bot was mentioned by {message.author.display_name}. Queuing message.")
        await bot.queue.put(message)
        return

    # B. Activated by replying to a whitelisted character
    if message.reference and message.reference.message_id:
        try:
            replied_to_message = await message.channel.fetch_message(message.reference.message_id)
            bot_name = replied_to_message.author.display_name
            if bot_name in channel.whitelist:
                print(f"User replied to whitelisted bot '{bot_name}'. Queuing message.")
                message.content = f"[Replying To {bot_name}]\n{message.content}"
                await bot.queue.put(message)
                return
        except discord.NotFound:
            pass # Replied-to message might have been deleted

    
# C. Activated by a user message containing a trigger word for a WHITELISTED character
    if not message.webhook_id:
        if not channel.whitelist:
            return  # Stop processing immediately.

        characters_to_check = []
        for name in channel.whitelist:
            char_data = bot.db.get_character(name)
            if char_data:
                characters_to_check.append(char_data)

        message_lower = message.content.lower()
        server_id = str(message.guild.id) if message.guild else None

        current_channel_ref = "#" + channel.name.lower()

        for char in characters_to_check:
            # Grab triggers + the character's own name
            name_trigger = char.get("name", "").lower()
            raw_triggers = char.get("triggers", [])

            # Check for per-server trigger override
            data = char.get("data", {})
            if server_id and data.get("model_rules_enabled") and data.get("model_rules"):
                for rule in data["model_rules"]:
                    if server_id in (rule.get("servers") or []):
                        per_server_triggers = [t.strip() for t in (rule.get("triggers") or []) if t.strip()]
                        if per_server_triggers:
                            raw_triggers = per_server_triggers
                            name_trigger = None
                        break

            triggers = [t.lower() for t in raw_triggers]
            extended_triggers = triggers + ([name_trigger] if name_trigger else [])

            for trigger in extended_triggers:
                if not trigger:
                    continue

                # 1. Normal conversational trigger (word inside message)
                if re.search(r'\b' + re.escape(trigger) + r'\b', message_lower):
                    print(
                        f"User message contained trigger '{trigger}' for whitelisted character '{char['name']}'. Queuing message."
                    )
                    await bot.queue.put(message)
                    bot.auto_reply_count = 0
                    return

                # 2. Perma-channel trigger (Exact Match)
                # Matches ONLY if the trigger is exactly the channel name with hash (e.g., "#general")
                elif trigger == current_channel_ref:
                    print(
                        f"Current channel '{current_channel_ref}' matches trigger for character '{char['name']}'. Queuing message."
                    )
                    message.content = f"[Replying To {char['name']}]\n{message.content}"
                    await bot.queue.put(message)
                    bot.auto_reply_count = 0
                    return

    # D. Activated by another bot's message (bot-to-bot interaction)
    if message.webhook_id:
        import bot_run
        if not channel.whitelist:
            return

        if bot_run._autocap_unlimited:
            global_cap = 999999
        else:
            from src.utils.llm_new import get_bot_config
            global_cap = bot_run._autocap_previous if bot_run._autocap_previous is not None else get_bot_config(bot.db).auto_cap

        characters_to_check = []
        for name in channel.whitelist:
            char_data = bot.db.get_character(name)
            if char_data:
                characters_to_check.append(char_data)

        message_lower = message.content.lower()
        bot_server_id = str(message.guild.id) if message.guild else None

        for char in characters_to_check:
            # Grab triggers + the character's own name (same as user logic)
            name_trigger = char.get("name", "").lower()
            raw_triggers = char.get("triggers", [])

            # Check for per-server trigger override
            data = char.get("data", {})

            # Check per-server auto_cap from model rules; fall back to global_cap
            char_cap = None
            if bot_server_id and data.get("model_rules_enabled") and data.get("model_rules"):
                for rule in data["model_rules"]:
                    if bot_server_id in (rule.get("servers") or []):
                        per_server_triggers = [t.strip() for t in (rule.get("triggers") or []) if t.strip()]
                        if per_server_triggers:
                            raw_triggers = per_server_triggers
                            name_trigger = None
                        if rule.get("auto_cap") is not None:
                            char_cap = rule["auto_cap"]
                        break

            effective_cap = char_cap if char_cap is not None else global_cap
            if bot.auto_reply_count >= effective_cap:
                print(f"Auto-reply cap of {effective_cap} reached for '{char['name']}'. Skipping.")
                continue

            triggers = [t.lower() for t in raw_triggers]
            extended_triggers = triggers + ([name_trigger] if name_trigger else [])

            for trigger in extended_triggers:
                if not trigger:
                    continue
                if re.search(r'\b' + re.escape(trigger) + r'\b', message_lower):
                    print(
                        f"Bot '{message.author.display_name}' used trigger '{trigger}' for whitelisted character '{char['name']}'. Queuing message."
                    )
                    bot.auto_reply_count += 1
                    await bot.queue.put(message)
                    return