(async function () {
    const container = document.getElementById('navbar-container');
    container.style.minHeight = '64px';

    const res = await fetch('/static/templates/navbar.html');
    const html = await res.text();
    container.style.minHeight = '';
    container.innerHTML = html;

    // Mark active link (desktop + mobile)
    const page = document.body.dataset.page || window.activePage || '';
    container.querySelectorAll('[data-page]').forEach(a => {
        if (a.dataset.page === page) {
            a.classList.add('active', 'text-white');
            a.classList.remove('text-gray-300');
        }
    });

    // Hamburger toggle
    const hamburger = container.querySelector('#nav-hamburger');
    const mobileMenu = container.querySelector('#nav-mobile-menu');
    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });
        mobileMenu.querySelectorAll('a[data-page]').forEach(a => {
            a.addEventListener('click', () => mobileMenu.classList.add('hidden'));
        });
    }

    // Show logout only if auth enabled — cached to avoid flash
    function setLogoutVisible(visible) {
        const desktopLogout = container.querySelector('a.nav-logout');
        const mobileLogout = container.querySelector('a.nav-mobile-logout');
        if (desktopLogout) desktopLogout.style.visibility = visible ? 'visible' : 'hidden';
        if (mobileLogout) mobileLogout.classList.toggle('hidden', !visible);
    }
    if (localStorage.getItem('auth-enabled') === '1') setLogoutVisible(true);
    fetch('/api/auth-enabled').then(r => r.json()).then(d => {
        localStorage.setItem('auth-enabled', d.enabled ? '1' : '0');
        setLogoutVisible(d.enabled);
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
