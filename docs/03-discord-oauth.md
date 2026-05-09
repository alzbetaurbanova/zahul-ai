# Discord OAuth Login

Step-by-step guide for enabling "Login with Discord" on the panel.

## Step 1 — Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** — give it any name (e.g. `zahul-ai panel`)
3. Open the **OAuth2** tab in the left sidebar

## Step 2 — Copy your credentials

On the **OAuth2** page:

- **Client ID** — shown at the top, copy it
- **Client Secret** — click **Reset Secret**, confirm, copy the value immediately (it won't be shown again)

> Never share the Client Secret. If you lose it, reset it on the Developer Portal.

## Step 3 — Add the redirect URI

Still on the **OAuth2** page, under **Redirects**:

1. Click **Add Redirect**
2. Enter your callback URL:
   - Local: `http://localhost:5666/auth/discord/callback`
   - Production: `https://yourdomain.com/auth/discord/callback`
3. Click **Save Changes**

The redirect URI must match **exactly** — same protocol, domain, port, and path.

## Step 4 — Configure in the panel

1. Open **AI Config → Panel Security**
2. Enable **Discord OAuth login**
3. Fill in:
   - **Client ID** — from Step 2
   - **Client Secret** — from Step 2
   - **Redirect URI** — same URL you added in Step 3
   - **Trusted Discord usernames** — at least your own `@handle` (one per line). Required while Discord login is on.
4. Click **Save Security Settings**

## Step 5 — Test before enabling protection

1. Open a private/incognito window
2. Go to `/login`
3. Click **Login with Discord** — Discord will ask you to authorize
4. After authorizing you should be redirected back and logged in

Once confirmed working, enable **Protect panel** and save.

## Trusted Discord usernames (required when Discord login is on)

In **AI Config → Panel Security**, **Trusted Discord usernames**:

- **Discord login enabled** — You must add **at least one** `@handle` (one per line, not display names). Each listed account becomes **`super_admin` on first Discord sign-in** while the role is still `pending` (or legacy `user`). Accounts **not** listed can still sign in with Discord and submit **Request access** on `/no-access`.
- **Discord login disabled** — The field is optional and not validated.

Example allowlist:
```
johndoe
janedoe
```

## Troubleshooting

| Error on `/login` | Cause |
|---|---|
| `Discord login failed. Please retry.` | OAuth state expired or invalid callback — try again |
| Redirect URI mismatch error from Discord | The URI in the panel doesn't match what's registered on the Developer Portal |
| `Not Found` after OAuth redirect | Wrong domain — check that the redirect URI matches where the panel is actually running |
