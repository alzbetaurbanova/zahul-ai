# main.py
"""Main FastAPI application entry point with first-run database initialization."""

import argparse
import asyncio
import os
import secrets
import uvicorn
from fastapi import FastAPI, Form, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

# --- Local Imports ---
from api.routers import characters, servers, config, discord as discord_router, preset, tasks as tasks_router, logs as logs_router, trash as trash_router
from api.db.database import Database
from src.plugins.manager import PluginManager

# --- Default Data for First-Time Setup ---

# This is the default prompt template we developed earlier.
DEFAULT_PROMPT_TEMPLATE = """\
[{{character.name}}]
{{character.persona}}
{% if character.instructions %}{{character.instructions}}{% endif %}
[History]
{{history}}
[Reply only as {{character.name}}.]"""

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

    # 1. Create default character (Echo)
    if not db.get_character("Echo"):
        db.create_character(
            name="Echo",
            data={
                "persona": "[Echo's persona: male, artificial intelligence, logical, practical, tech-savvy, calm, direct, speaks like a knowledgeable friend not a textbook, slightly casual but still precise, cuts to the point, doesn't overexplain unnecessarily, motivational, genuinely cares about helping people; Echo's abilities: problem solving, debugging, explaining tech topics in a simple and natural way, giving advice that actually makes sense, encouraging people when they feel stuck or discouraged]\n",
                "instructions": "[System Note: You are Echo, a male AI assistant on a Discord server. You are logical, calm and tech-focused - your strongest area is IT. You talk like a knowledgeable friend, not a manual. Keep it natural and slightly casual - no need to be stiff or overly formal, but don't overdo the friendliness either. Get to the point, give answers that actually make sense, skip unnecessary filler. You genuinely care about helping people - if someone seems stuck or discouraged, be supportive and motivational. Do not push your expertise, just use it when needed.",
                "avatar": "https://i.imgur.com/vACNxh0.png",
                "avatar_source": None,
                "about": "Assistant Type (SFW) | Echo is your tech-savvy assistant. Logical, direct, and speaks like a real person. Motivational when it counts.",
                "temperature": None,
                "history_limit": None,
                "max_tokens": None,

            },
            triggers=["Echo"]
        )
        print("-> Default character 'Echo' created.")

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
        "default_character": "Echo",
        "ai_endpoint": "https://api.groq.com/openai/v1",
        "base_llm": "llama-3.3-70b-versatile",
        "temperature": 0.7,
        "auto_cap": 1,
        "ai_key": "", # User must provide this
        "discord_key": "", # User must provide this
        "history_limit": 10,
        "max_tokens": 256,
        "use_prefill": False,
        "fallback_llm": "llama-3.1-8b-instant",
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

# --- Panel Auth ---
# Set to True to require a password to access the web panel.
# Password is configured via the AI Config panel (panel_password field).
PANEL_AUTH_ENABLED = True

# In-memory session tokens (cleared on restart)
_sessions: set = set()


# --- Auth Middleware ---
class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not PANEL_AUTH_ENABLED:
            return await call_next(request)

        path = request.url.path
        # Always allow login page and static assets
        if path.startswith("/login") or path.startswith("/static") or path in ("/favicon.ico", "/zahul", "/api/panel-hint", "/api/auth-enabled"):
            return await call_next(request)

        # Check session cookie
        token = request.cookies.get("zahul_session")
        if token and token in _sessions:
            return await call_next(request)

        # Check if password is set - if not, skip auth (first-run setup)
        db = Database()
        panel_password = db.get_config("panel_password") or ""
        if not panel_password:
            return await call_next(request)

        # Not authenticated - redirect HTML pages, return 401 for API
        if path.startswith("/api"):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        return RedirectResponse(url="/login", status_code=302)


# --- FastAPI App Setup ---

app = FastAPI(
    title="zahul-ai Configuration API",
    description="API for managing character, channel, and bot configurations",
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(AuthMiddleware)

@app.on_event("startup")
async def startup_event():
    """Run the database initialization when the app starts."""
    await initialize_database()
    from api.db.trash import TrashDB
    TrashDB().purge_old()
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
app.include_router(tasks_router.router)
app.include_router(logs_router.router)
app.include_router(trash_router.router)

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

@app.get("/api/doc", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=f"{app.title} - Swagger UI",
        swagger_js_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
        swagger_favicon_url="/favicon.ico",
        swagger_ui_parameters={
            "docExpansion": "none",
            "defaultModelsExpandDepth": -1,
            "syntaxHighlight": {"theme": "monokai"},
            "customCssUrl": "/static/css/swagger-dark.css",
        },
    )

@app.get("/api/redoc", include_in_schema=False)
async def custom_redoc_html():
    return get_redoc_html(
        openapi_url=app.openapi_url,
        title=f"{app.title} - ReDoc",
        redoc_js_url="https://cdn.jsdelivr.net/npm/redoc@2.2.0/bundles/redoc.standalone.js",
        redoc_favicon_url="/favicon.ico",
    )

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

@app.get("/scheduler", response_class=FileResponse)
async def get_scheduler_html():
    """Serve the scheduler.html page."""
    return "static/scheduler.html"

@app.get("/logs", response_class=FileResponse)
async def get_logs_html():
    return "static/logs.html"

@app.get("/editor", response_class=FileResponse)
async def get_editor_html():
    """Serve the avatar editor page."""
    return "static/editor.html"

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/img/favicon.png")

@app.get("/zahul", include_in_schema=False)
async def zahul_logo():
    return FileResponse("static/img/favicon.png")

# --- Auth Endpoints ---

@app.get("/login", include_in_schema=False)
async def get_login():
    db = Database()
    panel_password = db.get_config("panel_password") or ""
    if not panel_password:
        return RedirectResponse(url="/", status_code=302)
    return FileResponse("static/login.html")

@app.post("/login", include_in_schema=False)
async def post_login(password: str = Form(...)):
    db = Database()
    panel_password = db.get_config("panel_password") or ""
    if panel_password and password == panel_password:
        token = secrets.token_hex(32)
        _sessions.add(token)
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie("zahul_session", token, httponly=True, secure=True, samesite="lax", max_age=86400 * 7)
        return response
    return RedirectResponse(url="/login?error=1", status_code=302)

@app.get("/logout", include_in_schema=False)
async def logout(request: Request):
    token = request.cookies.get("zahul_session")
    _sessions.discard(token)
    response = RedirectResponse(url="/login", status_code=302)
    response.delete_cookie("zahul_session")
    return response

@app.get("/api/auth-enabled", include_in_schema=False)
async def auth_enabled():
    if not PANEL_AUTH_ENABLED:
        return {"enabled": False}
    db = Database()
    panel_password = db.get_config("panel_password") or ""
    return {"enabled": bool(panel_password)}

@app.get("/api/panel-hint", include_in_schema=False)
async def panel_hint():
    db = Database()
    hint = db.get_config("panel_password_hint") or ""
    return {"hint": hint}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run FastAPI app with configurable options 🚀"
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind the server")
    parser.add_argument("--port", type=int, default=5666, help="Port to run the server on")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload, proxy_headers=True, forwarded_allow_ips="*")