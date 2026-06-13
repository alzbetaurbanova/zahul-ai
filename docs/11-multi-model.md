# Multi-Model

**AI Config -> Advanced Features** has two separate multi-model-related sections:

- **Vision** - lets the bot describe image attachments in Discord messages
- **Multi-Model Providers** - a named list of AI providers used for future overrides (e.g. per-character or per-channel model selection)

---

## Vision (image description)

When enabled, the bot takes image attachments from Discord, sends them to a vision-capable model, and adds the returned description to conversation context before generating a reply.

### How it works

1. Someone posts an image where the bot is active
2. The image is sent to the configured vision model
3. The returned description is added to context
4. The main character model replies using that context

### Setup

1. Open **AI Config -> Advanced Features**
2. Enable **Vision (Image Description)**
3. Configure the three fields that appear:

| Field | Description |
|---|---|
| **Vision Model** | Vision-capable model id (must match the provider exactly) |
| **Vision Endpoint URL** | API base URL - can differ from the primary AI endpoint |
| **Vision API Key** | Key for that provider; leave blank on save to keep the stored value |

4. Save configuration

### Provider examples

| Provider | Endpoint | Notes |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | Wide selection of vision models |
| OpenAI | `https://api.openai.com/v1` | GPT-4o and similar |
| Groq | `https://api.groq.com/openai/v1` | Check provider docs for current vision support |

### Notes

- Vision calls are separate from the primary text model - you can mix providers
- Only image attachments are processed; arbitrary image URLs in message text are not fetched
- If the vision call fails, the bot continues without the image description rather than hard-failing

---

## Multi-Model Providers

A named list of AI providers that can be referenced by name in other parts of the bot (e.g. future character or channel overrides). This is separate from the vision config above.

Each provider has:

| Field | Description |
|---|---|
| **Name** | Identifier used when referencing this provider elsewhere (e.g. `openrouter-vision`) |
| **Endpoint URL** | OpenAI-compatible base URL for this provider |
| **API Key** | Leave blank on save to keep the stored value |
| **Allowed Models** | One model id per line - populates dropdowns wherever this provider can be selected |

Providers can be added and removed freely. Removing a provider does not affect any existing config that references it by name until that config is re-saved.
