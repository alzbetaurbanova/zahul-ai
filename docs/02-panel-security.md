# Panel Security

The panel has no login protection by default. Enable it before exposing the panel to the internet.

## Login methods

Two independent login methods are available. You can enable one or both:

| Method | How it works |
|---|---|
| **Unique account login** | Username + password stored in the local database |
| **Discord OAuth login** | Redirect to Discord → authorize → callback → session |

## Setup: local account login

1. Open **AI Config → Panel Security**
2. Enable **Unique account login**
3. Fill in **Owner username** and **Owner password** (min. 8 characters)
4. Click **Save owner account**
5. Enable **Protect panel**
6. Click **Save Security Settings**

You can now log in at `/login` with your username and password.

> **Note:** The owner account cannot be deleted or demoted. It is permanent.

## Setup: Discord OAuth login

See the full walkthrough: [Discord OAuth Login](03-discord-oauth.md)

Once OAuth is configured, enable **Discord OAuth login**, fill in the credentials, then enable **Protect panel** and save.

## Using both methods

Both methods can be active at the same time. The login page shows whichever methods are enabled. This is the safest setup — if one method breaks you can still get in with the other.

> It is recommended to enable and verify both login methods before turning on Protect panel.

## Restricting Discord logins

Under **Discord OAuth login**, the **Allowed Discord usernames** field accepts a list of usernames (one per line). Only those accounts can log in via Discord. Leave empty to allow any Discord account that completes OAuth.

Username means the `@handle` (e.g. `johndoe`), not the display name.

## Disabling protection

Toggle off **Protect panel** in AI Config → Panel Security and save. The panel becomes publicly accessible immediately.

## Recovery: locked out

If you are locked out and cannot log in:

1. Stop the server
2. Open `data/bot.db` with any SQLite viewer
3. Find the `config` table, set `panel_auth_enabled` to `false`
4. Restart — the panel loads without a prompt

Or from the command line:
```bash
sqlite3 data/bot.db "UPDATE config SET value='false' WHERE key='panel_auth_enabled';"
```
