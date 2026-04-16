# Changes from upstream

This project is a fork of [viel-ai](https://github.com/Iteranya/viel-ai) by [Artes Paradox](https://github.com/Iteranya/).
It is licensed under AGPL-3.0-only. See [LICENSE](LICENSE) and [PLEDGE.md](PLEDGE.md) for details.

---

## Quality of Life Improvements

### Groq API with automatic fallback
- Switched to Groq API (llama-3.3-70b-versatile as primary model)
- Automatic fallback to a secondary model (llama-3.1-8b-instant) when the primary hits a rate limit
- Fallback duration and both model names are fully configurable from the AI Config panel in the web UI
- Fallback state is persisted to disk — survives bot restarts

### Token usage tracking
- Tracks tokens used per minute (TPM) and per day (TPD)
- Limits are configurable from the AI Config panel (no need to edit code)
- Token usage visible via `/tokens` Discord slash command
- Fallback token usage tracked separately and reset when fallback ends

### Fallback management commands
- `/fallback status` — shows whether fallback is active and when primary returns
- `/fallback on` / `/fallback off` — manually toggle fallback mode
- All commands are ephemeral (only visible to the user who ran them)

### Per-character temperature and token overrides
- Each character can have its own `temperature` and `max_tokens` values
- If not set on the character, falls back to the global config value

### Image upload via system channel
- Thread-safe image uploading using the bot's own event loop
- Automatically finds the system channel or falls back to the first registered channel

---

## Adapted for Slovak Audience

- Bot slash command group renamed to `/zahul`
- All Discord slash commands and responses written in Slovak
- `/tokens` command displays model names and limits in Slovak
- UI panel labels and descriptions kept in English for maintainability
