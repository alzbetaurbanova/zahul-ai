import sqlite3
import json
import copy
from typing import Any, Optional, Dict, List, Tuple
import os
from datetime import datetime, timezone

from api.db import cache as db_cache

def _get_trash_db():
    from api.db.trash import TrashDB
    return TrashDB()

DB_PATH = os.getenv("DATABASE_URL", "data/bot.db")


def _ensure_db_directory(path: str) -> None:
    if path in (":memory:", "") or path.startswith("file:"):
        return

    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)


class Database:
    """A class to manage all CRUD operations for the bot's SQLite database."""

    def __init__(self, path: str = DB_PATH):
        """Initializes the Database manager."""
        self.db_path = path
        self._init_db()

    def _parse_json_value(self, value: Any) -> Any:
        """
        Parses a value from a JSON column. If it's a string, it's decoded.
        Otherwise, it's assumed to be a valid Python type (int, float, bool).
        """
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                # If it's a string that isn't valid JSON, return it as-is.
                return value
        # If it's not a string (e.g., float, int), return it directly.
        return value

    def _get_connection(self):
        """Returns a new database connection."""
        _ensure_db_directory(self.db_path)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Initializes the database and creates tables if they don't exist."""
        with self._get_connection() as conn:
            # Config
            conn.execute("""
                CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value JSON NOT NULL
                );
            """)
            # Captions
            conn.execute("""
                CREATE TABLE IF NOT EXISTS captions (
                    message_id TEXT PRIMARY KEY,
                    caption TEXT NOT NULL
                );
            """)
            conn.commit()
            # Servers
            conn.execute("""
                CREATE TABLE IF NOT EXISTS servers (
                    server_id TEXT PRIMARY KEY,
                    server_name TEXT NOT NULL,
                    description TEXT,
                    instruction TEXT
                );
            """)
            # Channels
            conn.execute("""
                CREATE TABLE IF NOT EXISTS channels (
                    channel_id TEXT PRIMARY KEY,
                    server_id TEXT NOT NULL,
                    server_name TEXT NOT NULL,
                    data JSON NOT NULL,
                    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                );
            """)
            # Characters
            conn.execute("""
                CREATE TABLE IF NOT EXISTS characters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    data JSON NOT NULL,
                    created_by TEXT
                );
            """)
            # Character Triggers
            conn.execute("""
                CREATE TABLE IF NOT EXISTS character_triggers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    character_id INTEGER NOT NULL,
                    trigger TEXT NOT NULL,
                    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
                );
            """)
            # Presets
            conn.execute("""
                CREATE TABLE IF NOT EXISTS presets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    description TEXT,
                    prompt_template TEXT
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS discord_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    character TEXT,
                    channel_id TEXT,
                    user TEXT,
                    trigger TEXT,
                    response TEXT,
                    model TEXT,
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    conversation_history TEXT,
                    source TEXT DEFAULT 'chat',
                    status TEXT DEFAULT 'ok',
                    error_message TEXT,
                    task_id INTEGER DEFAULT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_discord_logs_ts ON discord_logs(timestamp)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_discord_logs_character ON discord_logs(character)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_discord_logs_channel_id ON discord_logs(channel_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_discord_logs_status ON discord_logs(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_discord_logs_user ON discord_logs(user)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id)")
            # Migrations for existing DBs
            try: conn.execute("ALTER TABLE characters ADD COLUMN created_by TEXT")
            except: pass
            for col, typedef in [("temperature", "REAL"), ("history_count", "INTEGER DEFAULT 0"), ("task_id", "INTEGER DEFAULT NULL"), ("endpoint", "TEXT")]:
                try: conn.execute(f"ALTER TABLE discord_logs ADD COLUMN {col} {typedef}")
                except: pass
            try: conn.execute("ALTER TABLE servers ADD COLUMN config JSON")
            except: pass
            conn.execute("""
                CREATE TABLE IF NOT EXISTS admin_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target TEXT,
                    detail TEXT,
                    actor_user_id INTEGER,
                    actor_username TEXT NOT NULL DEFAULT 'system'
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_admin_logs_ts ON admin_logs(timestamp)")
            for col, typedef in [
                ("actor_user_id", "INTEGER"),
                ("actor_username", "TEXT NOT NULL DEFAULT 'system'"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE admin_logs ADD COLUMN {col} {typedef}")
                except Exception:
                    pass
            conn.execute(
                "UPDATE admin_logs SET actor_username = 'system' WHERE actor_username IS NULL OR TRIM(actor_username) = ''"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT,
                    role TEXT NOT NULL DEFAULT 'user',
                    discord_id TEXT UNIQUE,
                    discord_username TEXT,
                    discord_avatar_hash TEXT,
                    uploaded_avatar_url TEXT,
                    auth_provider TEXT NOT NULL DEFAULT 'local',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            for col, typedef in [
                ("discord_avatar_hash", "TEXT"),
                ("uploaded_avatar_url", "TEXT"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {col} {typedef}")
                except Exception:
                    pass
            # Role rename migration: owner -> super_admin
            try:
                conn.execute("UPDATE users SET role = 'super_admin' WHERE role = 'owner'")
            except Exception:
                pass
            # Discord "user" (no panel role) -> pending — clearer than generic "user"
            try:
                conn.execute(
                    "UPDATE users SET role = 'pending' WHERE role = 'user' AND auth_provider = 'discord'"
                )
            except Exception:
                pass
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    user_agent TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            try:
                conn.execute("ALTER TABLE auth_sessions ADD COLUMN user_agent TEXT")
            except Exception:
                pass
            conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_server_access (
                    user_id INTEGER NOT NULL,
                    server_id TEXT NOT NULL,
                    PRIMARY KEY (user_id, server_id),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS access_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    discord_username TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    requested_at TEXT NOT NULL,
                    reviewed_at TEXT,
                    reviewed_by INTEGER,
                    note TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_access_requests_requested_at ON access_requests(requested_at DESC)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS discord_dm_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    discord_user_id TEXT NOT NULL,
                    message TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_attempt_at TEXT,
                    last_error TEXT
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_discord_dm_queue_pending ON discord_dm_queue(status, id)"
            )
            # Ensure security-related config keys exist with safe defaults for existing DBs
            security_defaults = [
                ("panel_auth_enabled", "false"),
                ("local_login_enabled", "true"),
                ("discord_login_enabled", "false"),
                ("discord_allowed_usernames", "[]"),
                ("panel_password_hint", '""'),
                ("discord_oauth_client_id", '""'),
                ("discord_oauth_client_secret", '""'),
                ("discord_oauth_redirect_uri", '""'),
            ]
            for key, val in security_defaults:
                conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", (key, val))
            conn.commit()
        self._cleanup_mislinked_scheduler_channels()
        try:
            self.migrate_sensitive_config()
        except Exception as e:
            import logging
            logging.warning(f"Config encryption migration skipped: {e}")

    def _cleanup_mislinked_scheduler_channels(self):
        """Remove auto-linked legacy scheduler channels (wrong server attribution)."""
        with self._get_connection() as conn:
            rows = conn.execute("SELECT channel_id, data FROM channels").fetchall()
            for row in rows:
                data = self._parse_json_value(row["data"])
                if isinstance(data, dict) and data.get("legacy_scheduler"):
                    conn.execute("DELETE FROM channels WHERE channel_id = ?", (row["channel_id"],))
            conn.commit()

    def log_matches_server_scope(self, channel_id: str, server_ids: List[str]) -> bool:
        if not server_ids:
            return False
        raw = channel_id[8:] if channel_id.startswith("channel:") else channel_id
        ph = ",".join("?" * len(server_ids))
        with self._get_connection() as conn:
            row = conn.execute(
                f"""
                SELECT 1 FROM channels c
                WHERE c.server_id IN ({ph})
                AND (c.channel_id = ? OR c.channel_id = ?)
                LIMIT 1
                """,
                server_ids + [channel_id, raw],
            ).fetchone()
        return row is not None

    @staticmethod
    def _discord_log_on_servers_sql(server_ids: List[str], table_alias: str = "") -> Tuple[str, List[str]]:
        prefix = f"{table_alias}." if table_alias else ""
        ph = ",".join("?" * len(server_ids))
        clause = f"""EXISTS (
            SELECT 1 FROM channels c
            WHERE c.server_id IN ({ph})
            AND (
                c.channel_id = {prefix}channel_id
                OR c.channel_id = CASE
                    WHEN {prefix}channel_id LIKE 'channel:%' THEN substr({prefix}channel_id, 9)
                    ELSE {prefix}channel_id
                END
            )
        )"""
        return clause, list(server_ids)

    # ------------------------------------------------------
    # Helper for dynamic updates
    # ------------------------------------------------------
    def _update_record(self, table_name: str, identifier_col: str, identifier_val: Any, **kwargs):
        """Generic helper to update any record in any table."""
        if not kwargs:
            return # Nothing to update
        # JSON fields need to be dumped to string
        for key, value in kwargs.items():
            if isinstance(value, (dict, list)):
                kwargs[key] = json.dumps(value)
        
        fields = ", ".join([f"{key} = ?" for key in kwargs.keys()])
        values = tuple(kwargs.values()) + (identifier_val,)
        
        with self._get_connection() as conn:
            query = f"UPDATE {table_name} SET {fields} WHERE {identifier_col} = ?"
            conn.execute(query, values)
            conn.commit()

    # ------------------------------------------------------
    # Config (Key-Value Store)
    # ------------------------------------------------------
    def _encrypt_config_value(self, key: str, value: Any) -> Any:
        from api.utils.crypto import SENSITIVE_KEYS, encrypt, encrypt_providers
        if key in SENSITIVE_KEYS and isinstance(value, str):
            return encrypt(value)
        if key == "multimodal_providers" and isinstance(value, list):
            return encrypt_providers(value)
        return value

    def _decrypt_config_value(self, key: str, value: Any) -> Any:
        from api.utils.crypto import SENSITIVE_KEYS, decrypt, decrypt_providers
        if key in SENSITIVE_KEYS and isinstance(value, str):
            return decrypt(value)
        if key == "multimodal_providers" and isinstance(value, list):
            return decrypt_providers(value)
        return value

    def set_config(self, key: str, value: Any):
        """Create or update a configuration key-value pair."""
        value = self._encrypt_config_value(key, value)
        with self._get_connection() as conn:
            conn.execute("REPLACE INTO config (key, value) VALUES (?, ?)", (key, json.dumps(value)))
            conn.commit()
        db_cache.invalidate_config()

    def set_configs_bulk(self, items: Dict[str, Any]):
        """Write multiple config key-value pairs in a single transaction."""
        if not items:
            return
        encrypted = {k: self._encrypt_config_value(k, v) for k, v in items.items()}
        with self._get_connection() as conn:
            conn.executemany(
                "REPLACE INTO config (key, value) VALUES (?, ?)",
                [(k, json.dumps(v)) for k, v in encrypted.items()]
            )
            conn.commit()
        db_cache.invalidate_config()

    def get_config(self, key: str) -> Optional[Any]:
        """Read a configuration value by its key."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
            if not row:
                return None
            value = self._parse_json_value(row["value"])
            return self._decrypt_config_value(key, value)

    def list_configs(self) -> Dict[str, Any]:
        """List all configuration key-value pairs (cached reads; invalidated on write)."""
        return db_cache.get_cached_config(self._list_configs_uncached)

    def _list_configs_uncached(self) -> Dict[str, Any]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT key, value FROM config").fetchall()
            return {
                row["key"]: self._decrypt_config_value(row["key"], self._parse_json_value(row["value"]))
                for row in rows
            }

    def migrate_sensitive_config(self):
        """Re-encrypt any plaintext sensitive config values (run once on startup)."""
        from api.utils.crypto import SENSITIVE_KEYS, is_encrypted, encrypt, encrypt_providers
        with self._get_connection() as conn:
            rows = conn.execute("SELECT key, value FROM config").fetchall()
            for row in rows:
                key = row["key"]
                if key not in SENSITIVE_KEYS and key != "multimodal_providers":
                    continue
                raw = self._parse_json_value(row["value"])
                if key in SENSITIVE_KEYS and isinstance(raw, str) and raw and not is_encrypted(raw):
                    conn.execute("REPLACE INTO config (key, value) VALUES (?, ?)",
                                 (key, json.dumps(encrypt(raw))))
                elif key == "multimodal_providers" and isinstance(raw, list):
                    needs_enc = any(p.get("api_key") and not is_encrypted(p["api_key"]) for p in raw)
                    if needs_enc:
                        conn.execute("REPLACE INTO config (key, value) VALUES (?, ?)",
                                     (key, json.dumps(encrypt_providers(raw))))
            conn.commit()
        db_cache.invalidate_config()

    def delete_config(self, key: str):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM config WHERE key = ?", (key,))
            conn.commit()
        db_cache.invalidate_config()

    # ------------------------------------------------------
    # Servers
    # ------------------------------------------------------
    def create_server(self, server_id: str, server_name: str, description: Optional[str] = None, instruction: Optional[str] = None):
        """Create a new server record."""
        with self._get_connection() as conn:
            conn.execute("INSERT INTO servers (server_id, server_name, description, instruction) VALUES (?, ?, ?, ?)",
                         (server_id, server_name, description, instruction))
            conn.commit()

    def get_server(self, server_id: str) -> Optional[Dict[str, Any]]:
        """Read a server's data by its ID."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM servers WHERE server_id = ?", (server_id,)).fetchone()
            if not row:
                return None
            result = dict(row)
            result['config'] = self._parse_json_value(result.get('config')) or {}
            return result
            
    def update_server(self, server_id: str, **kwargs):
        """Update a server's data (e.g., server_name, description)."""
        self._update_record("servers", "server_id", server_id, **kwargs)

    def delete_server(self, server_id: str):
        """Delete a server and its associated channels."""
        server = self.get_server(server_id)
        if server:
            server['channels'] = self.list_channels_for_server(server_id)
            _get_trash_db().move_to_trash("servers", server_id, server)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM servers WHERE server_id = ?", (server_id,))
            conn.commit()

    def list_servers(self) -> List[Dict[str, Any]]:
        """List all servers."""
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM servers").fetchall()
            results = []
            for row in rows:
                r = dict(row)
                r['config'] = self._parse_json_value(r.get('config')) or {}
                results.append(r)
            return results

    def get_server_config(self, server_id: str) -> Dict[str, Any]:
        """Return per-server config overrides (empty dict if none set)."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT config FROM servers WHERE server_id = ?", (server_id,)).fetchone()
            if row and row["config"]:
                return self._parse_json_value(row["config"]) or {}
            return {}

    def set_server_config(self, server_id: str, config: Dict[str, Any]):
        """Persist per-server config overrides."""
        with self._get_connection() as conn:
            conn.execute("UPDATE servers SET config = ? WHERE server_id = ?", (json.dumps(config), server_id))
            conn.commit()
        db_cache.invalidate_config()

    def clear_server_config(self, server_id: str):
        """Remove all per-server config overrides (reset to global defaults)."""
        with self._get_connection() as conn:
            conn.execute("UPDATE servers SET config = NULL WHERE server_id = ?", (server_id,))
            conn.commit()
        db_cache.invalidate_config()

    # ------------------------------------------------------
    # Channels
    # ------------------------------------------------------
    def create_channel(self, channel_id: str, server_id: str, server_name: str, data: Dict[str, Any]):
        """Create a new channel record."""
        with self._get_connection() as conn:
            conn.execute("INSERT INTO channels (channel_id, server_id, server_name, data) VALUES (?, ?, ?, ?)",
                         (channel_id, server_id, server_name, json.dumps(data)))
            conn.commit()
        db_cache.invalidate_channels()
    
    def get_channel(self, channel_id: str) -> Optional[Dict[str, Any]]:
        """Read a channel's data by its ID (cached reads; invalidated on write)."""
        return db_cache.get_cached_channel(channel_id, lambda: self._get_channel_uncached(channel_id))

    def _get_channel_uncached(self, channel_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM channels WHERE channel_id = ?", (channel_id,)).fetchone()
            if not row:
                return None
            channel = dict(row)
            channel['data'] = json.loads(channel['data'])
            return channel
            
    def update_channel(self, channel_id: str, **kwargs):
        """Update a channel's data (e.g., server_name, data)."""
        self._update_record("channels", "channel_id", channel_id, **kwargs)
        db_cache.invalidate_channels(channel_id)

    def delete_channel(self, channel_id: str):
        """Delete a channel record."""
        channel = self.get_channel(channel_id)
        if channel:
            _get_trash_db().move_to_trash("channels", channel_id, channel)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM channels WHERE channel_id = ?", (channel_id,))
            conn.commit()
        db_cache.invalidate_channels(channel_id)

    def list_channels(self) -> List[Dict[str, Any]]:
        """List all channels across all servers."""
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM channels").fetchall()
            channels = []
            for row in rows:
                channel = dict(row)
                channel['data'] = json.loads(channel['data'])
                channels.append(channel)
            return channels

    def list_channel_options(self, allowed_server_ids: Optional[List[str]] = None) -> List[Dict[str, str]]:
        """Lightweight channel list for scheduler target combobox (one query)."""
        conditions = ["server_id != ?"]
        params: List[Any] = ["DM_VIRTUAL_SERVER"]
        if allowed_server_ids is not None:
            if not allowed_server_ids:
                return []
            ph = ",".join("?" * len(allowed_server_ids))
            conditions.append(f"server_id IN ({ph})")
            params.extend(allowed_server_ids)
        where = " AND ".join(conditions)
        with self._get_connection() as conn:
            rows = conn.execute(
                f"SELECT channel_id, server_id, server_name, data FROM channels WHERE {where} "
                "ORDER BY server_name, channel_id",
                params,
            ).fetchall()
        options = []
        for row in rows:
            data = self._parse_json_value(row["data"]) if isinstance(row["data"], str) else row["data"]
            name = data.get("name", row["channel_id"]) if isinstance(data, dict) else row["channel_id"]
            options.append({
                "id": row["channel_id"],
                "label": f"#{name}",
                "sub": row["server_name"] or "",
                "server_id": row["server_id"],
            })
        return options
        
    def list_channels_for_server(self, server_id: str) -> List[Dict[str, Any]]:
        """List all channels for a specific server by its ID."""
        with self._get_connection() as conn:
            # Use a WHERE clause to filter by server_id
            rows = conn.execute("SELECT * FROM channels WHERE server_id = ?", (server_id,)).fetchall()
            channels = []
            for row in rows:
                channel = dict(row)
                # The 'data' column is a JSON string, so we need to parse it
                channel['data'] = json.loads(channel['data'])
                channels.append(channel)
            return channels

    def get_channel_ids_for_servers(self, server_ids: List[str]) -> List[str]:
        if not server_ids:
            return []
        ph = ",".join("?" * len(server_ids))
        with self._get_connection() as conn:
            rows = conn.execute(
                f"SELECT channel_id FROM channels WHERE server_id IN ({ph})", server_ids
            ).fetchall()
        return [r["channel_id"] for r in rows]

    def list_whitelist_names_by_server_ids(self, server_ids: List[str]) -> Dict[str, List[str]]:
        """Aggregate unique whitelist character names per server (one query)."""
        if not server_ids:
            return {}
        ph = ",".join("?" * len(server_ids))
        names_by_server: Dict[str, set] = {sid: set() for sid in server_ids}
        with self._get_connection() as conn:
            rows = conn.execute(
                f"SELECT server_id, data FROM channels WHERE server_id IN ({ph})",
                server_ids,
            ).fetchall()
        for row in rows:
            data = self._parse_json_value(row["data"])
            if isinstance(data, dict):
                for name in data.get("whitelist") or []:
                    names_by_server.setdefault(row["server_id"], set()).add(name)
        return {sid: sorted(names_by_server.get(sid, set())) for sid in server_ids}

    # ------------------------------------------------------
    # Characters & Triggers
    # ------------------------------------------------------
    def create_character(self, name: str, data: Dict[str, Any], triggers: Optional[List[str]] = None, created_by: Optional[str] = None) -> int:
        """Create a new character and optionally add its trigger words."""
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("INSERT INTO characters (name, data, created_by) VALUES (?, ?, ?)", (name, json.dumps(data), created_by))
            char_id = cur.lastrowid
            if triggers:
                trigger_data = [(char_id, trigger) for trigger in triggers]
                cur.executemany("INSERT INTO character_triggers (character_id, trigger) VALUES (?, ?)", trigger_data)
            conn.commit()
            db_cache.invalidate_characters()
            return char_id

    def get_character(self, name: str) -> Optional[Dict[str, Any]]:
        """Read a character's data and triggers by name."""
        char = self.get_character_map_by_name().get(name)
        return copy.deepcopy(char) if char else None

    def get_character_map_by_name(self) -> Dict[str, Dict[str, Any]]:
        return db_cache.get_character_map(self._load_characters_uncached)

    def _load_characters_uncached(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            chars = [dict(row) for row in conn.execute(
                "SELECT id, name, data, created_by FROM characters"
            ).fetchall()]
            if not chars:
                return []
            char_ids = [c["id"] for c in chars]
            ph = ",".join("?" * len(char_ids))
            trigger_rows = conn.execute(
                f"SELECT character_id, trigger FROM character_triggers WHERE character_id IN ({ph})",
                char_ids,
            ).fetchall()
            triggers_by_id: Dict[int, List[str]] = {}
            for tr in trigger_rows:
                triggers_by_id.setdefault(tr["character_id"], []).append(tr["trigger"])
            out: List[Dict[str, Any]] = []
            for char in chars:
                out.append({
                    "id": char["id"],
                    "name": char["name"],
                    "data": json.loads(char["data"]),
                    "triggers": triggers_by_id.get(char["id"], []),
                    "created_by": char["created_by"],
                })
            return out

    def update_character(self, name: str, **kwargs):
        """Update a character's data (e.g., data)."""
        self._update_record("characters", "name", name, **kwargs)
        db_cache.invalidate_characters()

    def delete_character(self, name: str):
        """Delete a character and its associated triggers."""
        char = self.get_character(name)
        if char:
            _get_trash_db().move_to_trash("characters", str(char['id']), char)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM characters WHERE name = ?", (name,))
            conn.commit()
        db_cache.invalidate_characters()

    def list_characters(self) -> List[Dict[str, Any]]:
        """List all characters with their data and triggers (2 queries; cached reads)."""
        return db_cache.get_cached_characters(self._load_characters_uncached)
    
    def get_character_by_id(self, char_id: int, *, fresh: bool = False) -> Optional[Dict[str, Any]]:
        """Read a character's data and triggers by ID. Use fresh=True after writes."""
        if not fresh:
            for char in self.list_characters():
                if char["id"] == char_id:
                    return copy.deepcopy(char)
        return self._get_character_by_id_uncached(char_id)

    def _get_character_by_id_uncached(self, char_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT id, name, data, created_by FROM characters WHERE id = ?",
                (char_id,),
            ).fetchone()
            if not row:
                return None
            triggers = [
                r["trigger"]
                for r in conn.execute(
                    "SELECT trigger FROM character_triggers WHERE character_id = ?",
                    (char_id,),
                ).fetchall()
            ]
            return {
                "id": row["id"],
                "name": row["name"],
                "data": json.loads(row["data"]),
                "triggers": triggers,
                "created_by": row["created_by"],
            }

    def update_character_by_id(self, char_id: int, name: Optional[str] = None, data: Optional[Dict[str, Any]] = None):
        """Update a character by ID. Optionally update name and/or data."""
        kwargs = {}
        if name is not None:
            kwargs['name'] = name
        if data is not None:
            kwargs['data'] = data
        if kwargs:
            self._update_record("characters", "id", char_id, **kwargs)

    def delete_character_by_id(self, char_id: int):
        """Delete a character by ID."""
        char = self.get_character_by_id(char_id)
        if char:
            _get_trash_db().move_to_trash("characters", str(char_id), char)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM characters WHERE id = ?", (char_id,))
            conn.commit()
        db_cache.invalidate_characters()

    def update_character_triggers(self, character_id: int, triggers: List[str], *, invalidate_cache: bool = True):
        """
        Replaces all triggers for a given character.
        Deletes existing triggers and inserts the new list.
        """
        with self._get_connection() as conn:
            cur = conn.cursor()
            # Delete old triggers first
            cur.execute("DELETE FROM character_triggers WHERE character_id = ?", (character_id,))
            # Insert new ones if any are provided
            if triggers:
                trigger_data = [(character_id, trigger) for trigger in triggers]
                cur.executemany("INSERT INTO character_triggers (character_id, trigger) VALUES (?, ?)", trigger_data)
            conn.commit()
        if invalidate_cache:
            db_cache.invalidate_characters()

    # ------------------------------------------------------
    # Presets
    # ------------------------------------------------------
    def create_preset(self, name: str, description: str, prompt_template: str) -> int:
        """Create a new preset."""
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("INSERT INTO presets (name, description, prompt_template) VALUES (?, ?, ?)", (name, description, prompt_template))
            conn.commit()
            return cur.lastrowid

    def get_preset(self, name: str) -> Optional[Dict[str, Any]]:
        """Read a preset by its unique name."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM presets WHERE name = ?", (name,)).fetchone()
            return dict(row) if row else None
            
    def update_preset(self, name: str, **kwargs):
        """Update a preset's data (e.g., description, prompt_template)."""
        self._update_record("presets", "name", name, **kwargs)

    def delete_preset(self, name: str):
        """Delete a preset by its name."""
        preset = self.get_preset(name)
        if preset:
            _get_trash_db().move_to_trash("presets", str(preset['id']), preset)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM presets WHERE name = ?", (name,))
            conn.commit()

    def list_presets(self) -> List[Dict[str, Any]]:
        """List all available presets."""
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM presets").fetchall()
            return [dict(row) for row in rows]
        
    def get_caption(self, message_id: str) -> Optional[str]:
        """Read a caption for a given message ID."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT caption FROM captions WHERE message_id = ?", (message_id,)).fetchone()
            return row['caption'] if row else None

    def set_caption(self, message_id: str, caption: str):
        """Create or update a caption for a message ID."""
        with self._get_connection() as conn:
            conn.execute("REPLACE INTO captions (message_id, caption) VALUES (?, ?)", (message_id, caption))
            conn.commit()

    def delete_caption(self, message_id: str):
        """Delete a caption for a message ID."""
        with self._get_connection() as conn:
            conn.execute("DELETE FROM captions WHERE message_id = ?", (message_id,))
            conn.commit()

    # ------------------------------------------------------
    # Scheduled Tasks
    # ------------------------------------------------------
    def _ensure_scheduled_tasks_table(self):
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    character TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    instructions TEXT,
                    scheduled_time TEXT,
                    repeat_pattern JSON,
                    status TEXT NOT NULL DEFAULT 'upcoming',
                    message_mode TEXT NOT NULL DEFAULT 'exact',
                    history_limit INTEGER,
                    created_at TEXT NOT NULL
                );
            """)
            # Add columns if they don't exist yet (existing tables)
            for col_sql in [
                "ALTER TABLE scheduled_tasks ADD COLUMN message_mode TEXT NOT NULL DEFAULT 'exact'",
                "ALTER TABLE scheduled_tasks ADD COLUMN history_limit INTEGER",
                "ALTER TABLE scheduled_tasks ADD COLUMN error_message TEXT",
            ]:
                try:
                    conn.execute(col_sql)
                except Exception:
                    pass
            conn.commit()

    def _parse_task_row(self, row) -> Dict[str, Any]:
        task = dict(row)
        if task.get('repeat_pattern'):
            task['repeat_pattern'] = self._parse_json_value(task['repeat_pattern'])
        if task.get('message_mode') is None:
            task['message_mode'] = 'exact'
        # Ensure created_at exists
        if not task.get('created_at'):
            from datetime import datetime, timezone
            task['created_at'] = datetime.now(timezone.utc).isoformat()
        return task

    def create_task(self, type: str, name: str, character: str, target_type: str,
                    target_id: str, instructions: Optional[str] = None,
                    scheduled_time: Optional[str] = None,
                    repeat_pattern: Optional[Dict[str, Any]] = None,
                    status: str = 'upcoming',
                    message_mode: str = 'exact',
                    history_limit: Optional[int] = None) -> int:
        self._ensure_scheduled_tasks_table()
        from datetime import datetime, timezone
        created_at = datetime.now(timezone.utc).isoformat()
        rp = json.dumps(repeat_pattern) if repeat_pattern else None
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO scheduled_tasks (type, name, character, target_type, target_id, instructions, scheduled_time, repeat_pattern, status, message_mode, history_limit, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (type, name, character, target_type, target_id, instructions, scheduled_time, rp, status, message_mode, history_limit, created_at)
            )
            conn.commit()
            return cur.lastrowid

    def get_task(self, task_id: int) -> Optional[Dict[str, Any]]:
        self._ensure_scheduled_tasks_table()
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
            return self._parse_task_row(row) if row else None

    def list_tasks(self, type: Optional[str] = None, status=None) -> List[Dict[str, Any]]:
        items, _ = self.list_tasks_page(type=type, status=status, offset=0, limit=10_000_000)
        return items

    def list_tasks_page(
        self,
        *,
        type: Optional[str] = None,
        status=None,
        character_contains: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        server_id: Optional[str] = None,
        allowed_server_ids: Optional[List[str]] = None,
        offset: int = 0,
        limit: int = 25,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Paginated task list with optional filters (used by scheduler UI)."""
        self._ensure_scheduled_tasks_table()
        conditions = ["1=1"]
        params: List[Any] = []

        if type:
            conditions.append("type = ?")
            params.append(type)
        if status:
            vals = status if isinstance(status, list) else [status]
            if vals:
                conditions.append(f"status IN ({','.join('?' * len(vals))})")
                params.extend(vals)
        if character_contains:
            conditions.append("LOWER(character) LIKE ?")
            params.append(f"%{character_contains.strip().lower()}%")
        if date_from:
            conditions.append(
                "date(COALESCE(NULLIF(substr(scheduled_time, 1, 10), ''), substr(created_at, 1, 10))) >= date(?)"
            )
            params.append(date_from)
        if date_to:
            conditions.append(
                "date(COALESCE(NULLIF(substr(scheduled_time, 1, 10), ''), substr(created_at, 1, 10))) <= date(?)"
            )
            params.append(date_to)
        if server_id:
            conditions.append("target_type = 'channel'")
            conditions.append("target_id IN (SELECT channel_id FROM channels WHERE server_id = ?)")
            params.append(server_id)
        if allowed_server_ids is not None:
            if not allowed_server_ids:
                conditions.append("1=0")
            else:
                ph = ",".join("?" * len(allowed_server_ids))
                conditions.append(
                    f"(target_type = 'channel' AND target_id IN "
                    f"(SELECT channel_id FROM channels WHERE server_id IN ({ph})))"
                )
                params.extend(allowed_server_ids)

        where_sql = " AND ".join(conditions)
        with self._get_connection() as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS n FROM scheduled_tasks WHERE {where_sql}",
                params,
            ).fetchone()
            total = int(count_row["n"]) if count_row else 0
            rows = conn.execute(
                f"SELECT * FROM scheduled_tasks WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                params + [limit, offset],
            ).fetchall()
            return [self._parse_task_row(r) for r in rows], total

    def list_due_reminders(self, now_iso: str) -> List[Dict[str, Any]]:
        """Return upcoming reminders whose scheduled_time is at or before now_iso."""
        self._ensure_scheduled_tasks_table()
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM scheduled_tasks WHERE type = 'reminder' AND status = 'upcoming' AND scheduled_time <= ?",
                (now_iso,)
            ).fetchall()
            return [self._parse_task_row(r) for r in rows]

    def list_active_schedules(self) -> List[Dict[str, Any]]:
        """Return all active schedule tasks."""
        return self.list_tasks(type='schedule', status='active')

    def update_task(self, task_id: int, **kwargs):
        self._ensure_scheduled_tasks_table()
        self._update_record("scheduled_tasks", "id", task_id, **kwargs)

    def delete_task(self, task_id: int):
        self._ensure_scheduled_tasks_table()
        task = self.get_task(task_id)
        if task:
            _get_trash_db().move_to_trash("scheduled_tasks", str(task_id), task)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
            conn.commit()

    def delete_discord_log(self, log_id: int):
        log = self.get_discord_log(log_id)
        if log:
            _get_trash_db().move_to_trash("discord_logs", str(log_id), log)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM discord_logs WHERE id = ?", (log_id,))
            conn.commit()

    def delete_discord_logs_bulk(self, log_ids: list[int]) -> int:
        if not log_ids:
            return 0
        trash = _get_trash_db()
        with self._get_connection() as conn:
            placeholders = ",".join("?" * len(log_ids))
            rows = conn.execute(f"SELECT * FROM discord_logs WHERE id IN ({placeholders})", log_ids).fetchall()
            for row in rows:
                trash.move_to_trash("discord_logs", str(row["id"]), dict(row))
            result = conn.execute(f"DELETE FROM discord_logs WHERE id IN ({placeholders})", log_ids)
            conn.commit()
            return result.rowcount

    # ------------------------------------------------------
    # Logs
    # ------------------------------------------------------

    def log_discord(self, character: str, channel_id: str, user: str, trigger: str, response: str,
                    model: str, input_tokens: int, output_tokens: int, conversation_history,
                    source: str = 'chat', status: str = 'ok', error_message: str = None,
                    temperature: float = None, history_count: int = 0, task_id: int = None,
                    endpoint: str = None):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        ts = datetime.now(ZoneInfo("Europe/Bratislava")).strftime("%Y-%m-%dT%H:%M:%S")
        history_json = json.dumps(conversation_history) if conversation_history is not None else None
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO discord_logs
                (timestamp, character, channel_id, user, trigger, response, model,
                 input_tokens, output_tokens, conversation_history, source, status, error_message,
                 temperature, history_count, task_id, endpoint)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (ts, character, channel_id, user, trigger, response, model,
                  input_tokens, output_tokens, history_json, source, status, error_message,
                  temperature, history_count, task_id, endpoint))
            conn.commit()

    def log_admin(
        self,
        action: str,
        target: str = None,
        detail: str = None,
        *,
        actor: Optional[Dict[str, Any]] = None,
        actor_user_id: Optional[int] = None,
        actor_username: Optional[str] = None,
    ):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        ts = datetime.now(ZoneInfo("Europe/Bratislava")).strftime("%Y-%m-%dT%H:%M:%S")
        resolved_actor_id = actor_user_id
        resolved_actor_username = (actor_username or "").strip()
        if actor:
            if resolved_actor_id is None:
                actor_id = actor.get("id")
                if actor_id is not None:
                    try:
                        resolved_actor_id = int(actor_id)
                    except (TypeError, ValueError):
                        resolved_actor_id = None
            if not resolved_actor_username:
                resolved_actor_username = str(actor.get("username") or "").strip()
        if not resolved_actor_username:
            resolved_actor_username = "system"
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO admin_logs (timestamp, action, target, detail, actor_user_id, actor_username) VALUES (?,?,?,?,?,?)",
                (ts, action, target, detail, resolved_actor_id, resolved_actor_username)
            )
            conn.commit()

    def list_discord_logs(self, page: int = 1, limit: int = 50, **filters) -> Dict:
        conditions, params = [], []
        if filters.get('from_date'): conditions.append("timestamp >= ?"); params.append(filters['from_date'])
        if filters.get('to_date'): conditions.append("timestamp <= ?"); params.append(filters['to_date'] + 'T23:59:59')
        if filters.get('character'): conditions.append("character = ?"); params.append(filters['character'])
        if filters.get('channel_id'): conditions.append("channel_id = ?"); params.append(filters['channel_id'])
        if filters.get('user'): conditions.append("user = ?"); params.append(filters['user'])
        if filters.get('model'): conditions.append("model = ?"); params.append(filters['model'])
        if filters.get('source'):
            vals = filters['source'] if isinstance(filters['source'], list) else [filters['source']]
            conditions.append(f"source IN ({','.join('?'*len(vals))})"); params.extend(vals)
        if filters.get('status'):
            vals = filters['status'] if isinstance(filters['status'], list) else [filters['status']]
            conditions.append(f"status IN ({','.join('?'*len(vals))})"); params.extend(vals)
        if filters.get('task_id'): conditions.append("task_id = ?"); params.append(int(filters['task_id']))
        if filters.get('server_ids') is not None:
            sids = filters['server_ids']
            if not sids:
                conditions.append("1=0")
            else:
                clause, clause_params = self._discord_log_on_servers_sql(sids, table_alias="dl")
                conditions.append(clause)
                params.extend(clause_params)
        elif filters.get('channel_ids') is not None:
            vals = filters['channel_ids']
            if not vals:
                conditions.append("1=0")
            else:
                match_vals = []
                seen = set()
                for cid in vals:
                    raw = cid[8:] if isinstance(cid, str) and cid.startswith("channel:") else cid
                    for v in (cid, raw, f"channel:{raw}"):
                        if v and v not in seen:
                            seen.add(v)
                            match_vals.append(v)
                conditions.append(f"channel_id IN ({','.join('?' * len(match_vals))})")
                params.extend(match_vals)
        from_table = "discord_logs dl"
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        offset = (page - 1) * limit
        with self._get_connection() as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM {from_table} {where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT dl.id,dl.timestamp,dl.character,dl.channel_id,dl.user,dl.trigger,dl.response,dl.model,dl.input_tokens,dl.output_tokens,dl.source,dl.status,dl.error_message,dl.temperature,dl.history_count,dl.task_id,dl.endpoint FROM {from_table} {where} ORDER BY dl.timestamp DESC LIMIT ? OFFSET ?",
                params + [limit, offset]
            ).fetchall()
        return {"total": total, "page": page, "limit": limit, "items": [dict(r) for r in rows]}

    def get_discord_log(self, log_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM discord_logs WHERE id = ?", (log_id,)).fetchone()
        if not row: return None
        d = dict(row)
        if d.get('conversation_history'):
            try: d['conversation_history'] = json.loads(d['conversation_history'])
            except: pass
        return d

    def get_admin_log(self, log_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM admin_logs WHERE id = ?", (log_id,)).fetchone()
        return dict(row) if row else None

    def delete_admin_log(self, log_id: int):
        log = self.get_admin_log(log_id)
        if log:
            _get_trash_db().move_to_trash("admin_logs", str(log_id), log)
        with self._get_connection() as conn:
            conn.execute("DELETE FROM admin_logs WHERE id = ?", (log_id,))
            conn.commit()

    def delete_admin_logs_bulk(self, log_ids: list[int]) -> int:
        if not log_ids:
            return 0
        trash = _get_trash_db()
        with self._get_connection() as conn:
            placeholders = ",".join("?" * len(log_ids))
            rows = conn.execute(f"SELECT * FROM admin_logs WHERE id IN ({placeholders})", log_ids).fetchall()
            for row in rows:
                trash.move_to_trash("admin_logs", str(row["id"]), dict(row))
            result = conn.execute(f"DELETE FROM admin_logs WHERE id IN ({placeholders})", log_ids)
            conn.commit()
            return result.rowcount

    def list_admin_logs(self, page: int = 1, limit: int = 50, **filters) -> Dict:
        conditions, params = [], []
        if filters.get('from_date'): conditions.append("timestamp >= ?"); params.append(filters['from_date'])
        if filters.get('to_date'): conditions.append("timestamp <= ?"); params.append(filters['to_date'] + 'T23:59:59')
        if filters.get('user'):
            user_value = str(filters['user']).strip()
            if user_value:
                if user_value.isdigit():
                    conditions.append("(actor_username = ? OR actor_user_id = ?)")
                    params.extend([user_value, int(user_value)])
                else:
                    conditions.append("actor_username = ?")
                    params.append(user_value)
        if filters.get('action'):
            vals = filters['action'] if isinstance(filters['action'], list) else [filters['action']]
            conditions.append(f"action IN ({','.join('?'*len(vals))})"); params.extend(vals)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        offset = (page - 1) * limit
        with self._get_connection() as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM admin_logs {where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM admin_logs {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                params + [limit, offset]
            ).fetchall()
        return {"total": total, "page": page, "limit": limit, "items": [dict(r) for r in rows]}

    def list_logs_meta(
        self,
        channel_ids: Optional[List[str]] = None,
        server_ids: Optional[List[str]] = None,
    ) -> Dict:
        log_extra, log_params = "", []
        if server_ids is not None:
            if not server_ids:
                return {"characters": [], "users": [], "admin_users": [], "channels": {}}
            scope_clause, log_params = self._discord_log_on_servers_sql(server_ids, table_alias="dl")
            log_extra = f" AND {scope_clause}"
        elif channel_ids is not None:
            if not channel_ids:
                return {"characters": [], "users": [], "admin_users": [], "channels": {}}
            ph = ",".join("?" * len(channel_ids))
            log_extra = f" AND channel_id IN ({ph})"
            log_params = list(channel_ids)
        with self._get_connection() as conn:
            characters = [r[0] for r in conn.execute(
                f"SELECT DISTINCT dl.character FROM discord_logs dl WHERE dl.character IS NOT NULL{log_extra} ORDER BY dl.character",
                log_params,
            ).fetchall()]
            users = [r[0] for r in conn.execute(
                f"SELECT DISTINCT dl.user FROM discord_logs dl WHERE dl.user IS NOT NULL AND dl.user != 'system'{log_extra} ORDER BY dl.user",
                log_params,
            ).fetchall()]
            admin_users = [r[0] for r in conn.execute(
                "SELECT DISTINCT actor_username FROM admin_logs WHERE actor_username IS NOT NULL AND TRIM(actor_username) != '' ORDER BY actor_username"
            ).fetchall()]
            if server_ids is not None:
                ch_ph = ",".join("?" * len(server_ids))
                channel_rows = conn.execute(
                    f"SELECT channel_id, server_name, data FROM channels WHERE server_id IN ({ch_ph})",
                    server_ids,
                ).fetchall()
            elif channel_ids is not None:
                ch_ph = ",".join("?" * len(channel_ids))
                channel_rows = conn.execute(
                    f"SELECT channel_id, server_name, data FROM channels WHERE channel_id IN ({ch_ph})",
                    channel_ids,
                ).fetchall()
            else:
                channel_rows = conn.execute(
                    "SELECT channel_id, server_name, data FROM channels"
                ).fetchall()
        channels = {}
        for row in channel_rows:
            d = dict(row)
            data = self._parse_json_value(d['data']) if isinstance(d['data'], str) else d['data']
            if isinstance(data, dict):
                channels[d['channel_id']] = {
                    'server_name': d['server_name'],
                    'channel_name': data.get('name', d['channel_id'])
                }
        return {
            "characters": characters,
            "users": users,
            "admin_users": admin_users,
            "channels": channels,
        }

    # ------------------------------------------------------
    # Panel auth users & sessions
    # ------------------------------------------------------
    def _utcnow_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_super_admin_account(self) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE role = 'super_admin' ORDER BY id ASC LIMIT 1").fetchone()
            return dict(row) if row else None

    def count_super_admins(self) -> int:
        with self._get_connection() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'").fetchone()
            return int(row["c"]) if row else 0

    def count_local_super_admins(self) -> int:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin' AND auth_provider = 'local'"
            ).fetchone()
            return int(row["c"]) if row else 0

    def count_super_admins_with_password(self) -> int:
        """Super admins who can use POST /login (includes Discord SA after owner password is saved)."""
        with self._get_connection() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c FROM users
                WHERE role = 'super_admin'
                AND password_hash IS NOT NULL
                AND TRIM(password_hash) != ''
                """
            ).fetchone()
            return int(row["c"]) if row else 0

    def list_discord_super_admins(self) -> List[Dict[str, Any]]:
        """Super admin accounts linked to Discord (have discord_id). Local-only super admins are excluded."""
        with self._get_connection() as conn:
            rows = conn.execute(
                """SELECT * FROM users
                   WHERE role = 'super_admin'
                   AND auth_provider = 'discord'
                   AND discord_id IS NOT NULL
                   AND TRIM(discord_id) != ''"""
            ).fetchall()
            return [dict(r) for r in rows]

    def create_local_user(self, username: str, password_hash: str, role: str = "user") -> int:
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (username, password_hash, role, auth_provider, created_at, updated_at)
                VALUES (?, ?, ?, 'local', ?, ?)
                """,
                (username, password_hash, role, now, now),
            )
            conn.commit()
            return cur.lastrowid

    def create_first_super_admin_if_absent(self, username: str, password_hash: str) -> int:
        """
        Atomically create the first local super_admin (BEGIN IMMEDIATE).
        Raises ValueError('super_admin_exists' | 'username_exists') on conflict.
        """
        now = self._utcnow_iso()
        _ensure_db_directory(self.db_path)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'").fetchone()
            if row and int(row["c"]) > 0:
                conn.rollback()
                raise ValueError("super_admin_exists")
            row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if row:
                conn.rollback()
                raise ValueError("username_exists")
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (username, password_hash, role, auth_provider, created_at, updated_at)
                VALUES (?, ?, 'super_admin', 'local', ?, ?)
                """,
                (username, password_hash, now, now),
            )
            uid = int(cur.lastrowid)
            conn.commit()
            return uid
        except ValueError:
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_user(self, username: str, password_hash: Optional[str], role: str,
                    auth_provider: str = "local", discord_id: Optional[str] = None,
                    discord_username: Optional[str] = None, discord_avatar_hash: Optional[str] = None,
                    uploaded_avatar_url: Optional[str] = None) -> int:
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO users (username, password_hash, role, auth_provider, discord_id, discord_username, discord_avatar_hash, uploaded_avatar_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (username, password_hash, role, auth_provider, discord_id, discord_username, discord_avatar_hash, uploaded_avatar_url, now, now)
            )
            conn.commit()
            return cur.lastrowid

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def get_user_by_discord_id(self, discord_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE discord_id = ?", (discord_id,)).fetchone()
            return dict(row) if row else None

    def create_or_update_discord_user(self, discord_id: str, discord_username: str, discord_avatar_hash: Optional[str] = None) -> int:
        now = self._utcnow_iso()
        username = discord_username.lower()
        with self._get_connection() as conn:
            cur = conn.cursor()
            existing = cur.execute("SELECT id FROM users WHERE discord_id = ?", (discord_id,)).fetchone()
            if existing:
                cur.execute(
                    """
                    UPDATE users
                    SET discord_username = ?, discord_avatar_hash = ?, updated_at = ?, auth_provider = 'discord'
                    WHERE discord_id = ?
                    """,
                    (discord_username, discord_avatar_hash, now, discord_id),
                )
                conn.commit()
                return int(existing["id"])

            candidate = username
            suffix = 1
            while cur.execute("SELECT id FROM users WHERE username = ?", (candidate,)).fetchone():
                suffix += 1
                candidate = f"{username}_{suffix}"

            cur.execute(
                """
                INSERT INTO users (username, role, discord_id, discord_username, discord_avatar_hash, auth_provider, created_at, updated_at)
                VALUES (?, 'pending', ?, ?, ?, 'discord', ?, ?)
                """,
                (candidate, discord_id, discord_username, discord_avatar_hash, now, now),
            )
            conn.commit()
            return int(cur.lastrowid)

    def create_session(self, token: str, user_id: int, expires_at: str, user_agent: str = None):
        created_at = self._utcnow_iso()
        with self._get_connection() as conn:
            conn.execute(
                "REPLACE INTO auth_sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
                (token, user_id, created_at, expires_at, user_agent),
            )
            conn.commit()

    def get_session(self, token: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT token, user_id, created_at, expires_at FROM auth_sessions WHERE token = ?",
                (token,),
            ).fetchone()
            return dict(row) if row else None

    def _parse_session_expires_at(self, raw: Any) -> Optional[datetime]:
        if raw is None:
            return None
        s = str(raw).strip()
        if not s:
            return None
        try:
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None

    def get_user_from_session_token(self, token: Optional[str]) -> Optional[Dict[str, Any]]:
        """
        Resolve a logged-in user from a session cookie token.
        Deletes expired sessions and orphan sessions (missing user row).
        """
        if not token:
            return None
        session = self.get_session(token)
        if not session:
            return None
        expires_at = self._parse_session_expires_at(session.get("expires_at"))
        if expires_at is None:
            self.delete_session(token)
            return None
        if expires_at <= datetime.now(timezone.utc):
            self.delete_session(token)
            return None
        try:
            uid = int(session["user_id"])
        except (TypeError, ValueError, KeyError):
            self.delete_session(token)
            return None
        user = self.get_user_by_id(uid)
        if not user:
            self.delete_session(token)
            return None
        return user

    def get_session_user(self, token: str) -> Optional[Dict[str, Any]]:
        return self.get_user_from_session_token(token)

    def list_users(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
            return [dict(r) for r in rows]

    def update_user(self, user_id: int, **kwargs):
        user = self.get_user_by_id(user_id)
        if not user:
            return
        self._update_record("users", "id", user_id, updated_at=self._utcnow_iso(), **kwargs)

    def delete_user(self, user_id: int):
        user = self.get_user_by_id(user_id)
        if not user:
            return
        with self._get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()

    def get_pending_access_request(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM access_requests WHERE user_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            return dict(row) if row else None

    def create_access_request(self, user_id: int, discord_username: str) -> int:
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO access_requests (user_id, discord_username, status, requested_at) VALUES (?, ?, 'pending', ?)",
                (user_id, discord_username, now),
            )
            conn.commit()
            return int(cur.lastrowid)

    def list_access_requests(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM access_requests WHERE status = ? ORDER BY requested_at DESC",
                    (status,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM access_requests ORDER BY requested_at DESC"
                ).fetchall()
            return [dict(r) for r in rows]

    def get_access_request(self, request_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM access_requests WHERE id = ?",
                (request_id,),
            ).fetchone()
            return dict(row) if row else None

    def resolve_access_request(self, request_id: int, status: str, reviewed_by: int, note: Optional[str] = None):
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE access_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, note = ? WHERE id = ?",
                (status, now, reviewed_by, note, request_id),
            )
            conn.commit()

    def get_user_server_access(self, user_id: int) -> List[str]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT server_id FROM user_server_access WHERE user_id = ?", (user_id,)).fetchall()
            return [r["server_id"] for r in rows]

    def set_user_server_access(self, user_id: int, server_ids: List[str]):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM user_server_access WHERE user_id = ?", (user_id,))
            for sid in server_ids:
                conn.execute("INSERT OR IGNORE INTO user_server_access (user_id, server_id) VALUES (?,?)", (user_id, sid))
            conn.commit()

    def list_active_sessions(self) -> List[Dict[str, Any]]:
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            rows = conn.execute("""
                SELECT s.token AS session_token, s.user_id, s.created_at, s.expires_at, s.user_agent,
                       u.username, u.role, u.auth_provider,
                       u.discord_id, u.discord_avatar_hash, u.uploaded_avatar_url
                FROM auth_sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.expires_at > ?
                ORDER BY s.created_at DESC
            """, (now,)).fetchall()
            return [dict(r) for r in rows]

    def delete_user_sessions(self, user_id: int):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
            conn.commit()

    def delete_session(self, token: str):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            conn.commit()

    def delete_all_sessions(self):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions")
            conn.commit()

    def purge_expired_sessions(self):
        now = self._utcnow_iso()
        with self._get_connection() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
            conn.commit()

    # --- Panel Discord DM queue (when bot is offline or DM fails) ---
    def enqueue_discord_dm(self, kind: str, discord_user_id: str, message: str) -> int:
        now = self._utcnow_iso()
        did = str(discord_user_id).strip()
        with self._get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO discord_dm_queue (created_at, kind, discord_user_id, message, status, attempts)
                VALUES (?, ?, ?, ?, 'pending', 0)
                """,
                (now, kind, did, message),
            )
            conn.commit()
            return int(cur.lastrowid)

    def list_pending_discord_dm_queue(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT * FROM discord_dm_queue
                WHERE status = 'pending'
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def delete_discord_dm_queue_item(self, queue_id: int):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM discord_dm_queue WHERE id = ?", (queue_id,))
            conn.commit()

    def increment_discord_dm_queue_attempt(self, queue_id: int, error: str) -> int:
        now = self._utcnow_iso()
        err = (error or "")[:500]
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE discord_dm_queue
                SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
                WHERE id = ?
                """,
                (now, err, queue_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT attempts FROM discord_dm_queue WHERE id = ?", (queue_id,)
            ).fetchone()
            return int(row["attempts"]) if row else 0