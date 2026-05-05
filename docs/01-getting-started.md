# Getting Started

## Requirements

- Python 3.11+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An AI API key (OpenAI-compatible endpoint — e.g. Groq, OpenRouter, local Ollama)

## Installation

```bash
git clone https://github.com/your-repo/zahul-ai.git
cd zahul-ai
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

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

## Next steps

- [Secure the panel](02-panel-security.md) — add login protection before exposing the panel publicly
- [Create a character](04-characters.md) — set up your first AI persona
