# AI Config

Global settings for the AI backend. Accessible from **AI Config** in the panel.

## Core AI Settings

| Field | Description |
|---|---|
| **AI Endpoint URL** | Base URL of your AI provider (must be OpenAI-compatible) |
| **Primary Model** | Model used for all responses — must match the provider's exact model ID |
| **Temperature** | Randomness: `0` = predictable, `2` = chaotic. Default `0.7` |
| **History Limit** | How many past messages the AI sees per response |
| **Max Output Tokens** | Maximum length of each AI response |
| **Chain Limit** | Max bot-to-bot replies in a chain before the bot stops auto-replying |

### Common AI endpoint examples

| Provider | Endpoint URL |
|---|---|
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Local Ollama | `http://localhost:11434/v1` |
| OpenAI | `https://api.openai.com/v1` |

## Fallback & Rate Limiting

When the primary model hits a rate limit, the bot switches to a fallback model automatically.

| Field | Description |
|---|---|
| **Fallback Model** | Model ID used when the primary hits a rate limit |
| **Fallback Duration** | How long (seconds) the fallback stays active after a rate limit |
| **Rate Limit Trigger (tokens/min)** | Per-minute token threshold that triggers the switch |
| **Daily Token Budget** | Total tokens allowed across all models per day |

## Keys & Integration

| Field | Description |
|---|---|
| **AI API Key** | API key for your AI provider — leave blank to keep the existing value |
| **Discord Bot Token** | Bot token from the Discord Developer Portal |
| **Public URL** | Public domain of the panel (used for webhook avatar URLs and Caddy HTTPS) |

> Sensitive fields (API keys, tokens) are never pre-filled. Enter a new value only when rotating.

## Prompt Template

The **Default** prompt template defines the structure sent to the AI for every response. It uses template variables:

| Variable | Value |
|---|---|
| `{{character.name}}` | Active character's name |
| `{{character.persona}}` | Character's persona field |
| `{{character.instructions}}` | Character's instruction field |
| `{{history}}` | Conversation history |

Edit the template and click **Save Prompt** to apply. The template is stored as the `Default` preset and can also be managed under the Presets system.

## DM Access Control

Controls whether users can DM the bot directly.

- **Allow Direct Messages** — toggle on to enable DMs
- **Allowed Discord Usernames** — if set, only these users can DM the bot (one username per line)
- **Default Character** — character used for DMs and unmatched `@mentions`
