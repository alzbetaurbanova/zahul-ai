# Plugins

Plugins add behaviors beyond plain text replies. They are toggled and configured on the **Plugins** page in the panel.

## How plugins run

Some plugins react to markers in the **model output**; others to prefixes in the **user message**. When a trigger matches, the plugin runs and its result is merged into the flow or sent as needed.

---

## Dice roll

**Trigger:** `<dice_roll>` in the AI’s response  

Rolls dice for RP; the model continues with the result.

---

## Tarot

**Trigger:** `<tarot>` in the AI’s response  

Draws a spread; the model delivers the reading in character.

---

## Battle RP

**Trigger:** `<battle_rp>` in the AI’s response  

Structured combat rolls for narrative fights.

---

## Web search

**Trigger:** `search>` at the start of the user message (e.g. `search> weather in …`)  

Runs a web search and passes snippets to the model.

---

## Image generation

**Trigger:** `image>` in the user message (e.g. `image> a rainy street at night`)  

Calls a configured image API and posts the image. Requires plugin settings (endpoint, key) in the panel.

---

## Time

**Trigger:** `<tell_time>` in the AI’s response  

Injects current time for the model; no extra configuration.

---

## Managing plugins

Open **Plugins** to enable or disable each plugin and set per-plugin options (e.g. image API endpoint).
