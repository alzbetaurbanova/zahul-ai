# Slash commands

These commands are registered on the bot and are meant to be run **in Discord** (in a server channel or in DMs, depending on the command). Many admin-style commands are **ephemeral** (only you see the result). **`/about`** and some **tool** flows post publicly — details below.

Slash command **names** and **descriptions** shown in Discord are in **English**. Tool commands include **`/rolldice`** (standard dice), **`/random`** (any integer range), **`/wheel`**, **`/search`**, **`/image`**.

## Channel setup

| Command | What it does |
|---|---|
| `/register_channel` | Initializes the current channel for the bot |
| `/unregister_channel` | Removes the current channel from the bot |

## Whitelist

| Command | What it does |
|---|---|
| `/whitelist add` | Adds one or more characters (comma-separated names) to this channel’s whitelist |
| `/whitelist remove` | Removes characters from the whitelist |
| `/whitelist view` | Shows which characters may speak here |

## Character info

| Command | What it does |
|---|---|
| `/about <name>` | Posts the character’s public “about” text in the channel (visible to everyone) |

## Tokens and models

| Command | What it does |
|---|---|
| `/tokens` | Shows token usage and active model (ephemeral) |

## Fallback model

| Command | What it does |
|---|---|
| `/fallback status` | Whether fallback mode is active and when the primary returns |
| `/fallback on` | Manually enable fallback |
| `/fallback off` | Manually disable fallback |

## Bot-to-bot chain limit (`autocap`)

Controls how many times the bot may reply in a row to another bot (chain limit from AI Config).

| Command | What it does |
|---|---|
| `/autocap set <value>` | Set the chain limit |
| `/autocap off [hours]` | Disable the limit temporarily; reverts after `hours` (default if omitted: see bot help) |
| `/autocap on` | Re-enable using the last stored value |
| `/autocap reset` | Reset to the value from AI Config |
| `/autocap status` | Current chain limit state |

## Reminder

| Command | What it does |
|---|---|
| `/reminder` | Schedules a **one-off** reminder in the **current** channel or DM. **`when`** must be `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS` in the **`Europe/Bratislava`** timezone (same as the [Scheduler](05-scheduler.md) panel). Arguments: character, time, text, and optional mode (`exact` or `generate`). |

For richer scheduling (repeating jobs, panel UI), use [Scheduler](05-scheduler.md).

## Tools

**`/rolldice`**, **`/random`**, **`/wheel`**, **`/search`**, and **`/image`** are available only as slash commands below.

### When they work

- **Server:** the channel must be registered with `/register_channel`.
- **DM:** your Discord username must be in **AI Config → DM access** (same rules as normal chat with the bot).

### Optional parameter **character**

- If you **omit** it: you get the tool output only (see each command).
- If you **set** it to an existing character name: the bot **defers** (public “thinking”), runs the **same LLM + webhook pipeline** as normal chat, and posts an **in-character** reply. Activity logs use `source: slash` for those generations.

---

### `/rolldice`

**What it does:** Rolls **standard RPG dice** only: **d4, d6, d8, d10, d12, d20, d100**. Each die is **1** … **N** inclusive. You can roll several of the same type at once.

**Parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `die` | No | One of **d4, d6, d8, d10, d12, d20, d100**. Default **d6**. |
| `count` | No | How many of that die, **1–50**. Default **1**. |
| `character` | No | Short in-character reaction (webhook), optional. |

**How to use:**

- Default: `/rolldice` → one **d6**, ephemeral (e.g. `🎲 d6: **4**`).
- `/rolldice die:d20 count:2` → two d20s and the sum.
- `/rolldice character:Echo die:d100` → percentile roll + in-character reply.

For arbitrary integer ranges (e.g. **7–42**, huge bounds, many draws), use **`/random`** below.

---

### `/random`

**What it does:** Uniform random **integer(s)** in an inclusive range. Not limited to polyhedral dice; values are clamped to ±10¹² for safety.

**Parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `maximum` | **Yes** | Upper bound (inclusive). If you **omit** `minimum`, the range is **0..maximum** (one number in the form = “from 0 to that number”). |
| `minimum` | No | Lower bound (inclusive). Omit for **0..maximum**. If both are set and `minimum` is greater than `maximum`, the bot swaps them. |
| `count` | No | Independent draws, **1–100**. Default **1**. |
| `character` | No | Optional in-character reaction. |

**How to use:**

- `/random maximum:100` → one integer in **0..100**, ephemeral.
- `/random minimum:1 maximum:100` → one integer in **1..100**.
- `/random minimum:-5 maximum:5 count:10` → ten integers in \[-5, 5\].

---

### `/wheel`

**What it does:** Picks **one** option at random from a list you provide.

**Parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `choices` | **Yes** | At least **two** items, separated by **commas** and/or **`|`** (pipe). Example: `tea, coffee, water` or `A \| B \| C`. |
| `character` | No | Optional character — short reply **in-character** (that character’s persona), same style as normal chat. |

**How to use:**

- `/wheel choices:film, series, book` → **ephemeral** message with the winner.
- `/wheel choices:Yes,No character:MyChar` → public in-character comment on the outcome.

---

### `/search`

**What it does:** Web **research**: the bot gathers snippets (LLM-assisted search terms plus DuckDuckGo-style results) and returns a text summary.

**Parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `query` | **Yes** | What to look up (natural language is fine). |
| `character` | No | Optional character — summarizes or comments **in-character** (that persona), not voice/audio. |

**How to use:**

- `/search query:weather in London` → long text **only to you** (ephemeral).
- `/search query:… character:Echo` → **public** in-character reply grounded on the gathered snippets (may take longer; uses your text LLM).

---

### `/image`

**What it does:** Generates one image via **ElectronHub** (model `flux-dev`).

**Parameters:**

| Parameter | Required | Notes |
|---|---|---|
| `prompt` | **Yes** | Image description in any language the model accepts. |
| `character` | No | Optional: send the image **as that character’s webhook**, then a short **in-character** comment. |

**Config:** uses **`ai_key`** from **[AI Config](02-ai-config.md)** (same field as the primary text API in this project). If the key is missing, the command errors.

**How to use:**

- `/image prompt:sunset over the city, anime style` → image posted to the channel (follow-up after defer).
- `/image prompt:… character:Luna` → image appears as **Luna**, then Luna comments on it.

---

## Context menus (right-click)

Right-click a message from the bot:

| Menu | Purpose |
|---|---|
| **Edit Bot Message** | Edit the bot’s message |
| **Delete Bot Message** | Delete the bot’s message |
| **Edit / View Caption** | Edit or view image caption |

## See also

- [Servers & channels](04-servers.md) - invite and registration workflow  
- [AI Config](02-ai-config.md) - API keys and DM allowlist  
- [CHANGES.md](../CHANGES.md) - changelog and feature notes  
