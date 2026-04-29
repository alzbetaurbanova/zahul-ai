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

    // Hide logout if auth disabled
    fetch('/api/auth-enabled').then(r => r.json()).then(d => {
        if (!d.enabled) container.querySelectorAll('a[href="/logout"]').forEach(el => el.style.display = 'none');
    });

    // Bot status polling
    const indicator = document.getElementById('bot-status-indicator');
    const statusText = document.getElementById('bot-status-text');
    if (indicator && statusText) {
        const classes = ['status-active', 'status-inactive', 'status-starting'];
        function updateStatus(status) {
            indicator.classList.remove(...classes);
            if (status === 'active') { indicator.classList.add('status-active'); statusText.textContent = 'Active'; }
            else if (status === 'starting' || status === 'stopping') { indicator.classList.add('status-starting'); statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1); }
            else { indicator.classList.add('status-inactive'); statusText.textContent = 'Inactive'; }
        }
        let _pollInterval = null;
        function poll() { fetch('/api/discord/status').then(r => r.json()).then(d => updateStatus(d.status)).catch(() => updateStatus('inactive')); }
        function startPolling() { clearInterval(_pollInterval); poll(); _pollInterval = setInterval(poll, 60000); }
        startPolling();
        container.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', startPolling));
    }
})();
