# Dashboard, logs, avatar editor, and presets

Pages and features that are not covered in depth by the topic-specific guides.

## Navigation

Every panel page shares a **sidebar** pinned to the left edge. It is grouped into
**Main** (Dashboard, Characters, Scheduler, Servers, Simulator), **Administration**
(Users, AI Config) and **Insights** (Stats, Logs, Docs). Entries you are not allowed
to open are hidden, and a group whose entries are all hidden disappears with them.

- The round handle on the sidebar's edge collapses it to icons only; the choice is
  remembered in this browser.
- Below 900 px the sidebar becomes a drawer opened by the hamburger button.
- The bottom of the rail shows bot status and your avatar. Clicking the avatar opens
  the user menu: [Account settings](14-account.md), the theme toggle, and log out.

## Admin dashboard (`/`)

- **Bot control** - see whether the bot process is running, **Activate** / power control, and (when active) the **invite link** to add the bot to a server.
- **Uptime** - availability of the bot over a selectable range.
- **Console** - live log stream from the bot with optional auto-scroll.

Start or stop the bot here after saving [AI Config](02-ai-config.md). Servers and Stats
are reached from the sidebar rather than from shortcut cards on this page.

## Activity logs (`/logs`)

- **Discord** tab - per-interaction log: character, user, channel, model, tokens, trigger, response, source (chat vs scheduler), status.
- **Admin** tab - panel actions (characters, tasks, config, presets, etc.) with **actor** username; filters can narrow by user, action, date, and more.
- **Detail** - full request/response where stored; JSON export for the current filter set.

High-level behavior is also summarized in [CHANGES.md](../CHANGES.md) under Activity logs.

## Avatar editor (`/editor`)

Crop and preview a circular avatar, **Export PNG**, or **Save on Discord** to obtain a Discord CDN URL you can paste into a character’s avatar field. Open it from the characters flow or directly by URL.

## Prompt presets

The database stores named **prompt templates** (Jinja2). A **Default** preset is created on first run.

- In **AI Config**, the panel loads and saves the **Default** preset’s `prompt_template` (and keeps its description).
- Additional presets (create, rename, delete) are available through the **`/api/presets`** API for users with sufficient panel role (`admin` for create/update/delete; `mod` can list and read). Use that if you maintain multiple templates outside the single Default editor.

Character-level behavior still follows [Characters](03-characters.md); global template editing is on **AI Config**.

## Trash API

Many panel deletes (characters, channels, servers, presets, scheduled tasks, and some log rows) copy the row to a trash table before removal. There is **no** dedicated trash page in the static panel; **admin** users can use the HTTP API:

- `GET /api/trash` - list items  
- `GET /api/trash/{id}` - one item  
- `POST /api/trash/{id}/restore` - restore into the main tables  

Successful restores are logged on the **Admin** tab in `/logs`.
