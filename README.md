# zahul-ai

A self-hosted Discord bot with a web panel for managing AI characters, conversations, and server automation.

Built and maintained by **zahul** (alzbet213@gmail.com).

---

## What it does

zahul-ai lets you run multiple AI personas on your Discord server. Each **character** has its own name, system prompt, avatar, and trigger words — when someone mentions a trigger, the bot responds as that character via a webhook, making it appear as a real user.

**Features:**
- Multiple AI characters with individual personalities, avatars, and settings
- Any OpenAI-compatible AI backend (Groq, OpenRouter, local Ollama, etc.)
- Web panel for configuration, character management, and logs
- Panel login protection — local account and/or Discord OAuth
- Scheduled messages (one-off reminders and recurring schedules)
- Plugins: dice rolls, tarot readings, battle RP, web search, image generation
- Multimodal support — the bot can read and describe images sent in Discord
- Per-character overrides for temperature, history limit, and max tokens
- DM support with an optional user allowlist
- Automatic fallback model when the primary hits a rate limit

---

## Quick setup

### Requirements

- Python 3.12+
- A Discord bot token
- An OpenAI-compatible AI API key and endpoint

### Install

Dependencies live in `pyproject.toml` / `uv.lock`. Use **uv** (same as Docker):

```bash
git clone https://github.com/your-repo/zahul-ai.git
cd zahul-ai
pip install uv
uv sync
source .venv/bin/activate   # Windows: .venv\Scripts\activate
```

### Run

```bash
uvicorn main:app --host 0.0.0.0 --port 5666
```

Open `http://localhost:5666`. The panel loads without a login prompt on first run.

### First-time configuration

1. Go to **AI Config → Keys & Integration**
2. Enter your **Discord Bot Token** and **AI API Key**
3. Set the **AI Endpoint URL** and **Primary Model**
4. Hit **Save Configuration** — the bot connects automatically

> For full setup instructions including panel security and Discord OAuth, see [`docs/`](docs/).

---

## Docker

```bash
docker compose up -d
```

The panel runs on port `5666`. Mount `./data` as a volume to persist the database across restarts.

---

## Documentation

Guides are in [`docs/`](docs/):

| Guide | |
|---|---|
| [Getting Started](docs/01-getting-started.md) | Installation, keys, first run |
| [Panel Security](docs/02-panel-security.md) | Login protection, owner account |
| [Discord OAuth Login](docs/03-discord-oauth.md) | Step-by-step Discord app setup |
| [Characters](docs/04-characters.md) | Creating and managing AI personas |
| [AI Config](docs/05-ai-config.md) | Models, endpoints, rate limiting |
| [Plugins](docs/06-plugins.md) | Dice, tarot, search, image generation |
| [Multimodal](docs/07-multimodal.md) | Image description via vision model |
| [Scheduler](docs/08-scheduler.md) | Scheduled and recurring messages (channels and DMs) |
| [Users and roles](docs/09-users-and-roles.md) | Panel accounts, roles (`super_admin`–`guest`), access requests |

---

## Tech stack

- **Backend:** Python, FastAPI
- **Bot:** discord.py
- **Database:** SQLite
- **Frontend:** Tailwind CSS
- **Reverse proxy:** Caddy (optional, for HTTPS)
