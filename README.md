<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0">
    <img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3">
  </a>
  <a href="https://www.python.org/">
    <img src="https://img.shields.io/badge/Python-3.10+-yellow.svg" alt="Python">
  </a>
  <a href="https://fastapi.tiangolo.com/">
    <img src="https://img.shields.io/badge/Framework-FastAPI-009688.svg" alt="FastAPI">
  </a>
  <a href="https://www.sqlalchemy.org/">
    <img src="https://img.shields.io/badge/ORM-SQLAlchemy-red.svg" alt="SQLAlchemy">
  </a>
</p>
<h1 align="center">zahul-ai</h1>

A Discord roleplay bot - based on [viel-ai](https://github.com/Iteranya/viel-ai) by Artes Paradox. See [CHANGES.md](CHANGES.md) for what's different.

---

zahul-ai is a self-hosted Discord bot for immersive multi-character roleplay. You run it on your own machine, connect it to any AI provider you want, and control everything through a web panel.

---

## What it does

### Bring characters to life
- Run as many characters as you want, each with their own personality, avatar, and trigger words
- Assign characters to specific channels — they stay in their lane
- Characters can reply to each other (with safeguards against infinite loops)
- Import character cards from SillyTavern

### Per-channel world-building
- Set instructions, lore, and atmosphere per channel
- Characters adapt their behavior based on where they are
- Whitelist which characters can speak in which channel

### Web control panel
- Manage everything through a browser UI at `http://localhost:5666`
- Edit characters, configure AI settings, manage channels
- Built-in prompt template editor with Jinja2 support

### Any AI backend you want
- Works with any OpenAI-compatible endpoint
- Configurable base model and automatic fallback when the primary hits rate limits
- Fallback duration, token limits (per minute / per day) all set from the web panel
- `/tokens` — check current token usage and active model at any time
- `/fallback status/on/off` — manually control fallback mode
- `/about <name>` — display a character's bio in the channel
- Switch providers without losing your characters or settings

### Per-character fine-tuning
- Set a custom `temperature` and `max_tokens` per character — overrides the global config
- Upload a custom avatar directly from the character editor
- Each character can have its own history limit

### Web search & link reading
- Prefix a message with `search>` to trigger a web search
- Drop a link and the bot will read it before responding

### Advanced prompt engineering
- Jinja2 templating for dynamic system prompts
- Per-character temperature and token overrides
- Full control from the web panel, no code editing needed

---

## Getting started

### Requirements
- Python 3.10+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An API key for your chosen AI provider

### Run locally

```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
pip install -r requirements.txt
python main.py
```

Open `http://localhost:5666` in your browser and follow the setup steps in the AI Config panel.

### Discord bot setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Under the **Bot** tab, enable all three Privileged Gateway Intents:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
3. Copy your bot token and paste it into the **AI Config** panel
4. Start the bot from the control panel — an invite link will appear
5. In your Discord server, run `/zahul register_channel` in the channel you want to use

### Docker

```bash
docker-compose up -d
```

Then open `http://localhost:5666`.

---

## Tech stack

- **FastAPI** — backend and bot API
- **SQLite** — single-file database, easy to back up
- **Vanilla JS** — no build step, no node_modules
- **Jinja2** — prompt templating engine

---

## License

AGPL-3.0-only. See [LICENSE](LICENSE) and [PLEDGE.md](PLEDGE.md).

This project is based on [viel-ai](https://github.com/Iteranya/viel-ai) by [Artes Paradox](https://github.com/Iteranya/). Attribution is mandatory per the license.
