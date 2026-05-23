(async function () {
    const container = document.getElementById('navbar-container');
    container.style.minHeight = '64px';

    const res = await fetch('/static/templates/navbar.html');
    const html = await res.text();
    container.style.minHeight = '';
    container.innerHTML = html;

    // Apply cached avatar before other work to avoid default → reload flash
    if (localStorage.getItem('auth-enabled') === '1') {
        const earlyImg = container.querySelector('.nav-user-avatar');
        const earlyUrl = localStorage.getItem('user-avatar') || '';
        if (earlyImg && earlyUrl) {
            try {
                const blob = JSON.parse(localStorage.getItem('user-avatar-blob') || 'null');
                const key = (() => {
                    try {
                        const u = new URL(earlyUrl, location.origin);
                        return u.origin + u.pathname;
                    } catch {
                        return earlyUrl.split('?')[0];
                    }
                })();
                if (blob?.dataUrl && blob.url === key) {
                    earlyImg.src = blob.dataUrl;
                } else {
                    earlyImg.src = earlyUrl;
                }
            } catch {
                earlyImg.src = earlyUrl;
            }
        }
    }

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
    const AVATAR_URL_KEY = 'user-avatar';
    const AVATAR_BLOB_KEY = 'user-avatar-blob';
    const AVATAR_ME_TS_KEY = 'user-avatar-me-ts';
    const AVATAR_ME_TTL_MS = 5 * 60 * 1000;

    function avatarCompareKey(url) {
        if (!url) return '';
        try {
            const u = new URL(url, location.origin);
            return u.origin + u.pathname;
        } catch {
            return String(url).split('?')[0];
        }
    }

    function readAvatarBlobCache() {
        try {
            return JSON.parse(localStorage.getItem(AVATAR_BLOB_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function writeAvatarBlobCache(url, dataUrl) {
        if (!url || !dataUrl) return;
        localStorage.setItem(AVATAR_BLOB_KEY, JSON.stringify({
            url: avatarCompareKey(url),
            dataUrl,
            ts: Date.now(),
        }));
    }

    function resolveDisplayAvatar(url) {
        const normalized = (url && String(url).trim()) || DEFAULT_AVATAR;
        const blob = readAvatarBlobCache();
        if (blob && blob.dataUrl && blob.url === avatarCompareKey(normalized)) {
            return blob.dataUrl;
        }
        return normalized;
    }

    let _avatarPrefetching = null;

    function prefetchAvatarBlob(url) {
        const normalized = (url && String(url).trim()) || '';
        const isLocal = normalized.startsWith('/') || normalized.startsWith(location.origin);
        if (!normalized || !isLocal) {
            return Promise.resolve(null);
        }
        const abs = normalized.startsWith('/') ? (location.origin + normalized) : normalized;
        const blob = readAvatarBlobCache();
        if (blob && blob.url === avatarCompareKey(abs) && blob.dataUrl) {
            return Promise.resolve(blob.dataUrl);
        }
        if (_avatarPrefetching === abs) return _avatarPrefetching;
        _avatarPrefetching = fetch(abs, { credentials: 'same-origin', cache: 'force-cache' })
            .then(r => (r.ok ? r.blob() : null))
            .then(b => {
                if (!b) return null;
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(b);
                });
            })
            .then(dataUrl => {
                if (dataUrl) writeAvatarBlobCache(abs, dataUrl);
                return dataUrl;
            })
            .catch(() => null)
            .finally(() => { _avatarPrefetching = null; });
        return _avatarPrefetching;
    }

    function applyAvatarToImg(url) {
        if (!userAvatar) return;
        const displaySrc = resolveDisplayAvatar(url);
        const currentKey = avatarCompareKey(userAvatar.src);
        const nextKey = avatarCompareKey(displaySrc.startsWith('data:') ? (url || displaySrc) : displaySrc);
        if (currentKey === nextKey && userAvatar.src) return;
        userAvatar.src = displaySrc;
        userAvatar.onerror = () => {
            if (avatarCompareKey(userAvatar.src) !== avatarCompareKey(DEFAULT_AVATAR)) {
                userAvatar.src = DEFAULT_AVATAR;
            }
        };
        const raw = (url && String(url).trim()) || '';
        if (raw.startsWith('/static/') || raw.startsWith(location.origin + '/static/')) {
            prefetchAvatarBlob(raw).then(dataUrl => {
                if (!dataUrl || !userAvatar.isConnected) return;
                if (avatarCompareKey(localStorage.getItem(AVATAR_URL_KEY) || '') !== avatarCompareKey(raw)) return;
                if (avatarCompareKey(userAvatar.src) === avatarCompareKey(dataUrl)) return;
                userAvatar.src = dataUrl;
            });
        }
    }

    // Show profile menu only if auth enabled — cached to avoid flash
    function setLogoutVisible(visible) {
        const mobileLogout = container.querySelector('a.nav-mobile-logout');
        if (userMenuBtn) userMenuBtn.classList.toggle('hidden', !visible);
        if (userMenu) userMenu.classList.add('hidden');
        if (userMenuBtn) userMenuBtn.setAttribute('aria-expanded', 'false');
        if (mobileLogout) mobileLogout.classList.toggle('hidden', !visible);
    }

    function setUserIdentity(identity = {}) {
        const username = String(identity.username || userMenuName?.textContent || 'user');
        if (userMenuName) userMenuName.textContent = username;
        let avatarUrl = identity.avatar_url;
        if (avatarUrl === undefined || avatarUrl === null || avatarUrl === '') {
            avatarUrl = localStorage.getItem(AVATAR_URL_KEY) || DEFAULT_AVATAR;
        }
        avatarUrl = String(avatarUrl || DEFAULT_AVATAR);
        localStorage.setItem(AVATAR_URL_KEY, avatarUrl);
        applyAvatarToImg(avatarUrl);
    }

    function shouldRefreshMe() {
        const ts = parseInt(localStorage.getItem(AVATAR_ME_TS_KEY) || '0', 10);
        return !ts || (Date.now() - ts) > AVATAR_ME_TTL_MS;
    }

    function markMeRefreshed() {
        localStorage.setItem(AVATAR_ME_TS_KEY, String(Date.now()));
    }

    window.addEventListener('user-avatar-updated', (e) => {
        const url = e.detail?.avatar_url || e.detail?.url;
        if (url) {
            localStorage.removeItem(AVATAR_BLOB_KEY);
            localStorage.removeItem(AVATAR_ME_TS_KEY);
            setUserIdentity({ avatar_url: url });
        }
    });

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

    const themeBtnLight = container.querySelector('#theme-btn-light');
    const themeBtnDark = container.querySelector('#theme-btn-dark');
    if (themeBtnLight && themeBtnDark) {
        function applyThemeToggleUI(light) {
            themeBtnLight.classList.toggle('mode-tab-on', light);
            themeBtnLight.classList.toggle('mode-tab-off', !light);
            themeBtnDark.classList.toggle('mode-tab-on', !light);
            themeBtnDark.classList.toggle('mode-tab-off', light);
        }
        applyThemeToggleUI(localStorage.getItem('theme') === 'light');
        themeBtnLight.addEventListener('click', () => { localStorage.setItem('theme', 'light'); applyThemeToggleUI(true); });
        themeBtnDark.addEventListener('click', () => { localStorage.setItem('theme', 'dark'); applyThemeToggleUI(false); });
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
        const showAiConfig = !authEnabled || role === 'super_admin';
        if (usersLink) usersLink.classList.toggle('hidden', !showUsers);
        if (usersMobileLink) usersMobileLink.classList.toggle('hidden', !showUsers);
        if (adminLink) adminLink.classList.toggle('hidden', !showAiConfig);
        if (adminMobileLink) adminMobileLink.classList.toggle('hidden', !showAiConfig);
    }

    // Pre-apply from cache to avoid flash
    const _cachedAuth = localStorage.getItem('auth-enabled') === '1';
    const _cachedRole = localStorage.getItem('user-role') || '';
    const _cachedUsername = localStorage.getItem('user-name') || '';
    const _cachedAvatar = localStorage.getItem(AVATAR_URL_KEY) || '';
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
            setUserIdentity({
                username: currentUser.username,
                avatar_url: _cachedAvatar || localStorage.getItem(AVATAR_URL_KEY) || DEFAULT_AVATAR,
            });
            setRoleBadge(role);
            localStorage.setItem('user-name', currentUser.username || '');
            if (shouldRefreshMe()) {
                fetch('/api/users/me')
                    .then(r => (r.ok ? r.json() : null))
                    .then(me => {
                        if (!me) return;
                        const resolvedUsername = me.username || currentUser.username || '';
                        const resolvedAvatar = me.avatar_url || DEFAULT_AVATAR;
                        const prevKey = avatarCompareKey(localStorage.getItem(AVATAR_URL_KEY) || '');
                        const nextKey = avatarCompareKey(resolvedAvatar);
                        localStorage.setItem('user-name', resolvedUsername);
                        localStorage.setItem(AVATAR_URL_KEY, resolvedAvatar);
                        markMeRefreshed();
                        if (prevKey !== nextKey) {
                            localStorage.removeItem(AVATAR_BLOB_KEY);
                        }
                        setUserIdentity({ username: resolvedUsername, avatar_url: resolvedAvatar });
                    })
                    .catch(() => {});
            }
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
                localStorage.removeItem(AVATAR_URL_KEY);
                localStorage.removeItem(AVATAR_BLOB_KEY);
                localStorage.removeItem(AVATAR_ME_TS_KEY);
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
