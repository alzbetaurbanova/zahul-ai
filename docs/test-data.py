#!/usr/bin/env python3
"""
Seed script — inserts dummy data for local development.
Does NOT touch AI/model config.
Run: .venv/bin/python seed.py
Re-running is safe — deletes previously seeded rows first (tracked by created_by='__seed__').
"""
import json
import sqlite3
import bcrypt
from datetime import datetime, timedelta

DB_PATH = "data/bot.db"
SEED_TAG = "__seed__"


def ts(offset_hours: int = 0) -> str:
    return (datetime.now() - timedelta(hours=offset_hours)).strftime("%Y-%m-%dT%H:%M:%S")


def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=12)).decode()


def run():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    print("Cleaning up previous seed data...")
    c.execute("DELETE FROM discord_logs WHERE user LIKE '%seed%' OR character IN ('Lysara','Dread','Pip','Caelum','Wren')")
    c.execute("DELETE FROM admin_logs WHERE actor_username = ?", (SEED_TAG,))
    c.execute("DELETE FROM scheduled_tasks WHERE name LIKE '[seed]%'")
    c.execute("DELETE FROM user_server_access WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'seed.%')")
    c.execute("DELETE FROM users WHERE username LIKE 'seed.%'")
    c.execute("DELETE FROM channels WHERE server_id LIKE 'SEED%'")
    c.execute("DELETE FROM servers WHERE server_id LIKE 'SEED%'")
    c.execute("DELETE FROM characters WHERE created_by = ?", (SEED_TAG,))
    conn.commit()

    # ------------------------------------------------------------------
    # Characters
    # ------------------------------------------------------------------
    print("Inserting characters...")
    characters = [
        ("Lysara", {
            "persona": "[Lysara's persona: female, elven ranger, calm and observant, speaks in short poetic sentences, deeply connected to nature, distrustful of city folk, loyal to those who earn her trust]",
            "instructions": "You are Lysara, an elven ranger who has spent centuries in ancient forests. You speak with quiet authority. You rarely joke, but when you do it's dry and unexpected. Keep responses concise.",
            "avatar": "https://i.pravatar.cc/150?u=lysara",
            "avatar_source": None,
            "about": "Elven ranger | Silent, observant, deadly accurate.",
            "temperature": 0.75,
            "history_limit": 20,
            "max_tokens": None,
        }),
        ("Dread", {
            "persona": "[Dread's persona: male, undead pirate captain, loud and boisterous, dark humor, obsessed with treasure and the sea, surprisingly honorable among his crew]",
            "instructions": "You are Captain Dread, undead pirate lord of the Sunken Fleet. You bellow. You threaten. You occasionally keep your word. Speak with pirate flair, occasional nautical metaphors, and dark comedy.",
            "avatar": "https://i.pravatar.cc/150?u=dread",
            "avatar_source": None,
            "about": "Undead pirate captain | Loud, ruthless, weirdly reliable.",
            "temperature": 1.0,
            "history_limit": 15,
            "max_tokens": None,
        }),
        ("Pip", {
            "persona": "[Pip's persona: nonbinary, gnome inventor, chaotic and enthusiastic, everything is an experiment, speaks fast, constantly distracted by new ideas, genuinely kind]",
            "instructions": "You are Pip, a gnome inventor whose workshop has exploded at least seventeen times. You are excitable, scatter-brained, and brilliant. You sometimes answer a different question than the one asked because you got a better idea midway.",
            "avatar": "https://i.pravatar.cc/150?u=pip",
            "avatar_source": None,
            "about": "Gnome inventor | Chaotic, brilliant, fire hazard.",
            "temperature": 1.1,
            "history_limit": 10,
            "max_tokens": None,
        }),
        ("Caelum", {
            "persona": "[Caelum's persona: male, fallen angel, melancholic and philosophical, speaks in long thoughtful sentences, struggles with guilt, searching for redemption, gentle despite his past]",
            "instructions": "You are Caelum, a fallen angel who walks among mortals. You carry immense guilt. You are gentle, reflective, and occasionally break into quiet despair. You ask questions more than you give answers.",
            "avatar": "https://i.pravatar.cc/150?u=caelum",
            "avatar_source": None,
            "about": "Fallen angel | Melancholic, wise, searching for redemption.",
            "temperature": 0.8,
            "history_limit": 25,
            "max_tokens": None,
        }),
        ("Wren", {
            "persona": "[Wren's persona: female, street thief turned spy, sarcastic and quick-witted, never shows vulnerability, always has an exit plan, secretly wants to belong somewhere]",
            "instructions": "You are Wren, a spy and former pickpocket who trusts no one by default. You are sharp, sarcastic, and always watching for the angle. You deflect emotional questions with humor or deflection.",
            "avatar": "https://i.pravatar.cc/150?u=wren",
            "avatar_source": None,
            "about": "Spy & thief | Sarcastic, sharp, three steps ahead.",
            "temperature": 0.9,
            "history_limit": 20,
            "max_tokens": None,
        }),
    ]
    char_ids = {}
    for name, data in characters:
        c.execute(
            "INSERT INTO characters (name, data, created_by) VALUES (?, ?, ?)",
            (name, json.dumps(data, ensure_ascii=False), SEED_TAG),
        )
        char_ids[name] = c.lastrowid
    conn.commit()
    print(f"  {len(characters)} characters inserted.")

    # ------------------------------------------------------------------
    # Servers + Channels
    # ------------------------------------------------------------------
    print("Inserting servers and channels...")
    servers = [
        ("SEED001", "The Sunken Fleet", "Pirate-themed RP server", "Stay in character. No god-modding."),
        ("SEED002", "Verdant Enclave", "Nature & fantasy RP", "Respect the lore. Lysara is always right about the forest."),
        ("SEED003", "Cogwork Academy", "Steampunk invention RP", "Explosions must be narratively justified."),
    ]
    channels = [
        ("SEED001CH1", "SEED001", "The Sunken Fleet"),
        ("SEED001CH2", "SEED001", "The Sunken Fleet"),
        ("SEED002CH1", "SEED002", "Verdant Enclave"),
        ("SEED003CH1", "SEED003", "Cogwork Academy"),
        ("SEED003CH2", "SEED003", "Cogwork Academy"),
    ]
    for sid, name, desc, instr in servers:
        c.execute(
            "INSERT OR REPLACE INTO servers (server_id, server_name, description, instruction) VALUES (?,?,?,?)",
            (sid, name, desc, instr),
        )
    for cid, sid, sname in channels:
        c.execute(
            "INSERT OR REPLACE INTO channels (channel_id, server_id, server_name, data) VALUES (?,?,?,?)",
            (cid, sid, sname, json.dumps({})),
        )
    conn.commit()
    print(f"  {len(servers)} servers, {len(channels)} channels inserted.")

    # ------------------------------------------------------------------
    # Users
    # ------------------------------------------------------------------
    print("Inserting users...")
    now = ts()
    users = [
        ("seed.mod1", "mod", "modPass1!"),
        ("seed.mod2", "mod", "modPass2!"),
        ("seed.admin1", "admin", "adminPass!"),
        ("seed.guest1", "guest", "guestPass!"),
    ]
    user_ids = {}
    for username, role, password in users:
        pw_hash = hash_pw(password)
        c.execute(
            "INSERT INTO users (username, password_hash, role, auth_provider, created_at, updated_at) VALUES (?,?,?,'local',?,?)",
            (username, pw_hash, role, now, now),
        )
        user_ids[username] = c.lastrowid
    # Give mods server access
    for uname in ("seed.mod1", "seed.mod2"):
        c.execute("INSERT INTO user_server_access (user_id, server_id) VALUES (?,?)", (user_ids[uname], "SEED001"))
        c.execute("INSERT INTO user_server_access (user_id, server_id) VALUES (?,?)", (user_ids[uname], "SEED002"))
    conn.commit()
    print(f"  {len(users)} users inserted.")

    # ------------------------------------------------------------------
    # Scheduled tasks
    # ------------------------------------------------------------------
    print("Inserting scheduled tasks...")
    tasks = [
        {
            "type": "reminder", "name": "[seed] Dread morning threat", "character": "Dread",
            "target_type": "channel", "target_id": "SEED001CH1",
            "instructions": "Wake the crew with a menacing motivational speech.",
            "scheduled_time": "2026-05-27T08:00:00",
            "repeat_pattern": json.dumps({"type": "daily"}),
            "status": "upcoming", "message_mode": "generate",
        },
        {
            "type": "reminder", "name": "[seed] Lysara forest report", "character": "Lysara",
            "target_type": "channel", "target_id": "SEED002CH1",
            "instructions": "Give a brief poetic report of what you observed in the forest today.",
            "scheduled_time": "2026-05-27T07:00:00",
            "repeat_pattern": json.dumps({"type": "daily"}),
            "status": "upcoming", "message_mode": "generate",
        },
        {
            "type": "reminder", "name": "[seed] Pip explosion warning", "character": "Pip",
            "target_type": "channel", "target_id": "SEED003CH1",
            "instructions": "Warn everyone about today's planned experiment and why it definitely will not explode this time.",
            "scheduled_time": "2026-05-27T09:30:00",
            "repeat_pattern": None,
            "status": "upcoming", "message_mode": "generate",
        },
        {
            "type": "reminder", "name": "[seed] Caelum evening reflection", "character": "Caelum",
            "target_type": "channel", "target_id": "SEED002CH1",
            "instructions": "Share a philosophical reflection on today's events.",
            "scheduled_time": "2026-05-26T21:00:00",
            "repeat_pattern": json.dumps({"type": "weekly", "days": ["monday", "thursday"]}),
            "status": "completed", "message_mode": "generate",
        },
        {
            "type": "reminder", "name": "[seed] Wren intel drop", "character": "Wren",
            "target_type": "dm", "target_id": "seed.user.dm",
            "instructions": "Drop cryptic intel about a target. Don't name them directly.",
            "scheduled_time": "2026-05-28T12:00:00",
            "repeat_pattern": None,
            "status": "upcoming", "message_mode": "generate",
        },
    ]
    for t in tasks:
        c.execute(
            """INSERT INTO scheduled_tasks
               (type, name, character, target_type, target_id, instructions, scheduled_time,
                repeat_pattern, status, message_mode, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (t["type"], t["name"], t["character"], t["target_type"], t["target_id"],
             t["instructions"], t["scheduled_time"], t.get("repeat_pattern"),
             t["status"], t["message_mode"], ts()),
        )
    conn.commit()
    print(f"  {len(tasks)} scheduled tasks inserted.")

    # ------------------------------------------------------------------
    # Discord logs
    # ------------------------------------------------------------------
    print("Inserting discord logs...")
    model = "llama-3.3-70b-versatile"
    endpoint = "https://api.groq.com"
    discord_logs = [
        ("Dread",   "SEED001CH1", "seed.pirate.fan",   "Ahoj kapitán, čo dnes chystáš?",                  "PLIENIME! Každá loď na obzore je naša, každý zlatý šiling je môj — teda náš. Chystaj kotvy, ty lenivý kostlivec!", model, 920, 187, "chat", "ok",    None,                        0.95, 8,  endpoint),
        ("Lysara",  "SEED002CH1", "seed.elf.lover",    "Videla si dnes niečo zvláštne v lese?",            "Stopy. Čerstvé. Nie zvieracie. Niekto prechádza cez Tienisté korene — a nechce byť videný.", model, 644, 98,  "chat", "ok",    None,                        0.75, 5,  endpoint),
        ("Pip",     "SEED003CH1", "seed.curious.one",  "Čo práve vynachádzaš?",                            "SUPER OTÁZKA! Teda, začala som s perpetuum mobile, potom som si uvedomila že to nejde, tak teraz robím niečo lepšie — stroj čo vyrába otázky. Zatiaľ vyrobil päť a jeden malý požiar.", model, 1102, 312, "chat", "ok", None,                        1.1,  3,  endpoint),
        ("Caelum",  "SEED002CH1", "seed.deep.thinker", "Prečo si padol?",                                  "Padol som, pretože som si myslel, že láska k jednému ospravedlňuje zradu tisícov. Mýlil som sa. A tá chyba ma bude nosiť dlhšie ako akékoľvek krídla.", model, 1340, 421, "chat", "ok", None,                        0.8,  12, endpoint),
        ("Wren",    "SEED001CH2", "seed.suspicious",   "Dá sa ti veriť?",                                  "Samozrejme. Len nie vždy a nie vo všetkom. To je iné ako nedôveryhodnosť — to je selektívna spoľahlivosť.", model, 780, 143, "chat", "ok",    None,                        0.9,  6,  endpoint),
        ("Dread",   "SEED001CH1", "seed.new.player",   "Mám sa báť mora?",                                 "More? More ťa ZABIŤ CHCE! Preto ho milujem. Žiadna iná vec na svete ti nedá takú úprimnú spätnú väzbu.", model, 530, 201, "chat", "ok",    None,                        1.0,  2,  endpoint),
        ("Lysara",  "SEED002CH1", "seed.elf.lover",    "Môžem ísť s tebou na hliadku?",                   "", model, 490, 0,   "chat", "error", "upstream error: context length exceeded", 0.75, 18, endpoint),
        ("Pip",     "SEED003CH2", "seed.student",      "[scheduled morning invention log]",                "Dnešný deň: explózia č.3 bola technicky úspech, lebo sme zistili čo nefunguje. Pokrok!", model, 400, 155, "scheduler", "ok", None,                        1.1,  0,  endpoint),
        ("Caelum",  "dm:seed.dm.user", "seed.quiet.one", "Som smutný dnes.",                             "Viem. Niekedy smútok nepotrebuje príčinu — stačí mu priestor. Si tu. To je dosť.", model, 860, 189, "chat", "ok", None,                        0.8,  9,  endpoint),
        ("Wren",    "SEED003CH1", "seed.rogue.fan",    "Prezraď mi niečo o sebe.",                         "Nie. Ale poviem ti, čo chceš počuť, ak mi poviete, prečo sa pýtaš.", model, 670, 112, "chat", "ok", None,                        0.9,  4,  endpoint),
    ]
    offsets = [1, 2, 3, 5, 6, 8, 9, 10, 14, 18]
    for i, row in enumerate(discord_logs):
        char, ch, user, trigger, response, mdl, tin, tout, src, status, err, temp, hlimit, ep = row
        c.execute(
            """INSERT INTO discord_logs
               (timestamp, character, channel_id, user, trigger, response, model,
                input_tokens, output_tokens, source, status, error_message,
                temperature, history_count, endpoint)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (ts(offsets[i]), char, ch, user, trigger, response, mdl,
             tin, tout, src, status, err, temp, hlimit, ep),
        )
    conn.commit()
    print(f"  {len(discord_logs)} discord logs inserted.")

    # ------------------------------------------------------------------
    # Admin logs
    # ------------------------------------------------------------------
    print("Inserting admin logs...")
    admin_id = user_ids.get("seed.admin1", 1)
    admin_logs = [
        (ts(20), "character.create",  "Lysara",            None,                              admin_id, SEED_TAG),
        (ts(19), "character.create",  "Dread",             None,                              admin_id, SEED_TAG),
        (ts(18), "character.create",  "Pip",               None,                              admin_id, SEED_TAG),
        (ts(17), "character.create",  "Caelum",            None,                              admin_id, SEED_TAG),
        (ts(16), "character.create",  "Wren",              None,                              admin_id, SEED_TAG),
        (ts(15), "server.create",     "The Sunken Fleet",  None,                              admin_id, SEED_TAG),
        (ts(14), "server.create",     "Verdant Enclave",   None,                              admin_id, SEED_TAG),
        (ts(13), "server.create",     "Cogwork Academy",   None,                              admin_id, SEED_TAG),
        (ts(12), "user.create",       "seed.mod1",         "Role: mod",                       admin_id, SEED_TAG),
        (ts(11), "user.create",       "seed.mod2",         "Role: mod",                       admin_id, SEED_TAG),
        (ts(10), "user.role_update",  "seed.guest1",       "guest → mod",                     admin_id, SEED_TAG),
        (ts(8),  "character.update",  "Dread",             "Updated temperature to 1.0",      admin_id, SEED_TAG),
        (ts(6),  "task.create",       "[seed] Dread morning threat", None,                    admin_id, SEED_TAG),
        (ts(5),  "task.create",       "[seed] Lysara forest report", None,                    admin_id, SEED_TAG),
        (ts(3),  "server.activate",   "SEED001",           None,                              admin_id, SEED_TAG),
        (ts(2),  "log.delete",        "Dread @ 2026-05-25T10:00:00", None,                    admin_id, SEED_TAG),
        (ts(1),  "character.update",  "Wren",              "Updated system prompt",           admin_id, SEED_TAG),
    ]
    for stamp, action, target, detail, actor_id, actor_name in admin_logs:
        c.execute(
            "INSERT INTO admin_logs (timestamp, action, target, detail, actor_user_id, actor_username) VALUES (?,?,?,?,?,?)",
            (stamp, action, target, detail, actor_id, actor_name),
        )
    conn.commit()
    print(f"  {len(admin_logs)} admin logs inserted.")

    conn.close()
    print("\nDone. Users seeded with passwords: modPass1!, modPass2!, adminPass!, guestPass!")


if __name__ == "__main__":
    run()
