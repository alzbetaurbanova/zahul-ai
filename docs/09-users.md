# Users

Manage panel accounts at **`/users`**. Who may open this page and change accounts depends on panel login and permissions - this document summarizes roles and workflows; the enforcement lives in `api/auth.py` and the FastAPI routers.

## Roles (summary)

| Role | Typical use |
|------|-------------|
| **super_admin** | Full control including panel security and creating users. At least one must exist when protection is on. |
| **admin** | User list, roles (with limits on **super_admin**), access requests, most management APIs. |
| **mod** | Read-heavy access; may be limited to specific Discord servers (assigned in the user editor). |
| **guest** | Minimal API access. |
| **pending** | Discord user signed in but not yet assigned a panel role - usually redirected to **`/no-access`** until an admin acts. |

When **Protect panel** is off, the backend treats requests as fully privileged for authorization purposes - still secure your host if the process listens on `0.0.0.0`.

## Access requests

Users who sign in with Discord but are not yet approved may submit **Request access** on `/no-access`. Admins review under **Users -> Requests** (wording may vary by build).

## Practical notes

- Initial **owner / super-admin password** is set under **AI Config -> Panel Security**, not only on `/users`.  
- **Trusted Discord usernames** and OAuth are covered in [Discord OAuth](08-discord-oauth.md) and [Panel Security](07-panel-security.md).  
- **Mods** may have **server IDs** assigned on their user row so they only see those guilds and related scheduler tasks.

## API-level overview

The UI calls REST endpoints guarded by `require_role(...)`. If an action returns **403**, the signed-in account does not meet the minimum role for that route. Exact matrices change with releases; use `/users` and server logs when debugging permission issues.
