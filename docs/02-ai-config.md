# AI Config

Use **AI Config** in the web panel for global bot and AI settings. This page is the right place for **first-time setup**: Discord token, AI provider URL, model, and related options.

## First-time setup (bot + API)

1. Open **AI Config -> Keys & Integration** (or the section your build labels for bot token and AI keys).
2. Fill in at least:


| Field                 | Notes                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Discord Bot Token** | From the Developer Portal - see [Getting Started](01-getting-started.md)                             |
| **AI API Key**        | From your provider; sensitive fields are not shown again after save - rotate by entering a new value |
| **AI Endpoint URL**   | OpenAI-compatible base URL (examples below)                                                          |
| **Primary Model**     | Exact model id from the provider                                                                     |

3. Click **Save Configuration**. With a valid token, the bot can connect to Discord when you start it from the panel.

Securing who may open the panel (password, OAuth) is separate: see [Panel Security](07-panel-security.md). Do that before exposing the panel on the public internet.

## Core AI settings


| Field                 | Description                                              |
| --------------------- | -------------------------------------------------------- |
| **AI Endpoint URL**   | Base URL of your AI provider (OpenAI-compatible)         |
| **Primary Model**     | Default model for replies - must match the provider’s id |
| **Temperature**       | Randomness (0-2); typical default around `0.7`           |
| **History Limit**     | How many past messages the model sees                    |
| **Max Output Tokens** | Cap on reply length                                      |
| **Chain Limit**       | Max bot-to-bot replies in a chain before stopping        |


### Common endpoint examples


| Provider     | Endpoint URL                     |
| ------------ | -------------------------------- |
| Groq         | `https://api.groq.com/openai/v1` |
| OpenRouter   | `https://openrouter.ai/api/v1`   |
| Local Ollama | `http://localhost:11434/v1`      |
| OpenAI       | `https://api.openai.com/v1`      |


## Fallback and rate limits

When the primary model hits rate limits, the bot can switch to a **fallback model** for a configurable duration. Tune fallback model, duration, and token thresholds in AI Config.

## Keys and integration


| Field                 | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| **AI API Key**        | Provider key; leave blank on save to keep the stored value                          |
| **Discord Bot Token** | Bot token; same rule for blank = keep                                               |
| **Public URL**        | Public base URL of the panel (webhooks, avatars behind HTTPS - see panel help text) |


## Prompt template

The default prompt template shapes every AI request (variables such as character name, persona, instructions, history). Editing it updates the stored **Default** preset.

## DM access control

- **Allow Direct Messages** - whether users may DM the bot  
- **Allowed Discord Usernames** - optional allowlist (one per line)  
- **Default Character** - used for DMs and when no trigger matches; see [Characters](03-characters.md)

## See also

- [Characters](03-characters.md) - personas and triggers  
- [Multimodal](11-multimodal.md) - vision / image description
- [Plugins](12-plugins.md) - optional features toggled on the Plugins page

