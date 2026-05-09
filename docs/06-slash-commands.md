# Slash commands

These commands are registered on the bot and are meant to be run **in Discord** (in a server channel or in DMs, depending on the command). Most responses are **ephemeral** (only you see the result); **`/about`** is an exception and posts publicly.

Bot UI strings in this project are largely **Slovak**; command names below are the English slash identifiers.

## Channel setup

| Command | What it does |
|---|---|
| `/register_channel` | Initializes the current channel for the bot |
| `/unregister_channel` | Removes the current channel from the bot |

## Whitelist

| Command | What it does |
|---|---|
| `/whitelist add` | Adds one or more characters (comma-separated names) to this channel’s whitelist |
| `/whitelist remove` | Removes characters from the whitelist |
| `/whitelist view` | Shows which characters may speak here |

## Character info

| Command | What it does |
|---|---|
| `/about <name>` | Posts the character’s public “about” text in the channel (visible to everyone) |

## Tokens and models

| Command | What it does |
|---|---|
| `/tokens` | Shows token usage and active model (ephemeral) |

## Fallback model

| Command | What it does |
|---|---|
| `/fallback status` | Whether fallback mode is active and when the primary returns |
| `/fallback on` | Manually enable fallback |
| `/fallback off` | Manually disable fallback |

## Bot-to-bot chain limit (`autocap`)

Controls how many times the bot may reply in a row to another bot (chain limit from AI Config).

| Command | What it does |
|---|---|
| `/autocap set <value>` | Set the chain limit |
| `/autocap off [hours]` | Disable the limit temporarily; reverts after `hours` (default if omitted: see bot help) |
| `/autocap on` | Re-enable using the last stored value |
| `/autocap reset` | Reset to the value from AI Config |
| `/autocap status` | Current chain limit state |

## Reminder

| Command | What it does |
|---|---|
| `/reminder` | Schedules a **one-off** reminder in the **current** channel or DM; arguments include character, time, text, and optional mode (`exact` or `generate`) |

For richer scheduling (repeating jobs, panel UI), use [Scheduler](05-scheduler.md).

## Context menus (right-click)

Right-click a message from the bot:

| Menu | Purpose |
|---|---|
| **Edit Bot Message** | Edit the bot’s message |
| **Delete Bot Message** | Delete the bot’s message |
| **Edit / View Caption** | Edit or view image caption |

## See also

- [Servers & channels](04-servers.md) - invite and registration workflow  
- [CHANGES.md](../CHANGES.md) - changelog and feature notes  
