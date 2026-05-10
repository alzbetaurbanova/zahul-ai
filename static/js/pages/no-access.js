document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('request-access-btn');
    const statusEl = document.getElementById('request-status');
    const errEl = document.getElementById('request-error');

    /** Roles that may use the panel (not pending / rejected). Must match middleware allow-list in main.py */
    const PANEL_ROLES = new Set(['super_admin', 'admin', 'mod', 'guest']);

    let pollTimer = null;

    function setError(msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    }

    async function redirectIfApproved() {
        try {
            const res = await fetch('/api/auth-status');
            const data = await res.json();
            const role = data.current_user && data.current_user.role;
            if (role && PANEL_ROLES.has(String(role))) {
                if (pollTimer !== null) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
                window.location.replace('/');
            }
        } catch (_) {
            /* offline or error — try again on next poll */
        }
    }

    async function refreshStatus() {
        try {
            const res = await fetch('/api/users/requests/me');
            const data = await res.json();
            if (res.ok && data.pending) {
                statusEl.textContent = 'Your request is pending review.';
                btn.disabled = true;
                btn.classList.add('opacity-60', 'cursor-not-allowed');
            }
        } catch (_) {}
    }

    btn.addEventListener('click', async () => {
        errEl.classList.add('hidden');
        btn.disabled = true;
        try {
            const res = await fetch('/api/users/requests', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to submit request.');
            statusEl.textContent = 'Your access request has been sent. Please wait for approval.';
            btn.classList.add('opacity-60', 'cursor-not-allowed');
        } catch (e) {
            btn.disabled = false;
            setError(String(e));
        }
    });

    redirectIfApproved();
    refreshStatus();
    pollTimer = setInterval(redirectIfApproved, 60 * 60 * 1000);
});
