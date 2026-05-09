# Servers & channels

This guide ties together **inviting the bot**, **registering channels**, and **whitelisting characters** so the bot can reply in the right places.

## 1. Invite the bot

1. In the web panel, ensure the Discord token is saved and the bot is **started** (see [AI Config](02-ai-config.md)).
2. Use the **invite link** shown in the panel (or generate one in the Developer Portal with `applications.commands` and `bot` scopes).
3. Pick the server and authorize.

## 2. Register a channel

In each Discord channel where the bot should listen:

- Run **`/register_channel`**

That links the channel to the bot’s configuration. Unregister with **`/unregister_channel`** if you remove it later.

Details for all slash commands: [Slash commands](06-slash-commands.md).

## 3. Whitelist characters

Until a character is whitelisted for that channel, it will not speak there.

Examples:

```
/whitelist add Echo
/whitelist add Echo, Aria, Zara
/whitelist view
/whitelist remove Echo
```

Use character **names** exactly as in the panel ([Characters](03-characters.md)).

## 4. Optional: default character

For DMs and unmatched mentions, set **Default Character** in [AI Config](02-ai-config.md) under DM access control.

## See also

- [Scheduler](05-scheduler.md) - timed messages to channels or DMs  
- [Slash commands](06-slash-commands.md) - full command list  
