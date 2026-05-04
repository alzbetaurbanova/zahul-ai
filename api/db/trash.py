import sqlite3
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

TRASH_DB_PATH = os.getenv("TRASH_DB_URL", "data/trash.db")


class TrashDB:
    def __init__(self, path: str = TRASH_DB_PATH):
        self.db_path = path
        self._init_db()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trash (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_table TEXT NOT NULL,
                    original_id TEXT NOT NULL,
                    data JSON NOT NULL,
                    deleted_at TEXT NOT NULL,
                    deleted_by TEXT NOT NULL DEFAULT 'system'
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_trash_deleted_at ON trash(deleted_at)")
            conn.commit()

    def move_to_trash(self, source_table: str, original_id: str, data: Dict[str, Any], deleted_by: str = "system") -> int:
        deleted_at = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO trash (source_table, original_id, data, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?)",
                (source_table, str(original_id), json.dumps(data), deleted_at, deleted_by)
            )
            conn.commit()
            return cur.lastrowid

    def get(self, trash_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM trash WHERE id = ?", (trash_id,)).fetchone()
            if not row:
                return None
            r = dict(row)
            r['data'] = json.loads(r['data'])
            return r

    def list_all(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM trash ORDER BY deleted_at DESC").fetchall()
            result = []
            for row in rows:
                r = dict(row)
                r['data'] = json.loads(r['data'])
                result.append(r)
            return result

    def delete(self, trash_id: int):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM trash WHERE id = ?", (trash_id,))
            conn.commit()

    def purge_old(self, months: int = 6):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=months * 30)).isoformat()
        with self._get_connection() as conn:
            conn.execute("DELETE FROM trash WHERE deleted_at < ?", (cutoff,))
            conn.commit()
