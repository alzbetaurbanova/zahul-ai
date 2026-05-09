# Users and roles

Manage panel accounts at **`/users`** (requires **admin** or higher).

## Roles

| Role | Typical use |
|------|-------------|
| **super_admin** | Full control; only super admins can assign or remove this role from others. There must always be at least one super admin. First Discord sign-in from a **trusted username** can elevate `pending` → `super_admin` (see [Panel Security](02-panel-security.md)). |
| **admin** | User list, roles (except promoting/demoting **super_admin**), access requests, servers/channels, most panel APIs. |
| **mod** | Read-focused panel areas; optional **per-server** scope (see below). |
| **guest** | Minimal API access (e.g. bot status); many panel pages expect **admin** for writes. |
| **pending** | Discord user signed in but not yet assigned a role — redirected to **`/no-access`** until an admin approves or denies ([Discord OAuth](03-discord-oauth.md)). |

Authorization uses a fixed order: `super_admin` (4) → `admin` (3) → `mod` (2) → `guest` (1) (`api/auth.py`). An endpoint that requires **`admin`** is available to **admin** and **super_admin**, not to **mod** or **guest**.

When **Protect panel** is off (`panel_auth_enabled` false), the backend treats requests as **super_admin** for authorization (`main.py` / `api/auth.py`).

## What each role can do (API)

Summarized from `require_role(...)` on routers. If the UI calls an endpoint that needs **admin**, users below that level get **403**.

| Area | guest | mod | admin | super_admin |
|------|:-----:|:---:|:-----:|:-----------:|
| **AI Config** `GET` | yes (sensitive fields blanked) | yes (blanked) | full | full |
| **AI Config** `PUT`, bot activate/deactivate, stream logs | — | — | yes | yes |
| **Panel Security** (owner password, OAuth fields, Protect panel) | — | — | — | yes |
| **Characters** `GET` (list / detail) | yes | yes | yes | yes |
| **Characters** create / update / delete / import | — | — | yes | yes |
| **Presets** list / get | — | yes | yes | yes |
| **Presets** create / update / delete | — | — | yes | yes |
| **Servers & channels** list / read | — | yes¹ | yes | yes |
| **Servers & channels** create / update / delete | — | — | yes | yes |
| **Scheduler tasks** list / get | — | yes² | yes | yes |
| **Scheduler tasks** create / update / delete | — | — | yes | yes |
| **Logs**, **Trash**, **Plugins** | — | — | yes | yes |
| **Users** list, edit role³ / servers / password / delete, access requests | — | — | yes | yes |
| **Users** `POST` (new account) | — | — | — | yes |
| **Discord** bot status check | yes | yes | yes | yes |
| **Discord** invite URL | — | yes | yes | yes |

¹ **Mod** only sees servers (and their channels) whose IDs are assigned on their user row in **`/users`**. **Admin** and **super_admin** see everything.

² **Mod** only sees **channel** tasks whose channel belongs to an assigned server. Tasks targeting **DM** or unknown channels are omitted.

³ Changing a user to or from **super_admin** requires **super_admin**; demoting the last super admin is blocked.

## Access requests

Users with Discord login who are not on the trusted list can submit **Request access** on `/no-access`. Admins review under **Users → Requests**, approve with a role, or deny. Super admins linked to Discord may receive a DM when a new request arrives.

## Practical notes

- **Owner password** for the initial super admin is set under **AI Config → Panel Security**, not on `/users`.
- Password resets for **super_admin** (local) use Panel Security; `/users` password change API skips super_admin rows.
- Assign **server IDs** to a **mod** from **`/users`** so they can browse only those guilds and related scheduler tasks.
