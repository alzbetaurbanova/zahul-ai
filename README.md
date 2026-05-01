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

zahul-ai is a self-hosted Discord bot for immersive multi-character roleplay. You run it on your own machine, connect it to any AI provider you want, and control everything through a web panel.

---

## What it does

- Multi-character roleplay bot — each character has its own personality, avatar, and trigger words
- Per-channel setup: assign characters, set persona and instructions, whitelist who can speak where
- Web panel at `http://localhost:5666` — manage everything without touching code
- Any OpenAI-compatible AI backend, with automatic fallback when the primary hits rate limits
- Scheduler for recurring messages and one-time reminders
- Activity and admin logs at `/logs`
- Optional panel password protection

See [CHANGES.md](CHANGES.md) for the full feature list and slash command reference.

---

## Getting started

### Requirements
- Python 3.10+ (or [uv](https://github.com/astral-sh/uv) — recommended)
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An API key for your chosen AI provider (Groq, OpenRouter, or any OpenAI-compatible endpoint)

---

### 1. Install and run

**With uv (recommended):**
```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
uv sync
uv run main.py
```

**With pip:**
```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
pip install -r requirements.txt
python main.py
```

**With Docker (recommended for self-hosting):**
```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
docker-compose up -d
```

The panel is available at `http://localhost:5666`.

On first run, the database is created automatically — a default character (Echo), a default prompt preset, and a baseline configuration are inserted. No manual database setup needed.

---

### 2. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Under the **Bot** tab, enable all three **Privileged Gateway Intents**:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
3. Copy your bot token — you'll need it in the next step

---

### 3. Configure via the web panel

Open `http://localhost:5666` and go to **AI Config**. Fill in:

| Field | What to put |
|---|---|
| **Discord Bot Token** | Token from the Developer Portal |
| **AI Endpoint URL** | e.g. `https://api.groq.com/openai/v1` |
| **AI API Key** | Your provider's API key |
| **Primary Model** | e.g. `llama-3.3-70b-versatile` |
| **Default Character** | `Echo` (pre-created) or your own |

Save the config, then click **Start Bot** on the main panel. An invite link will appear — use it to add the bot to your server.

---

### 4. Register a channel

In your Discord server, run the following slash command in the channel you want the bot to use:

```
/register_channel
```

The bot is now active in that channel.

---

### 5. Whitelist characters

By default, no characters are allowed to speak in the channel. Run `/whitelist add` to enable them:

```
/whitelist add Echo
/whitelist add Echo, Aria, Zara
```

Use `/whitelist view` to see who's active, and `/whitelist remove` to take someone out.

---

### 6. (Optional) Secure the panel

Go to **AI Config → Panel Security**, enable the toggle, set a password, and save. All future panel access will require login.

---

## Tech stack

- **FastAPI** - backend and bot API
- **SQLite** - single-file database, easy to back up
- **Vanilla JS** - no build step, no node_modules
- **Jinja2** - prompt templating engine

---

## License

- AGPL-3.0-only. See [LICENSE](LICENSE) and [PLEDGE.md](PLEDGE.md).

- This project is based on [viel-ai](https://github.com/Iteranya/viel-ai) by [Artes Paradox](https://github.com/Iteranya/). Attribution is mandatory per the license. 
- See [CHANGES.md](CHANGES.md) for what's different.
