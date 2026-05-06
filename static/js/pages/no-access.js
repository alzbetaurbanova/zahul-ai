document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('request-access-btn');
    const statusEl = document.getElementById('request-status');
    const errEl = document.getElementById('request-error');

    function setError(msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
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

    refreshStatus();
});
