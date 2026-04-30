(async function () {
    const container = document.getElementById('navbar-container');
    container.style.minHeight = '64px';

    const res = await fetch('/static/navbar.html');
    const html = await res.text();
    container.style.minHeight = '';
    container.innerHTML = html;

    // Mark active link
    const page = window.activePage || '';
    container.querySelectorAll('[data-page]').forEach(a => {
        if (a.dataset.page === page) {
            a.classList.add('active', 'text-white');
            a.classList.remove('text-gray-300');
        }
    });

    // Show logout only if auth enabled — cached to avoid flash
    const logoutEl = container.querySelector('a[href="/logout"]');
    if (logoutEl && localStorage.getItem('auth-enabled') === '1') logoutEl.style.visibility = 'visible';
    fetch('/api/auth-enabled').then(r => r.json()).then(d => {
        localStorage.setItem('auth-enabled', d.enabled ? '1' : '0');
        if (logoutEl) logoutEl.style.visibility = d.enabled ? 'visible' : 'hidden';
    });

    // Bot status polling
    const indicator = document.getElementById('bot-status-indicator');
    const statusText = document.getElementById('bot-status-text');
    if (indicator && statusText) {
        const classes = ['status-active', 'status-inactive', 'status-starting'];
        function updateStatus(status, persist = true) {
            indicator.classList.remove(...classes);
            if (status === 'active') { indicator.classList.add('status-active'); statusText.textContent = 'Active'; }
            else if (status === 'starting' || status === 'stopping') { indicator.classList.add('status-starting'); statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1); }
            else { indicator.classList.add('status-inactive'); statusText.textContent = 'Inactive'; }
            if (persist) localStorage.setItem('bot-status', status);
        }
        const cached = localStorage.getItem('bot-status');
        if (cached) updateStatus(cached, false);
        let _pollInterval = null;
        function poll() { fetch('/api/discord/status').then(r => r.json()).then(d => updateStatus(d.status)).catch(() => {}); }
        function startPolling() { clearInterval(_pollInterval); poll(); _pollInterval = setInterval(poll, 60000); }
        startPolling();
        container.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', startPolling));
    }
})();
