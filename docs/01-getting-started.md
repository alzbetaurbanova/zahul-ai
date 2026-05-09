# Getting Started

## Requirements

- Python 3.12+ (see `.python-version`; matches `requires-python` in `pyproject.toml`)
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An AI API key (OpenAI-compatible endpoint — e.g. Groq, OpenRouter, local Ollama)

## Installation

Dependencies are declared in `pyproject.toml` and locked in `uv.lock` (same layout as the Dockerfile).

**Recommended — uv** (creates/uses `.venv` automatically):

```bash
git clone https://github.com/your-repo/zahul-ai.git
cd zahul-ai
pip install uv
uv sync
source .venv/bin/activate        # Windows: .venv\Scripts\activate
```

**Without uv:** install [uv](https://docs.astral.sh/uv/) or copy dependency names from `pyproject.toml` into a local requirements file — there is no checked-in `requirements.txt`.

## First run

```bash
uvicorn main:app --host 0.0.0.0 --port 5666
```

Open `http://localhost:5666` — the panel loads without a login prompt on first run.

## Required configuration (AI Config page)

Go to **AI Config → Keys & Integration** and fill in:

| Field | Where to get it |
|---|---|
| **Discord Bot Token** | Developer Portal → your app → Bot → Token |
| **AI API Key** | Your AI provider's dashboard |
| **AI Endpoint URL** | Your provider's base URL (e.g. `https://api.groq.com/openai/v1`) |
| **Primary Model** | Model ID from your provider (e.g. `llama-3.3-70b-versatile`) |

Hit **Save Configuration**. The bot connects to Discord automatically when the token is set.

## Roles and permissions (overview)

After you enable **Protect panel**, each account has a **role**. Higher roles can do everything lower roles can, except **mod** is sometimes limited to specific Discord servers (see below).

| What | guest | mod | admin | super_admin |
|------|:------|:----|:------|:------------|
| **AI Config** — read | yes (API keys hidden) | yes (hidden) | full | full |
| **AI Config** — save, turn bot on/off, edit characters / presets / servers / scheduler | — | — | yes | yes |
| **Servers & scheduler** — browse | — | yes; **mod** only sees assigned servers; scheduler lists **channel** tasks in those servers (not DM/global) | full | full |
| **Logs**, **Trash**, **Plugins**, **Users** (incl. access requests) | — | — | yes | yes |
| **Create** a new panel user (local or Discord stub) | — | — | — | yes |
| **Panel Security** — owner password, OAuth, Protect panel | — | — | — | yes |

Only **super_admin** may grant or revoke the **super_admin** role for another user. There must always be at least one super admin.

Full detail, **pending** accounts, and Discord OAuth flow: [Users and roles](09-users-and-roles.md).

## Next steps

- [Secure the panel](02-panel-security.md) — add login protection before exposing the panel publicly
- [Create a character](04-characters.md) — set up your first AI persona
