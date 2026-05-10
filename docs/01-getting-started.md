# Getting Started

This guide covers installing the app, creating a Discord bot application, and reaching the web panel. For keys and AI settings on the panel, continue with [AI Config](02-ai-config.md).

## Requirements

- **Python 3.12+** (see `requires-python` in `pyproject.toml` and `.python-version`)
- A **Discord bot** (free; you create it in the Developer Portal)
- An **AI provider** with an OpenAI-compatible API (Groq, OpenRouter, local Ollama, etc.)

## Choose an installation method

Pick one path below. All of them run the same app; the difference is how you manage Python and deployment.

### Option A - Docker (self-hosting / servers)

**Best when:** you want a stable box, easy restarts, and a clear place to mount persistent data.

- Runs the app in a container; mount `./data` (or your path) so the SQLite database survives upgrades.
- Good default for VPS or home server setups where you do not want to manage a local Python install on the host.

```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
docker compose up -d
```

The panel listens on port **5666** by default (see `docker-compose.yml`).

### Option B - uv (local development)

**Best when:** you develop or test on your machine and want fast installs and a locked dependency set (`uv.lock`).

```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
pip install uv   # or install uv from https://docs.astral.sh/uv/
uv sync
source .venv/bin/activate   # Windows: .venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 5666
```

You can use `python main.py --host 0.0.0.0 --port 5666` instead; it starts the same app.

### Option C - pip and venv (plain Python)

**Best when:** you prefer not to install Docker or uv and already use `venv` + `pip`.

```bash
git clone https://github.com/alzbetaurbanova/zahul-ai.git
cd zahul-ai
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
uvicorn main:app --host 0.0.0.0 --port 5666
```

Or: `python main.py --host 0.0.0.0 --port 5666`.

Dependencies are listed in `pyproject.toml`.

## Open the panel

Browse to `http://localhost:5666` (or your host and port). On first run the database is created for you; there is no manual SQL setup.

Panel login is optional until you enable protection; see [Panel Security](07-panel-security.md). For who can do what in the panel after accounts exist, see [Users](09-users.md).

## Create the Discord bot

1. Open [Discord Developer Portal](https://discord.com/developers/applications) and **New Application**.
2. Open the **Bot** tab and **Add Bot** if needed.
3. Under **Privileged Gateway Intents**, enable:
  - Presence Intent  
  - Server Members Intent  
  - Message Content Intent
4. **Reset / copy** the bot **token** - you will paste it into the panel in [AI Config](02-ai-config.md) (Keys & Integration). Treat it like a password.

## Next steps

1. [AI Config](02-ai-config.md) - Discord token, AI endpoint, model, save.
2. Start the bot from the panel, use the invite link, then [Servers & channels](04-servers.md) for `/register_channel` and whitelist.
3. [Characters](03-characters.md) - adjust or add personas.

Full map of guides: [Documentation index](00-guide.md).