import json
import sqlite3
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/trash", tags=["Trash"])


def _get_db():
    from api.db.database import Database
    return Database()


def _get_trash_db():
    from api.db.trash import TrashDB
    return TrashDB()


@router.get("")
def list_trash():
    return _get_trash_db().list_all()


@router.get("/{trash_id}")
def get_trash_item(trash_id: int):
    item = _get_trash_db().get(trash_id)
    if not item:
        raise HTTPException(status_code=404, detail="Trash item not found")
    return item


@router.post("/{trash_id}/restore")
def restore(trash_id: int):
    trash_db = _get_trash_db()
    item = trash_db.get(trash_id)
    if not item:
        raise HTTPException(status_code=404, detail="Trash item not found")

    db = _get_db()
    try:
        restored = _restore_record(db, item["source_table"], item["data"])
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail=f"Restore conflict: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    trash_db.delete(trash_id)
    db.log_admin('trash.restore', target=f"{item['source_table']}:{trash_id}")
    return restored


def _restore_record(db, source_table: str, data: dict):
    if source_table == "characters":
        char_id = data.get("id")
        name = data["name"]
        with db._get_connection() as conn:
            if char_id:
                conn.execute("INSERT INTO characters (id, name, data) VALUES (?, ?, ?)",
                             (char_id, name, json.dumps(data.get("data", {}))))
            else:
                conn.execute("INSERT INTO characters (name, data) VALUES (?, ?)",
                             (name, json.dumps(data.get("data", {}))))
            row = conn.execute("SELECT id FROM characters WHERE name = ?", (name,)).fetchone()
            actual_id = row["id"]
            triggers = data.get("triggers", [])
            if triggers:
                conn.executemany("INSERT INTO character_triggers (character_id, trigger) VALUES (?, ?)",
                                 [(actual_id, t) for t in triggers])
            conn.commit()
        return db.get_character(name)

    elif source_table == "scheduled_tasks":
        db._ensure_scheduled_tasks_table()
        task_id = data.get("id")
        rp = json.dumps(data["repeat_pattern"]) if data.get("repeat_pattern") else None
        with db._get_connection() as conn:
            conn.execute(
                "INSERT INTO scheduled_tasks (id, type, name, character, target_type, target_id, "
                "instructions, scheduled_time, repeat_pattern, status, message_mode, history_limit, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (task_id, data["type"], data["name"], data["character"], data["target_type"],
                 data["target_id"], data.get("instructions"), data.get("scheduled_time"),
                 rp, data.get("status", "upcoming"), data.get("message_mode", "exact"),
                 data.get("history_limit"), data.get("created_at"))
            )
            conn.commit()
        return db.get_task(task_id)

    elif source_table == "servers":
        with db._get_connection() as conn:
            server_config = data.get("config")
            conn.execute(
                "INSERT INTO servers (server_id, server_name, description, instruction, config) VALUES (?,?,?,?,?)",
                (data["server_id"], data["server_name"], data.get("description"),
                 data.get("instruction"), json.dumps(server_config) if server_config else None)
            )
            for ch in data.get("channels", []):
                conn.execute(
                    "INSERT INTO channels (channel_id, server_id, server_name, data) VALUES (?,?,?,?)",
                    (ch["channel_id"], ch["server_id"], ch["server_name"], json.dumps(ch.get("data", {})))
                )
            conn.commit()
        return db.get_server(data["server_id"])

    elif source_table == "channels":
        with db._get_connection() as conn:
            conn.execute(
                "INSERT INTO channels (channel_id, server_id, server_name, data) VALUES (?,?,?,?)",
                (data["channel_id"], data["server_id"], data["server_name"], json.dumps(data.get("data", {})))
            )
            conn.commit()
        return db.get_channel(data["channel_id"])

    elif source_table == "presets":
        preset_id = data.get("id")
        with db._get_connection() as conn:
            if preset_id:
                conn.execute("INSERT INTO presets (id, name, description, prompt_template) VALUES (?,?,?,?)",
                             (preset_id, data["name"], data.get("description"), data.get("prompt_template")))
            else:
                conn.execute("INSERT INTO presets (name, description, prompt_template) VALUES (?,?,?)",
                             (data["name"], data.get("description"), data.get("prompt_template")))
            conn.commit()
        return db.get_preset(data["name"])

    elif source_table == "discord_logs":
        with db._get_connection() as conn:
            conn.execute(
                "INSERT INTO discord_logs (id, timestamp, character, channel_id, user, trigger, response, model, "
                "input_tokens, output_tokens, conversation_history, source, status, error_message, temperature, history_count) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (data.get("id"), data["timestamp"], data.get("character"), data.get("channel_id"),
                 data.get("user"), data.get("trigger"), data.get("response"), data.get("model"),
                 data.get("input_tokens", 0), data.get("output_tokens", 0),
                 json.dumps(data["conversation_history"]) if isinstance(data.get("conversation_history"), (list, dict)) else data.get("conversation_history"),
                 data.get("source", "chat"), data.get("status", "ok"), data.get("error_message"),
                 data.get("temperature"), data.get("history_count", 0))
            )
            conn.commit()
        return db.get_discord_log(data["id"])

    elif source_table == "admin_logs":
        with db._get_connection() as conn:
            conn.execute(
                "INSERT INTO admin_logs (id, timestamp, action, target, detail) VALUES (?,?,?,?,?)",
                (data.get("id"), data["timestamp"], data["action"], data.get("target"), data.get("detail"))
            )
            conn.commit()
        return db.get_admin_log(data["id"])

    else:
        raise ValueError(f"Unsupported source table: {source_table}")
