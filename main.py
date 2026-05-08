# main.py
"""Main FastAPI application entry point with first-run database initialization."""

import argparse
import asyncio
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import bcrypt
import httpx
import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

# --- Local Imports ---
from api.routers import characters, servers, config, discord as discord_router, preset, tasks as tasks_router, logs as logs_router, trash as trash_router
from api.routers import users as users_router
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
        "multimodal_ai_model": "google/gemini-pro-vision",
        "panel_password_hint": "",
        "discord_oauth_client_id": "",
        "discord_oauth_client_secret": "",
        "discord_oauth_redirect_uri": "",
        "panel_auth_enabled": False,
        "discord_login_enabled": False,
        "local_login_enabled": True,
        "discord_allowed_usernames": [],
    }
    for key, value in default_config.items():
        db.set_config(key, value)
    
    # Finally, set the initialization flag so this doesn't run again.
    db.set_config("db_initialized", True)
    print("--- Database initialization complete! ---")

# --- Panel Auth ---
PANEL_AUTH_ENABLED = True
SESSION_MAX_AGE_SECONDS = 86400 * 7
DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize"
DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_OAUTH_ME_URL = "https://discord.com/api/users/@me"
DISCORD_OAUTH_SCOPE = "identify"
_oauth_states: dict[str, datetime] = {}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _make_session_expiry() -> datetime:
    return _utc_now() + timedelta(seconds=SESSION_MAX_AGE_SECONDS)


def _cookie_secure(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    # Reverse proxies (e.g. Caddy) may speak HTTP to the app while the client used HTTPS.
    xf = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return xf == "https"


def _is_panel_auth_enabled(db: Database) -> bool:
    return bool(db.get_config("panel_auth_enabled"))


def _super_admin_setup_required(db: Database) -> bool:
    return _is_panel_auth_enabled(db) and db.get_super_admin_account() is None


def _clear_session_cookie(response: Response, request: Request) -> None:
    """
    Remove zahul_session. Emit both Secure variants — mismatch prevents deletion in browsers
    when the cookie was set over HTTP :port vs HTTPS behind a proxy.
    """
    common = {"key": "zahul_session", "path": "/", "httponly": True, "samesite": "lax"}
    response.delete_cookie(**common, secure=False)
    response.delete_cookie(**common, secure=True)


def _unauthenticated_response(request: Request, path: str, *, clear_session_cookie: bool) -> Response:
    """401/redirect to login; optionally strip stale session cookie from the browser."""
    if path.startswith("/api"):
        resp: Response = JSONResponse({"detail": "Not authenticated"}, status_code=401)
    else:
        resp = RedirectResponse(url="/login", status_code=302)
    if clear_session_cookie:
        _clear_session_cookie(resp, request)
    return resp


# --- Auth Middleware ---
class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not PANEL_AUTH_ENABLED:
            return await call_next(request)
        db = Database()
        if not _is_panel_auth_enabled(db):
            return await call_next(request)

        path = request.url.path
        if path.startswith("/login") or path.startswith("/static") or path in (
            "/favicon.ico",
            "/zahul",
            "/logout",
            "/no-access",
            "/api/panel-hint",
            "/api/auth-enabled",
            "/api/auth-status",
            "/api/auth/setup-super-admin",
            "/auth/discord/start",
            "/auth/discord/callback",
        ):
            return await call_next(request)

        db.purge_expired_sessions()
        if _super_admin_setup_required(db):
            if path.startswith("/api"):
                return JSONResponse({"detail": "Super admin account setup required"}, status_code=403)
            return RedirectResponse(url="/login?setup=1", status_code=302)

        raw_token = request.cookies.get("zahul_session")
        token = (raw_token or "").strip() or None
        user = db.get_user_from_session_token(token) if token else None

        if user:
            request.state.auth_user = user
            if user.get("auth_provider") == "discord" and user.get("role") not in {
                "super_admin", "admin", "mod", "guest"
            }:
                allowed_paths = {
                    "/no-access",
                    "/logout",
                    "/api/auth-status",
                    "/api/users/requests",
                    "/api/users/requests/me",
                }
                if path not in allowed_paths:
                    if path.startswith("/api"):
                        return JSONResponse({"detail": "Access request required"}, status_code=403)
                    return RedirectResponse(url="/no-access", status_code=302)
            return await call_next(request)

        return _unauthenticated_response(request, path, clear_session_cookie=bool(token))


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
    Database().purge_expired_sessions()
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
app.include_router(users_router.router)

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

@app.get("/login", response_class=FileResponse, include_in_schema=False)
async def get_login():
    return "static/login.html"

@app.post("/login", include_in_schema=False)
async def post_login(request: Request, username: str = Form(...), password: str = Form(...)):
    db = Database()
    if not bool(db.get_config("local_login_enabled")):
        return RedirectResponse(url="/login?error=method_disabled", status_code=302)
    user = db.get_user_by_username(username.strip())
    if user and user.get("password_hash"):
        if bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
            token = secrets.token_hex(32)
            db.create_session(token, int(user["id"]), _make_session_expiry().isoformat())
            response = RedirectResponse(url="/", status_code=302)
            response.set_cookie(
                "zahul_session",
                token,
                httponly=True,
                secure=_cookie_secure(request),
                samesite="lax",
                max_age=SESSION_MAX_AGE_SECONDS,
            )
            return response
    return RedirectResponse(url="/login?error=1", status_code=302)


@app.post("/api/auth/setup-super-admin", include_in_schema=False)
async def setup_super_admin(payload: dict):
    db = Database()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    if db.get_super_admin_account():
        raise HTTPException(status_code=409, detail="super admin account already exists")
    if db.get_user_by_username(username):
        raise HTTPException(status_code=409, detail="username already exists")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    created_user_id = db.create_local_user(username=username, password_hash=password_hash, role="super_admin")
    db.log_admin("auth.super_admin.created", target=username, actor_user_id=created_user_id, actor_username=username)
    return {"ok": True}


@app.get("/api/auth-status", include_in_schema=False)
async def auth_status(request: Request):
    db = Database()
    oauth_configured = bool(
        (db.get_config("discord_oauth_client_id") or "").strip()
        and (db.get_config("discord_oauth_client_secret") or "").strip()
        and (db.get_config("discord_oauth_redirect_uri") or "").strip()
    )
    raw_token = request.cookies.get("zahul_session")
    token = (raw_token or "").strip() or None
    user = db.get_user_from_session_token(token) if token else None
    payload = {
        "super_admin_setup_required": _super_admin_setup_required(db),
        "discord_login_enabled": bool(db.get_config("discord_login_enabled")),
        "local_login_enabled": bool(db.get_config("local_login_enabled")),
        "panel_auth_enabled": bool(db.get_config("panel_auth_enabled")),
        "discord_oauth_configured": oauth_configured,
        "discord_allowed_usernames": db.get_config("discord_allowed_usernames") or [],
        "current_user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
        } if user else None,
    }
    response = JSONResponse(payload)
    # Allowlisted route: scrub stale cookies here so the UI cannot look "logged in" with a dead session.
    if token and not user:
        _clear_session_cookie(response, request)
    return response


@app.get("/api/auth-super-admin", include_in_schema=False)
async def auth_super_admin():
    super_admin = Database().get_super_admin_account()
    db = Database()
    return {
        "username": super_admin["username"] if super_admin else "",
        "auth_provider": super_admin["auth_provider"] if super_admin else "",
        "has_local_super_admin": db.count_local_super_admins() > 0,
        "local_super_admin_count": db.count_local_super_admins(),
    }


@app.get("/auth/discord/start", include_in_schema=False)
async def discord_oauth_start():
    db = Database()
    if not bool(db.get_config("discord_login_enabled")):
        return RedirectResponse(url="/login?oauth_error=disabled", status_code=302)
    client_id = str(db.get_config("discord_oauth_client_id") or "").strip()
    redirect_uri = str(db.get_config("discord_oauth_redirect_uri") or "").strip()
    if not client_id or not redirect_uri:
        return RedirectResponse(url="/login?oauth_error=config", status_code=302)

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = _utc_now() + timedelta(minutes=10)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": DISCORD_OAUTH_SCOPE,
        "state": state,
        "prompt": "none",
    }
    return RedirectResponse(url=f"{DISCORD_OAUTH_AUTHORIZE_URL}?{urlencode(params)}", status_code=302)


@app.get("/auth/discord/callback", include_in_schema=False)
async def discord_oauth_callback(request: Request, code: str = "", state: str = ""):
    db = Database()
    if not bool(db.get_config("discord_login_enabled")):
        return RedirectResponse(url="/login?oauth_error=disabled", status_code=302)
    expires_at = _oauth_states.pop(state, None)
    if not state or not expires_at or expires_at <= _utc_now():
        return RedirectResponse(url="/login?oauth_error=state", status_code=302)

    client_id = str(db.get_config("discord_oauth_client_id") or "").strip()
    client_secret = str(db.get_config("discord_oauth_client_secret") or "").strip()
    redirect_uri = str(db.get_config("discord_oauth_redirect_uri") or "").strip()
    if not client_id or not client_secret or not redirect_uri or not code:
        return RedirectResponse(url="/login?oauth_error=config", status_code=302)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                DISCORD_OAUTH_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise ValueError("Missing access token")

            me_resp = await client.get(
                DISCORD_OAUTH_ME_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            me_resp.raise_for_status()
            discord_user = me_resp.json()
    except Exception:
        return RedirectResponse(url="/login?oauth_error=exchange", status_code=302)

    discord_id = str(discord_user.get("id") or "")
    discord_username = str(discord_user.get("username") or "").strip()
    discord_avatar_hash = str(discord_user.get("avatar") or "").strip() or None
    if not discord_id or not discord_username:
        return RedirectResponse(url="/login?oauth_error=profile", status_code=302)

    allowed = db.get_config("discord_allowed_usernames") or []
    if allowed and discord_username.lower() not in [u.lower() for u in allowed]:
        return RedirectResponse(url="/login?oauth_error=unauthorized", status_code=302)

    user_id = db.create_or_update_discord_user(
        discord_id=discord_id,
        discord_username=discord_username,
        discord_avatar_hash=discord_avatar_hash,
    )
    if db.get_super_admin_account() is None:
        db._update_record("users", "id", user_id, role="super_admin", updated_at=db._utcnow_iso())
    token = secrets.token_hex(32)
    db.create_session(token, user_id, _make_session_expiry().isoformat())
    user = db.get_user_by_id(user_id)
    target_url = "/"
    if user and user.get("auth_provider") == "discord" and user.get("role") not in {"super_admin", "admin", "mod", "guest"}:
        target_url = "/no-access"
    response = RedirectResponse(url=target_url, status_code=302)
    response.set_cookie(
        "zahul_session",
        token,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        max_age=SESSION_MAX_AGE_SECONDS,
    )
    return response

@app.get("/logout", include_in_schema=False)
async def logout(request: Request):
    token = request.cookies.get("zahul_session")
    if token:
        Database().delete_session(token)
    response = RedirectResponse(url="/login", status_code=302)
    _clear_session_cookie(response, request)
    return response

@app.get("/users", response_class=FileResponse, include_in_schema=False)
async def get_users_html():
    return "static/users.html"


@app.get("/no-access", response_class=FileResponse, include_in_schema=False)
async def get_no_access_html():
    return "static/no-access.html"

@app.get("/api/auth-enabled", include_in_schema=False)
async def auth_enabled():
    if not PANEL_AUTH_ENABLED:
        return {"enabled": False}
    db = Database()
    return {"enabled": _is_panel_auth_enabled(db)}

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