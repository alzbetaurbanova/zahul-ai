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

    const userMenuBtn = container.querySelector('.nav-user-btn');
    const userMenu = container.querySelector('.nav-user-menu');
    const userMenuName = container.querySelector('.nav-user-name');
    const userAvatar = container.querySelector('.nav-user-avatar');
    const userBadge = container.querySelector('.nav-user-badge');
    const DEFAULT_AVATAR = '/static/avatars/default_user_avatar.png';

    // Show profile menu only if auth enabled — cached to avoid flash
    function setLogoutVisible(visible) {
        const mobileLogout = container.querySelector('a.nav-mobile-logout');
        if (userMenuBtn) userMenuBtn.classList.toggle('hidden', !visible);
        if (userMenu) userMenu.classList.add('hidden');
        if (userMenuBtn) userMenuBtn.setAttribute('aria-expanded', 'false');
        if (mobileLogout) mobileLogout.classList.toggle('hidden', !visible);
    }

    function setUserIdentity(identity = {}) {
        const username = String(identity.username || 'user');
        const avatarUrl = String(identity.avatar_url || DEFAULT_AVATAR);
        if (userMenuName) userMenuName.textContent = username;
        if (userAvatar) {
            userAvatar.src = avatarUrl;
            userAvatar.onerror = () => { userAvatar.src = DEFAULT_AVATAR; };
        }
    }

    function setBadgeVisible(visible) {
        if (userBadge) userBadge.classList.toggle('hidden', !visible);
    }

    function setRoleBadge(role) {
        if (!userBadge) return;
        const map = {
            super_admin: 'fa-crown',
            admin: 'fa-shield-halved',
            mod: 'fa-gavel',
            guest: 'fa-star',
        };
        userBadge.classList.remove('role-super_admin', 'role-admin', 'role-mod', 'role-guest');
        if (role) userBadge.classList.add(`role-${role}`);
        userBadge.title = role ? `Role: ${role}` : 'User role';
        userBadge.setAttribute('aria-label', role ? `Role: ${role}` : 'User role');

        const iconClass = map[role] || 'fa-user';
        userBadge.innerHTML = `<i class="fas ${iconClass}"></i>`;
        setBadgeVisible(!!role);
    }

    if (userMenuBtn && userMenu) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = !userMenu.classList.contains('hidden');
            userMenu.classList.toggle('hidden', open);
            userMenuBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
        });
        document.addEventListener('click', (e) => {
            if (!userMenu.classList.contains('hidden') && !userMenuBtn.contains(e.target) && !userMenu.contains(e.target)) {
                userMenu.classList.add('hidden');
                userMenuBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function applyNavVisibility(authEnabled, role) {
        const usersLink = container.querySelector('a.nav-users-link');
        const usersMobileLink = container.querySelector('a.nav-users-mobile-link');
        const adminLink = container.querySelector('a.nav-admin-link');
        const adminMobileLink = container.querySelector('a.nav-admin-mobile-link');
        const showUsers = authEnabled && (role === 'super_admin' || role === 'admin');
        const showAdmin = !authEnabled || role === 'super_admin';
        if (usersLink) usersLink.classList.toggle('hidden', !showUsers);
        if (usersMobileLink) usersMobileLink.classList.toggle('hidden', !showUsers);
        if (adminLink) adminLink.classList.toggle('hidden', !showAdmin);
        if (adminMobileLink) adminMobileLink.classList.toggle('hidden', !showAdmin);
    }

    // Pre-apply from cache to avoid flash
    const _cachedAuth = localStorage.getItem('auth-enabled') === '1';
    const _cachedRole = localStorage.getItem('user-role') || '';
    const _cachedUsername = localStorage.getItem('user-name') || '';
    const _cachedAvatar = localStorage.getItem('user-avatar') || '';
    if (_cachedAuth) setLogoutVisible(true);
    if (_cachedAuth) {
        setUserIdentity({ username: _cachedUsername || 'user', avatar_url: _cachedAvatar || DEFAULT_AVATAR });
        setRoleBadge(_cachedRole);
    }
    applyNavVisibility(_cachedAuth, _cachedRole);

    // Auth status: resolve actual state
    fetch('/api/auth-status').then(r => r.json()).then(d => {
        const authEnabled = d.panel_auth_enabled;
        const currentUser = d.current_user || null;
        const role = d.current_user?.role || '';
        setLogoutVisible(authEnabled);
        if (authEnabled && currentUser) {
            setUserIdentity({ username: currentUser.username });
            setRoleBadge(role);
            fetch('/api/users/me')
                .then(r => (r.ok ? r.json() : null))
                .then(me => {
                    if (me) {
                        const resolvedUsername = me.username || currentUser.username || '';
                        const resolvedAvatar = me.avatar_url || DEFAULT_AVATAR;
                        setUserIdentity({ username: resolvedUsername, avatar_url: resolvedAvatar });
                        localStorage.setItem('user-name', resolvedUsername);
                        localStorage.setItem('user-avatar', resolvedAvatar);
                    }
                })
                .catch(() => {});
            localStorage.setItem('user-name', currentUser.username || '');
        }
        localStorage.setItem('auth-enabled', authEnabled ? '1' : '0');
        localStorage.setItem('user-role', role);
        applyNavVisibility(authEnabled, role);
    }).catch(() => {
        fetch('/api/auth-enabled').then(r => r.json()).then(d => {
            const authEnabled = !!d.enabled;
            localStorage.setItem('auth-enabled', authEnabled ? '1' : '0');
            setLogoutVisible(authEnabled);
            if (!authEnabled) {
                localStorage.removeItem('user-name');
                localStorage.removeItem('user-avatar');
                localStorage.removeItem('user-role');
            }
            applyNavVisibility(authEnabled, localStorage.getItem('user-role') || '');
        });
    });

    // Bot status in header: poll on load, every 60s, on each nav link click, and on bot-status-refresh (e.g. dashboard power).
    const NAVBAR_STATUS_POLL_MS = 60000;
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
        function poll() {
            fetch('/api/discord/status')
                .then(r => {
                    if (!r.ok) {
                        localStorage.removeItem('bot-status');
                        indicator.classList.remove(...classes);
                        indicator.classList.add('status-inactive');
                        statusText.textContent = r.status === 403 || r.status === 401 ? '—' : 'Unavailable';
                        return null;
                    }
                    return r.json();
                })
                .then(d => {
                    if (d && d.status) updateStatus(d.status);
                })
                .catch(() => {
                    localStorage.removeItem('bot-status');
                    indicator.classList.remove(...classes);
                    indicator.classList.add('status-inactive');
                    statusText.textContent = 'Unavailable';
                });
        }
        window.addEventListener('bot-status-refresh', (e) => {
            const d = (e && e.detail) || {};
            if (d.optimistic === 'starting' || d.optimistic === 'stopping') {
                updateStatus(d.optimistic, true);
            }
            poll();
        });
        function startPolling() { clearInterval(_pollInterval); poll(); _pollInterval = setInterval(poll, NAVBAR_STATUS_POLL_MS); }
        startPolling();
        container.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', startPolling));
    }
})();
