/**
 * Theme scaffold — default dark. All theme tokens in /static/css/theme.css.
 *
 * Persistence (today): localStorage key `zahul_theme`.
 * Future: user.theme from GET /api/me or PATCH user prefs → call syncFromSession().
 */
(function (global) {
    const STORAGE_KEY = 'zahul_theme';
    const DEFAULT_THEME = 'dark';
    const VALID = new Set(['dark', 'light']);

    function normalize(theme) {
        return VALID.has(theme) ? theme : DEFAULT_THEME;
    }

    function getTheme() {
        return normalize(document.documentElement.getAttribute('data-theme') || DEFAULT_THEME);
    }

    function readStored() {
        try {
            const legacy = localStorage.getItem('theme');
            const stored = localStorage.getItem(STORAGE_KEY) || legacy;
            if (legacy && !localStorage.getItem(STORAGE_KEY)) {
                localStorage.setItem(STORAGE_KEY, normalize(legacy));
                localStorage.removeItem('theme');
            }
            return normalize(stored || DEFAULT_THEME);
        } catch {
            return DEFAULT_THEME;
        }
    }

    /** When API exposes theme on user: return 'light' | 'dark' or null. */
    function themeFromUser(user) {
        const t = user && (user.theme || user.preferences?.theme);
        return t ? normalize(t) : null;
    }

    function resolveInitialTheme() {
        const fromBootstrap = global.__zahulTheme;
        if (fromBootstrap) return normalize(fromBootstrap);
        return readStored();
    }

    function setTheme(theme, { persist = true } = {}) {
        const next = normalize(theme);
        document.documentElement.setAttribute('data-theme', next);
        document.documentElement.style.colorScheme = next;
        if (persist) {
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch { /* private mode */ }
        }
        global.dispatchEvent(new CustomEvent('zahul-theme-change', { detail: { theme: next } }));
        return next;
    }

    function applyToggleUi(lightBtn, darkBtn, theme) {
        if (!lightBtn || !darkBtn) return;
        const light = theme === 'light';
        lightBtn.classList.toggle('mode-tab-on', light);
        lightBtn.classList.toggle('mode-tab-off', !light);
        darkBtn.classList.toggle('mode-tab-on', !light);
        darkBtn.classList.toggle('mode-tab-off', light);
    }

    function wireToggle(lightBtn, darkBtn) {
        if (!lightBtn || !darkBtn) return;
        applyToggleUi(lightBtn, darkBtn, getTheme());
        lightBtn.addEventListener('click', () => {
            setTheme('light');
            applyToggleUi(lightBtn, darkBtn, 'light');
        });
        darkBtn.addEventListener('click', () => {
            setTheme('dark');
            applyToggleUi(lightBtn, darkBtn, 'dark');
        });
    }

    function applyUserTheme(user) {
        const fromUser = themeFromUser(user);
        if (fromUser) return setTheme(fromUser);
        return getTheme();
    }

    /** Call after auth when /api/me includes user.theme. */
    async function syncFromSession() {
        try {
            const res = await fetch('/api/me', { credentials: 'same-origin' });
            if (!res.ok) return getTheme();
            const data = await res.json();
            return applyUserTheme(data.current_user);
        } catch { /* offline */ }
        return getTheme();
    }

    setTheme(resolveInitialTheme(), { persist: false });

    global.ZahulTheme = {
        STORAGE_KEY,
        DEFAULT_THEME,
        getTheme,
        setTheme,
        themeFromUser,
        wireToggle,
        applyUserTheme,
        syncFromSession,
    };
})(window);
