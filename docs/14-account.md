# Account settings

**Account settings** (`/account`) is each user's own page. Open it by clicking your
avatar at the bottom of the sidebar and choosing **Account settings**. Everything on
it is self-scoped: it only ever reads or changes the signed-in user's own data.

## Identity

Shows your avatar, username and role badge, plus how you signed in (Discord or a
panel account). Below that: your Discord ID (Discord accounts only), when the account
was created, when the current session started, and the auth provider.

## Appearance

- **Theme** - the same Light / Dark switch as in the sidebar user menu.
- **Compact lists** - tighter rows in Scheduler and Logs. Stored in the browser
  (`localStorage`), so it does not follow you to another device.

## Active sessions

Every session your account currently has, with the device guessed from the browser's
user agent, when it started and when it expires. The session you are using is marked
**THIS DEVICE** and cannot be revoked from here - use **Log out** for that.

- **Revoke** ends one other session.
- **Sign out everywhere else** ends every session except the current one.

Sessions are addressed by an opaque reference, never by the session token itself, and
the endpoints filter to the caller, so one user cannot list or revoke another user's
sessions. Admins who need to manage *other* people's sessions use `/users` instead.

| Endpoint | What it does |
|---|---|
| `GET /api/users/me/sessions` | Your own active sessions |
| `DELETE /api/users/me/sessions` | Sign out everywhere else |
| `DELETE /api/users/me/sessions/{ref}` | Revoke one of your sessions |

## Role & access

Your role and scope, the servers you can reach, and the list of things your role may
do. Mods are always limited to the servers assigned to them - a mod with no assigned
servers reaches none, which the page states explicitly. Admin and super admin reach
all servers. See [Users](09-users.md) for how roles are granted.

## Your usage

Messages, tokens and errors attributed to you over the last 30 days, taken from the
Discord logs. The card is hidden when there is nothing to show, and for roles below
mod, which cannot read stats.

## Security

Shows whether a password is set and when the current session expires.

The **New password** field only appears when changing it would actually succeed: the
password endpoint is admin-and-above and refuses Discord accounts, so a mod or a
Discord-authenticated user will not see it. Ask an admin instead, or see
[Panel Security](07-panel-security.md).
