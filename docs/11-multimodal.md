# Multimodal (image description)

When multimodal is enabled, the bot can take **image attachments** from Discord, run them through a **vision** model, and feed the resulting text into the normal conversation context.

## How it works

1. Someone posts an image where the bot is active  
2. The image is sent to the configured vision model  
3. The returned description is added to context  
4. The main character model replies with that context  

## Setup

1. **AI Config -> Advanced Features** (or the section that lists multimodal)  
2. Enable **Multimodal (Image Description)**  
3. Configure:

| Field | Description |
|---|---|
| **Multimodal Model** | Vision-capable model id |
| **Multimodal Endpoint URL** | API base URL (can differ from primary AI) |
| **Multimodal API Key** | Key for that provider; blank save may keep existing |

4. Save configuration

## Provider examples

| Provider | Endpoint | Example model |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | Check current vision ids |
| OpenAI | `https://api.openai.com/v1` | e.g. vision-capable GPT models |
| Groq | `https://api.groq.com/openai/v1` | Check provider docs for vision support |

## Notes

- Vision calls are separate from the primary text model - you can mix providers  
- Typically **attachments** only; arbitrary image URLs may not be fetched automatically  
- If vision fails, the bot may continue without the image description rather than hard-failing  
