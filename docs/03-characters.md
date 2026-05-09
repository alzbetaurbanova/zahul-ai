# Characters

Characters are AI personas: name, system prompt, avatar, and optional per-character model settings. The bot answers as the character that matches the message context.

## Creating a character

1. Open **Characters** in the panel.
2. Click **New Character**.
3. Fill in:
  - **Name** - shown in Discord (webhook username).
  - **Persona** - short description used inside the prompt.
  - **Instructions** - main system instructions for the model.
  - **Avatar URL** - direct image link, or upload/mirror.
  - **Triggers** - words that activate this character in a message (e.g. `Echo`).

## Trigger words

A character activates when one of its triggers appears in a Discord message (case-insensitive). You can set several triggers per character (one per line).

If nothing matches, behavior depends on context (e.g. **Default Character** for DMs - set under **AI Config -> DM Access Control**; see [AI Config](02-ai-config.md)).

## Whitelist (who may speak in a channel)

By default, registered channels do **not** let every character speak. You allow characters per channel with Discord slash commands - see [Servers & channels](04-servers.md) for `/register_channel` and `/whitelist`.

## Per-character overrides

Optional fields override global AI Config for that character only:


| Field             | Effect                      |
| ----------------- | --------------------------- |
| **Temperature**   | Override global temperature |
| **History Limit** | Override history window     |
| **Max Tokens**    | Override max reply length   |


Leave blank to inherit globals from [AI Config](02-ai-config.md).

## About text

Short public blurb for the character list; can tie into `/about` on the server (see [Slash commands](06-slash-commands.md)).

## Editing and deleting

Open a character from the list, edit, **Save**. **Delete** removes the character from the live list and stores a snapshot in **trash** (see [Dashboard, logs & tools](10-panel-tools.md#trash-api) for restore).

## Default character

Used for:

- Direct messages to the bot (when DMs are allowed)
- Mentions that do not match a trigger
- Channels configured to pin a specific character

Set **Default Character** under **AI Config -> DM Access Control** ([AI Config](02-ai-config.md)).