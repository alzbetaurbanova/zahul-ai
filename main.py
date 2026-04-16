# main.py
"""Main FastAPI application entry point with first-run database initialization."""

import argparse
import asyncio
import os
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# --- Local Imports ---
from api.routers import characters, servers, config, discord as discord_router, preset
from api.db.database import Database
from src.plugins.manager import PluginManager

# --- Default Data for First-Time Setup ---

# This is the default prompt template we developed earlier.
DEFAULT_PROMPT_TEMPLATE = """\
[{{character.name}}]
{{character.persona}}
{% for example in character.examples %}
{{example}}
{% endfor %}
{% if channel.global_note %}
[Lore]
{{channel.global_note}}
{% endif %}
[History]
{{history}}

{{- character.instructions if character.instructions -}}
{{- channel.instruction if channel.instruction -}}
{% if plugins %}
{% for plugin_name, output_data in plugins.items() %}{% for key, value in output_data.items() %}
{{value}}{% endfor %}{% endfor %}
{% endif %}

[Reply only as {{character.name}}.]
"""

async def initialize_database():
    """
    Checks if the database is new and populates it with essential default data.
    This function runs once on application startup.
    """
    print("Checking database initialization status...")
    db = Database()

    # Use a flag in the config table to see if we've run this before.
    if db.get_config("db_initialized"):
        print("Database already initialized. Skipping setup.")
        return

    print("--- Performing first-time database setup ---")

    # 1. No default character — create your own via the web panel

    # 2. Create the default preset
    if not db.get_preset("Default"):
        db.create_preset(
            name="Default",
            description="The default system prompt template, used as a fallback.",
            prompt_template=DEFAULT_PROMPT_TEMPLATE
        )
        print("-> 'Default' prompt preset created.")

    # 3. Populate the config table with default values
    print("-> Populating default configuration...")
    default_config = {
        "default_character": "Helena",
        "ai_endpoint": "https://openrouter.ai/api/v1", # A sensible default
        "base_llm": "gryphe/mythomax-l2-13b", # A sensible default
        "temperature": 0.7,
        "auto_cap": 1,
        "ai_key": "", # User must provide this
        "discord_key": "", # User must provide this
        "history_limit": 10,
        "max_tokens": 256,
        "use_prefill": False,
        "multimodal_enable": False,
        "multimodal_ai_endpoint": "https://openrouter.ai/api/v1",
        "multimodal_ai_api": "", 
        "multimodal_ai_model": "google/gemini-pro-vision"
    }
    for key, value in default_config.items():
        db.set_config(key, value)
    
    # Finally, set the initialization flag so this doesn't run again.
    db.set_config("db_initialized", True)
    print("--- Database initialization complete! ---")

# --- FastAPI App Setup ---

app = FastAPI(
    title="zahul-ai Configuration API",
    description="API for managing character, channel, and bot configurations"
)

@app.on_event("startup")
async def startup_event():
    """Run the database initialization when the app starts."""
    await initialize_database()
    asyncio.create_task(_auto_activate())

async def _auto_activate():
    """Try to activate the bot automatically on startup, retrying for up to 60 seconds."""
    from api.routers.discord import activate_bot
    for _ in range(12):
        await asyncio.sleep(5)
        try:
            await activate_bot()
            return
        except Exception:
            pass

# Include routers
app.include_router(characters.router)
app.include_router(servers.router)
app.include_router(config.router)
app.include_router(discord_router.router)
app.include_router(preset.router)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Static File Serving ---
# This is the modern way to serve your static frontend files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=FileResponse)
async def get_root():
    """Serve the main index.html page."""
    return "static/index.html"

@app.get("/characters", response_class=FileResponse)
async def get_characters_html():
    """Serve the characters.html page."""
    return "static/characters.html"

@app.get("/servers", response_class=FileResponse)
async def get_servers_html():
    """Serve the servers.html page."""
    return "static/servers.html"

@app.get("/ai-config", response_class=FileResponse)
async def get_servers_html():
    """Serve the servers.html page."""
    return "static/ai-config.html"

@app.get("/editor", response_class=FileResponse)
async def get_editor_html():
    """Serve the avatar editor page."""
    return "static/editor.html"

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/zahul", include_in_schema=False)
async def zahul_logo():
    return FileResponse("static/favicon.ico")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run FastAPI app with configurable options 🚀"
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind the server")
    parser.add_argument("--port", type=int, default=5666, help="Port to run the server on")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload)