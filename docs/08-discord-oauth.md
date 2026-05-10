# Discord OAuth Login

How to enable **Login with Discord** for the web panel.

## Step 1 - Create a Discord application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** - any name (e.g. `zahul-ai panel`)
3. Open **OAuth2** in the sidebar

## Step 2 - Credentials

On **OAuth2**:

- **Client ID** - copy from the top  
- **Client Secret** - reset if needed, copy once (it will not show again)

Treat the secret like a password.

## Step 3 - Redirect URI

Under **Redirects**:

1. **Add Redirect**
2. Add exactly one of:
   - Local: `http://localhost:5666/auth/discord/callback`
   - Production: `https://yourdomain.com/auth/discord/callback`
3. **Save Changes**

The value in the panel must match **character for character** (scheme, host, port, path).

## Step 4 - Panel configuration

1. **AI Config -> Panel Security**
2. Enable **Discord OAuth login**
3. Fill **Client ID**, **Client Secret**, **Redirect URI** (same as Step 3)
4. **Trusted Discord usernames** - at least your `@handle` (one per line) while Discord login is required; see [Panel Security](07-panel-security.md)
5. **Save Security Settings**

## Step 5 - Test before locking down

1. Open a private window  
2. Go to `/login`  
3. Use **Login with Discord** and complete authorization  

When that works, enable **Protect panel** and save.

## Trusted usernames

- With **Discord login on**, the trusted list is validated (non-empty).  
- Handles not on the list may still complete OAuth and use **Request access** on `/no-access`; admins handle that under **Users** - [Users](09-users.md).

Example (one handle per line):

```
johndoe
janedoe
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| OAuth state / retry errors | Expired state or bad callback - try again |
| Redirect mismatch from Discord | Panel URI ≠ Developer Portal redirect |
| 404 after redirect | Wrong host or path - panel URL must match redirect |
