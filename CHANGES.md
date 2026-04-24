# Changes from upstream

This project is a fork of [viel-ai](https://github.com/Iteranya/viel-ai) by [Artes Paradox](https://github.com/Iteranya/).
It is licensed under AGPL-3.0-only. See [LICENSE](LICENSE) and [PLEDGE.md](PLEDGE.md) for details.

---

## Quality of Life Improvements

### Removed example dialogues
- Removed `examples` field from character model — reduces token usage per message and prevents the model from repeating stale phrases

### Discord slash commands
- `/zahul register_channel` — initializes the current channel for the bot
- `/whitelist add` — adds characters to the channel whitelist (comma-separated)
- `/whitelist remove` — removes characters from the channel whitelist
- `/whitelist view` — shows the current whitelist for this channel
- `/about <meno>` — posts the character's Info / Author Note in the channel (visible to everyone)
- `/tokens` — shows token usage per minute and per day
- `/fallback status` — shows whether fallback is active and when primary returns
- `/fallback on` / `/fallback off` — manually toggle fallback mode
- `/autocap set <value>` — sets the bot-to-bot chain limit
- `/autocap off [hours]` — disables the chain limit temporarily (auto-reverts after given hours)
- `/autocap on` — re-enables the chain limit with the last set value
- `/autocap reset` — resets chain limit to the value in AI Config
- `/autocap status` — shows the current chain limit state
- `/reminder <character> <when> <text> [mode]` — schedules a one-time reminder; auto-targets the current channel or DM; mode is `exact` (default) or `generate`
- All commands except `/about` are ephemeral (only visible to the user who ran them)

### Configurable base model with automatic fallback
- Base model and fallback model are fully configurable from the AI Config panel in the web UI
- Automatic switch to the fallback model when the primary hits a rate limit
- Fallback duration is configurable from the web UI
- Fallback state is persisted to disk - survives bot restarts

### Token usage tracking
- Tracks tokens used per minute (TPM) and per day (TPD)
- Limits are configurable from the AI Config panel (no need to edit code)
- Fallback token usage tracked separately and reset when fallback ends

### Per-character temperature and token overrides
- Each character can have its own `temperature` and `max_tokens` values
- If not set on the character, falls back to the global config value

### Image upload via system channel
- Thread-safe image uploading using the bot's own event loop
- Automatically finds the system channel or falls back to the first registered channel

### Persistent avatar storage
- Avatar uploads are saved locally to `static/avatars/` instead of Discord CDN
- Avatars no longer expire or disappear after bot restarts

### Character filtering by server
- Dropdown on the Characters page to filter characters by server
- Shows only characters whitelisted in at least one channel of the selected server
- Direct Messages excluded from the filter list

### Scheduler & reminders
- One-time reminders and recurring schedules managed from the web panel at `/scheduler`
- Two delivery modes: **Exact** (sends the message as-is) or **Generate** (character reacts to the topic in their own voice)
- Targets: channel or DM — auto-detected when using the `/reminder` slash command
- Four repeat types: **Daily**, **Weekly** (pick days of week), **Monthly** (day of month), **Yearly** (month + day)
- Scheduler runs as a background loop inside the bot, checks every 60 seconds
- All tasks visible and editable in the Scheduler panel; status tracked (upcoming → done)
- Task cards support duplicate, disable, and detail view with edit/delete
- Errors from LLM generation are silently dropped — no raw error messages leak to Discord

### Activity logs
- Every Discord interaction is logged: character, user, channel, model, tokens in/out, trigger, response, source (chat/scheduler), status (ok/error)
- Admin log tracks all panel actions: character create/update/delete, task create/update/delete, config changes — with changed fields only
- Logs browsable at `/logs` — two tabs (Discord / Admin), filters (character, user, date, source, status), pagination with configurable page size, JSON export
- Log detail shows full request JSON (messages sent to LLM), response body, and error if present
- Token usage (input/output) stored per interaction and visible in both list and detail view

### Panel authentication
- Optional password protection for the web panel
- Set a password via AI Config - Panel Security section
- Optional password hint — displayed on the login page after 3 failed attempts
- Session persists for 7 days, logout button in navbar
- Auth can be disabled at code level via `PANEL_AUTH_ENABLED` flag in `main.py`


---

## Adapted for Slovak Audience

- Bot slash command group renamed to `/zahul`
- All Discord slash commands and responses written in Slovak
- `/tokens` command displays model names and limits in Slovak
- UI panel labels and descriptions kept in English for maintainability
