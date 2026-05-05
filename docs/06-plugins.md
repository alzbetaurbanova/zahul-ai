# Plugins

Plugins extend the bot's behavior beyond plain AI responses. They are triggered by specific keywords that the AI can include in its output, or (for some) by keywords in the user's message.

Plugins are managed from the **Plugins** page in the panel — enable or disable each one there.

## How plugins work

When the AI's response (or the user's message) contains a plugin's trigger keyword, the plugin runs and its output is injected back into the context or sent as a separate message.

---

## Dice Roll

**Trigger:** `<dice_roll>` in the AI's response

The AI can call a dice roll during roleplay or games. The plugin rolls a die and returns the result, which the AI uses to continue the story.

---

## Tarot

**Trigger:** `<tarot>` in the AI's response

Draws a tarot spread based on the user's message and returns the card names and meanings to the AI. The AI then delivers the reading as the character.

---

## Battle RP

**Trigger:** `<battle_rp>` in the AI's response

Rolls attack and defense values for the character during combat roleplay, giving the AI structured battle outcomes to narrate.

---

## Web Search

**Trigger:** `search>` in the user's message (e.g. `search> latest news on X`)

Runs a DuckDuckGo search and passes the results to the AI as context. Useful for questions about current events or things outside the model's training data.

---

## Image Generation

**Trigger:** `image>` in the user's message (e.g. `image> a rainy forest at night`)

Generates an image using an image generation API (OpenAI-compatible) and posts it in the channel. Requires an image generation endpoint and API key configured in the plugin settings.

---

## Time

**Trigger:** `<tell_time>` in the AI's response

Returns the current server time to the AI so it can reference it in responses. No user configuration needed.

---

## Managing plugins

Go to **Plugins** in the panel to see all available plugins, toggle them on/off, and configure per-plugin settings (e.g. the image generation endpoint and key).
