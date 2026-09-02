# Changes from upstream

This project is a fork of [viel-ai](https://github.com/Iteranya/viel-ai) by [Artes Paradox](https://github.com/Iteranya/).
It is licensed under AGPL-3.0-only. See [LICENSE](LICENSE) and [PLEDGE.md](PLEDGE.md) for details.

---

## New features

### Scheduler & reminders
- One-time reminders and recurring schedules managed from the web panel at `/scheduler`
- Two delivery modes: **Exact** (sends the message as-is) or **Generate** (character reacts to the topic in their own voice)
- Targets: channel or DM - auto-detected when using the `/reminder` slash command
- Four repeat types: **Daily**, **Weekly** (pick days of week), **Monthly** (day of month), **Yearly** (month + day)
- Scheduler runs as a background loop inside the bot, checks every 60 seconds
- All tasks visible and editable in the Scheduler panel; status tracked (upcoming → done)
- Task cards support duplicate, disable, and detail view with edit/delete
- Errors from LLM generation are silently dropped - no raw error messages leak to Discord

### Activity logs
- Every Discord interaction is logged: character, user, channel, model, tokens in/out, trigger, response, source (chat/scheduler/slash), status (ok/error)
- Admin log tracks all panel actions: character create/update/delete, task create/update/delete, config changes - with changed fields only
- Logs browsable at `/logs` - two tabs (Discord / Admin), filters (character, user, date, source, status), pagination with configurable page size, JSON export
- Log detail shows full request JSON (messages sent to LLM), response body, and error if present
- Token usage (input/output) stored per interaction and visible in both list and detail view

### System addon
- **Global System Addon** in AI Config — text appended to every system prompt (chat, scheduler, simulator)
- **Per-model rules** — override the addon for specific models; `Use global default` flag bypasses server addon and returns the true global value
- **Per-server override** — each server can set its own addon text independently of global
- Priority chain: per-model rule → server addon → global default

### Configurable base model with automatic fallback
- Base model and fallback model are fully configurable from the AI Config panel
- Automatic switch to the fallback model when the primary hits a rate limit
- Fallback duration is configurable from the web UI
- Fallback state is persisted to disk - survives bot restarts

### Token usage tracking
- Tracks tokens used per minute (TPM) and per day (TPD)
- Limits are configurable from the AI Config panel (no need to edit code)
- Fallback token usage tracked separately and reset when fallback ends

### Multi-provider routing
- Multiple API providers configurable under **AI Config → Multi Providers** (name, endpoint, API key, allowed models)
- Each provider can be **reserved for specific servers** — other servers cannot use reserved models
- The bot auto-routes to the correct provider based on the active model
- Moderators cannot assign reserved models to servers they are not authorized for

### Per-server overrides
- Each server can override: base model, fallback model, temperature, max tokens, history limit, auto cap, TPM/TPD limits, use prefill, system addon
- Overrides are managed from the Servers panel → server edit modal
- Fields left empty inherit the global AI Config value
- "Load global defaults" button pre-fills override fields from current global config

### Per-character model rules
- Each character can define server-specific model rules: different temperature, max tokens, history limit, model, or provider per server
- Rules are enabled per character and checked before global config during generation

### Statistics dashboard
- Analytics page at `/stats` with summary cards (messages, tokens, active users, error rate)
- Time-series charts: daily / hourly / weekly message volume
- Breakdowns by character, server, user, and model
- Moderators see only stats for their assigned servers

### Chat simulator
- Test characters at `/simulator` without sending messages to Discord
- Picks up server/channel overrides and per-character model rules
- Simulator sessions are logged as `source=test` and visible in the Discord log tab
- Per-server daily token budget tracked separately for simulator usage

### Trash & restore
- Deleted characters, tasks, presets, servers, channels, and logs go to a recoverable trash
- Admin-only trash viewer with restore and permanent-delete actions

### Panel authentication
- **Protect panel** toggle - when enabled, routes require a valid session (except login/OAuth/static as documented)
- **Local account** - super-admin username and password under **AI Config → Panel Security** (minimum 8 characters)
- **Discord OAuth login** - optional; redirect URI and Client ID/secret configured in the same section
- When Discord login is enabled, **Trusted Discord usernames** must list at least one `@handle` (see [Panel Security](docs/07-panel-security.md))
- Pending Discord users without a role can use **Request access** on `/no-access`; admins manage users at `/users`
- Session cookie lasts 7 days; logout in the navbar clears it
- Panel auth feature can be turned off in code via `PANEL_AUTH_ENABLED` in `main.py` (middleware bypasses checks when `False`)
- Lockout recovery: edit `panel_auth_enabled` in `data/bot.db` or use the `sqlite3` one-liner in [Panel Security](docs/07-panel-security.md)

### User & role management
- Four roles: **super_admin**, **admin**, **mod**, **guest**
- Moderators are scoped to specific servers — they see only their servers' characters, logs, stats, and simulator
- Session management: admins can list and revoke active sessions per user
- Access request workflow: pending Discord users submit requests, notify_contacts are DM'd, approver assigns role

### DM access control
- `dm_list` field in AI Config - whitelist of Discord usernames allowed to DM the bot directly
- When the list is empty, DMs are disabled for all users
- Managed from the AI Config panel, one username per line

### Config encryption
- Sensitive config values (API keys) can be encrypted at rest using a `TOKEN_KEY` environment variable
- Encryption status visible at `/api/config/encryption-status`

---

## Slash commands

Reference: [Slash commands](docs/06-slash-commands.md).

- `/register_channel` - initializes the current channel for the bot
- `/unregister_channel` - removes the current channel from the bot
- `/whitelist add` - adds characters to the channel whitelist (comma-separated)
- `/whitelist remove` - removes characters from the channel whitelist
- `/whitelist view` - shows the current whitelist for this channel
- `/about <name>` - posts the character's bio in the channel (visible to everyone)
- `/tokens` - shows current token usage and active model
- `/fallback status` - shows whether fallback is active and when primary returns
- `/fallback on` / `/fallback off` - manually toggle fallback mode
- `/autocap set <value>` - sets the bot-to-bot chain limit
- `/autocap off [hours]` - disables the chain limit temporarily (auto-reverts after given hours)
- `/autocap on` - re-enables the chain limit with the last set value
- `/autocap reset` - resets chain limit to the value in AI Config
- `/autocap status` - shows the current chain limit state
- `/reminder <character> <when> <text> [mode]` - one-time reminder; `when` is wall time in **`Europe/Bratislava`**; auto-targets the current channel or DM; mode is `exact` (default) or `generate`
- `/rolldice` - standard RPG dice only (d4, d6, d8, d10, d12, d20, d100); optional `die` (default d6), `count` (1–50); optional `character`
- `/random` - uniform random integer(s); **`maximum` required**, omit **`minimum`** for range **0..maximum**; otherwise inclusive min..max (values clamped to ±10¹²); `count` 1–100; optional `character`
- `/wheel` - random pick from comma-separated `choices`; optional `character`
- `/search` - web research; optional character for in-character comment
- `/image` - image generation (ElectronHub, uses `ai_key`); optional character (webhook + comment)
- Most commands are ephemeral; tool commands that post in-channel use **defer** + character webhook where needed. See [Slash commands → Tools](docs/06-slash-commands.md#tools).

---

## Quality of life

### Per-character fine-tuning
- Each character can have its own `temperature`, `max_tokens`, and `history_limit` - overrides the global config value if set

### Persistent avatar storage
- Avatar uploads are saved locally to `static/avatars/` instead of Discord CDN
- Avatars no longer expire or disappear after bot restarts
- Avatar can be uploaded directly or set from an external URL; mirroring from Discord CDN to local storage is supported

### Public URL
- `public_url` field in AI Config - sets the base URL used to build avatar links in Discord webhooks
- Required for avatars to display correctly when the bot is hosted behind a domain or reverse proxy

### Dark / light theme
- Theme toggle in the navbar; persists across sessions via localStorage

### Prompt presets
- Reusable prompt templates manageable from the AI Config panel
- Used as fallback prompt templates for generation tasks

### Character filtering by server
- Dropdown on the Characters page to filter characters by server
- Shows only characters whitelisted in at least one channel of the selected server

### Removed example dialogues
- Removed `examples` field from the character model - reduces token usage per message and prevents the model from repeating stale phrases

---

## Timezones

- One-off **`/reminder`** times and the [Scheduler](docs/05-scheduler.md) **Date & Time** fields are interpreted in **`Europe/Bratislava`** (IANA), unless you change the code constant.
