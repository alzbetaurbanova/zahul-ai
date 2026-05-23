# src/controller/observer.py

import re
import discord

from src.models.dimension import ActiveChannel
from src.utils.character_triggers import (
    effective_auto_cap,
    extended_triggers,
    get_whitelist_characters,
    resolve_triggers,
)


async def bot_behavior(message: discord.Message, bot) -> None:
    """
    Observes incoming messages and decides if the bot should process them.
    If a message is deemed relevant, it is placed on the processing queue.
    """
    if message.author == bot.user:
        return

    if isinstance(message.channel, discord.DMChannel):
        print(f"DM received from {message.author.display_name}. Queuing for default character.")
        await bot.queue.put(message)
        return

    channel = ActiveChannel.from_id(str(message.channel.id), bot.db)
    if not channel:
        return

    if not message.webhook_id:
        bot.auto_reply_count = 0

    if bot.user in message.mentions:
        print(f"Bot was mentioned by {message.author.display_name}. Queuing message.")
        await bot.queue.put(message)
        return

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
            pass

    if not message.webhook_id:
        if not channel.whitelist:
            return

        characters_to_check = get_whitelist_characters(bot.db, channel.whitelist)
        message_lower = message.content.lower()
        server_id = str(message.guild.id) if message.guild else None
        current_channel_ref = "#" + channel.name.lower()

        for char in characters_to_check:
            triggers, name_trigger = resolve_triggers(char, server_id)
            for trigger in triggers + ([name_trigger] if name_trigger else []):
                if not trigger:
                    continue
                if re.search(r"\b" + re.escape(trigger) + r"\b", message_lower):
                    print(
                        f"User message contained trigger '{trigger}' for whitelisted character '{char['name']}'. Queuing message."
                    )
                    await bot.queue.put(message)
                    bot.auto_reply_count = 0
                    return
                if trigger == current_channel_ref:
                    print(
                        f"Current channel '{current_channel_ref}' matches trigger for character '{char['name']}'. Queuing message."
                    )
                    message.content = f"[Replying To {char['name']}]\n{message.content}"
                    await bot.queue.put(message)
                    bot.auto_reply_count = 0
                    return

    if message.webhook_id:
        import bot_run

        if not channel.whitelist:
            return

        if bot_run._autocap_unlimited:
            global_cap = 999999
        else:
            from src.utils.llm_new import get_bot_config

            global_cap = (
                bot_run._autocap_previous
                if bot_run._autocap_previous is not None
                else get_bot_config(bot.db).auto_cap
            )

        characters_to_check = get_whitelist_characters(bot.db, channel.whitelist)
        message_lower = message.content.lower()
        bot_server_id = str(message.guild.id) if message.guild else None

        for char in characters_to_check:
            effective_cap = effective_auto_cap(char, bot_server_id, global_cap)
            if bot.auto_reply_count >= effective_cap:
                print(f"Auto-reply cap of {effective_cap} reached for '{char['name']}'. Skipping.")
                continue

            for trigger in extended_triggers(char, bot_server_id):
                if not trigger:
                    continue
                if re.search(r"\b" + re.escape(trigger) + r"\b", message_lower):
                    print(
                        f"Bot '{message.author.display_name}' used trigger '{trigger}' for whitelisted character '{char['name']}'. Queuing message."
                    )
                    bot.auto_reply_count += 1
                    await bot.queue.put(message)
                    return
