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
4. Click **Save Security Settings**

## Step 5 — Test before enabling protection

1. Open a private/incognito window
2. Go to `/login`
3. Click **Login with Discord** — Discord will ask you to authorize
4. After authorizing you should be redirected back and logged in

Once confirmed working, enable **Protect panel** and save.

## First Discord login becomes the owner

If no local owner account exists when someone logs in via Discord, that Discord account is automatically set as the owner. This is the bootstrap path for Discord-only setups.

## Restricting access by username

In the **Allowed Discord usernames** field, add the `@handle` of each person allowed in (one per line). Leave empty to allow any Discord account.

Example:
```
johndoe
janedoe
```

## Troubleshooting

| Error on `/login` | Cause |
|---|---|
| `Discord login failed. Please retry.` | OAuth state expired or invalid callback — try again |
| `Your Discord account is not authorized` | Your username is not on the allowed list |
| Redirect URI mismatch error from Discord | The URI in the panel doesn't match what's registered on the Developer Portal |
| `Not Found` after OAuth redirect | Wrong domain — check that the redirect URI matches where the panel is actually running |
