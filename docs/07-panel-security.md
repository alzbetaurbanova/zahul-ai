# Panel Security

The panel has **no login requirement** by default. Turn protection on before you expose the panel to the internet.

## Login methods

You can enable one or both:

| Method | How it works |
|---|---|
| **Unique account login** | Username + password in the local database |
| **Discord OAuth login** | Discord authorization, then session cookie |

## Setup: local account

1. Open **AI Config -> Panel Security**
2. Enable **Unique account login**
3. Set **Owner username** and **Owner password** (minimum length as shown in the panel)
4. Save the owner account
5. Enable **Protect panel**
6. Save security settings

Sign in at `/login` with that username and password.

> The initial owner / super-admin account created here is permanent in the sense intended by the app - do not lose the password if this is your only login path.

## Setup: Discord OAuth

Step-by-step (Discord application, redirect URI, Client ID/secret): [Discord OAuth](08-discord-oauth.md).

After OAuth is configured, enable **Discord OAuth login**, fill credentials, then enable **Protect panel** and save.

## Using both methods

Both can be active. The login page shows every enabled method. That gives you a backup if one path breaks.

## Trusted Discord usernames (when Discord login is on)

**Trusted Discord usernames** must list at least one Discord `@handle` (one per line). Saving may fail if Discord login is enabled and the list is empty. Exact behavior (first sign-in, access requests) is described in [Discord OAuth](08-discord-oauth.md) and [Users](09-users.md).

## Disabling protection

Turn off **Protect panel** and save. The panel becomes reachable without login immediately.

## Recovery: locked out

1. Stop the server  
2. Open `data/bot.db` in any SQLite tool  
3. In table `config`, set `panel_auth_enabled` to `false`  
4. Restart  

Or:

```bash
sqlite3 data/bot.db "UPDATE config SET value='false' WHERE key='panel_auth_enabled';"
```
