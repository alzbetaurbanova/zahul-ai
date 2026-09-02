# System Addon

The **System Addon** is text that gets appended to the system prompt of every AI request. Use it for output-style instructions that should apply globally — e.g. response length, language, formatting rules.

## Priority chain

When the bot builds a request it resolves the addon in this order — first match wins:

```
Per-model rule  →  Server addon  →  Global default
```

| Level | Where to set it | When it applies |
|---|---|---|
| **Per-model rule** | AI Config → System Addon → Per-model Addon Rules | Active model matches the rule's model list |
| **Server addon** | Servers → edit server → Server System Addon | No model rule matched; server has an override set |
| **Global default** | AI Config → System Addon → Global System Addon | Nothing else matched |

The resolved text is appended to every system prompt — chat, scheduler, and simulator alike.

---

## Global System Addon

**AI Config → System Addon → Global System Addon**

Plain text field. Appended to all requests when no per-model rule or server addon takes precedence. Leave empty to disable.

Example:
```
Keep all replies to 3 sentences or fewer.
```

---

## Per-model Addon Rules

**AI Config → System Addon → Per-model Addon Rules**

Lets you override the addon for specific models. Useful when a model needs different instructions (e.g. a thinking model vs. a fast one).

Each rule card has:

| Field | Description |
|---|---|
| **Models (one per line)** | Model IDs this rule applies to — exact match against the active model |
| **Use global default** | When on: bypasses any server addon and uses the true Global System Addon |
| **Custom addon text** | Text to use when this rule matches (shown only when "Use global default" is off) |

Rules are checked in order from top to bottom — the first matching rule wins. Rules with no models listed are ignored.

**"Use global default" flag**

Normally a per-model rule replaces the server addon. If you want a specific model to always see the global default text (ignoring any server-level override), enable this toggle instead of writing the text again.

---

## Server System Addon

**Servers → click a server → Server Overrides → Server System Addon**

Overrides the Global System Addon for a specific server. Only active when:

- The Server Overrides toggle is on, **and**
- The Server System Addon toggle is on

Set the textarea content to what you want that server's requests to include. Leave the toggle off to inherit from global.

An empty textarea with the toggle on sends no addon text for that server (effectively suppresses the global default).

---

## Examples

### Single global rule

Set **Global System Addon** to:
```
Keep all replies to 3 sentences or fewer.
```
Every character on every server uses it.

### Server-specific language

Server A: set Server System Addon to `Respond in Slovak.`
Server B: leave toggle off → falls back to global.

### Model-specific instructions

Add a per-model rule for `openai/o3`:
- Models: `openai/o3`
- Custom text: `Do not use markdown. Reply in plain text only.`

All other models use the global or server addon.

### Force global for one model

Add a per-model rule for `llama-3.1-8b-instant`:
- Enable **Use global default**

Even if the server has its own addon, this model always sees the global text.

---

## See also

- [AI Config](02-ai-config.md) — global bot settings
- [Servers & channels](04-servers.md) — per-server configuration
