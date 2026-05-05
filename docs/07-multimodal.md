# Multimodal (Image Description)

When multimodal is enabled, the bot can receive images sent in Discord and describe them to the AI as part of the conversation context. This lets characters respond to images naturally.

## How it works

1. A user posts an image in a channel where the bot is active
2. The image is sent to a separate vision model
3. The vision model returns a text description
4. That description is injected into the AI's context alongside the rest of the conversation

## Setup

1. Open **AI Config → Advanced Features**
2. Enable **Multimodal (Image Description)**
3. Fill in:

| Field | Description |
|---|---|
| **Multimodal Model** | Vision model ID (e.g. `google/gemini-pro-vision`, `gpt-4o`) |
| **Multimodal Endpoint URL** | API endpoint for the vision model — can differ from the primary AI endpoint |
| **Multimodal API Key** | API key for the vision model provider — leave blank to keep existing |

4. Click **Save Configuration**

## Provider examples

| Provider | Endpoint | Model |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-pro-vision` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Groq | `https://api.groq.com/openai/v1` | (check current vision model availability) |

## Notes

- The vision model is called separately from the primary model — you can use a different provider for each
- Only image attachments are processed — links to images are not automatically fetched
- If the vision model call fails, the bot continues without the image description rather than erroring out
