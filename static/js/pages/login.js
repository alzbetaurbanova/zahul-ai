const params = new URLSearchParams(window.location.search);
const discordLoginBtn = document.getElementById('discord-login');
const loginForm = document.getElementById('login-form');
const loginDivider = document.getElementById('login-divider');
const authUnavailableMsg = document.getElementById('auth-unavailable-msg');

if (params.get('error')) {
    document.getElementById('error-msg').classList.remove('hidden');
} else {
    localStorage.removeItem('login_attempts');
}

if (params.get('oauth_error')) {
    document.getElementById('oauth-error-msg').classList.remove('hidden');
}

async function loadAuthStatus() {
    try {
        const resp = await fetch('/api/auth-status');
        if (!resp.ok) return;
        const data = await resp.json();
        const showDiscord = !!data.discord_login_enabled;
        const showLocal = !!data.local_login_enabled;
        discordLoginBtn.classList.toggle('hidden', !showDiscord);
        loginForm.classList.toggle('hidden', !showLocal);
        loginDivider.classList.toggle('hidden', !(showDiscord && showLocal));
        authUnavailableMsg.classList.toggle('hidden', showDiscord || showLocal);

        if (showDiscord && !data.discord_oauth_configured) {
            document.getElementById('oauth-error-msg').textContent = 'Discord login is enabled but OAuth credentials are not configured.';
            document.getElementById('oauth-error-msg').classList.remove('hidden');
        }
    } catch (_error) {
        // Keep default UI behavior.
    }
}
loadAuthStatus();
