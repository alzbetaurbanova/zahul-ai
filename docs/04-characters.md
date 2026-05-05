# Characters

Characters are AI personas with their own name, system prompt, avatar, and optional per-character model settings. The bot responds as the active character for each message.

## Creating a character

1. Go to **Characters** in the panel
2. Click **New Character**
3. Fill in:
   - **Name** — shown in Discord (used as the webhook username)
   - **Persona** — short description of who the character is (used internally in the prompt)
   - **Instructions** — system prompt sent to the AI for every response
   - **Avatar URL** — direct link to a `.png` or `.jpg` image
   - **Triggers** — words that activate this character in a message (e.g. `Echo`)

## Trigger words

A character is activated when its trigger word appears in a Discord message. Trigger words are case-insensitive.

If no trigger word is matched, the bot uses the **Default Character** (set in AI Config → DM Access Control).

Multiple trigger words can be assigned to one character, one per line.

## Per-character overrides

Each character can override the global AI settings:

| Field | Effect |
|---|---|
| **Temperature** | Overrides global temperature for this character |
| **History Limit** | Overrides how many past messages this character sees |
| **Max Tokens** | Overrides max response length |

Leave blank to inherit the global setting.

## About text

The **About** field is a short public description. It appears in the character list on the panel and can be referenced in `/info` commands.

## Editing and deleting

Click any character in the list to open its editor. Changes save immediately when you click **Save**. Deleting a character removes it permanently — there is no undo.

## Default character

The default character handles:
- Direct messages to the bot
- `@mentions` that don't match any trigger
- Channels configured to always use a specific character

Set it in **AI Config → DM Access Control → Default Character**.
