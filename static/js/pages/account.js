/**
 * /account — Account settings.
 *
 * Everything here is self-scoped: the page only ever reads or changes the
 * signed-in user's own data. Cards whose backing API the caller's role cannot
 * reach are hidden rather than shown broken.
 */
(function () {
    const ROLE_LEVEL = { super_admin: 4, admin: 3, mod: 2, guest: 1 };
    const ROLE_META = {
        super_admin: { label: 'Super Admin', fa: 'fa-crown' },
        admin: { label: 'Admin', fa: 'fa-shield-halved' },
        mod: { label: 'Mod', fa: 'fa-gavel' },
        guest: { label: 'Guest', fa: 'fa-star' },
    };

    /* Mirrors the require_role(...) levels the API actually enforces. */
    const PERMISSIONS = [
        { min: 'guest', label: 'View logs and open the chat simulator' },
        { min: 'mod', label: 'View the dashboard, stats and servers' },
        { min: 'mod', label: 'Create and edit characters' },
        { min: 'mod', label: 'Create and edit scheduled tasks' },
        { min: 'mod', label: 'Send messages in the simulator' },
        { min: 'admin', label: 'Add and delete servers' },
        { min: 'admin', label: 'Manage users and roles' },
        { min: 'admin', label: 'Start and stop the bot' },
        { min: 'super_admin', label: 'Edit global AI config and security' },
        { min: 'super_admin', label: 'Delete log entries' },
    ];

    const $ = (id) => document.getElementById(id);
    const level = (role) => ROLE_LEVEL[role] || 0;

    function fmtDateTime(value) {
        if (!value) return '—';
        const d = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z');
        return isNaN(d) ? '—' : d.toLocaleString();
    }

    function fmtDate(value) {
        if (!value) return '—';
        const d = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z');
        return isNaN(d) ? '—' : d.toLocaleDateString();
    }

    function kvRow(key, value, mono) {
        return `<div class="kv"><span class="k">${key}</span><span class="v${mono ? ' mono' : ''}">${value}</span></div>`;
    }

    /** Coarse device guess from the UA string — enough to tell devices apart. */
    function describeAgent(ua) {
        if (!ua) return { text: 'Unknown device', icon: 'fa-desktop' };
        const browser = /Edg\//.test(ua) ? 'Edge'
            : /OPR\//.test(ua) ? 'Opera'
            : /Firefox\//.test(ua) ? 'Firefox'
            : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
            : 'Browser';
        const mobile = /iPhone|iPad|Android|Mobile/.test(ua);
        const os = /iPhone|iPad/.test(ua) ? 'iOS'
            : /Android/.test(ua) ? 'Android'
            : /Mac OS X/.test(ua) ? 'macOS'
            : /Windows/.test(ua) ? 'Windows'
            : /Linux/.test(ua) ? 'Linux'
            : '';
        return {
            text: os ? `${browser} · ${os}` : browser,
            icon: mobile ? 'fa-mobile-screen' : 'fa-desktop',
        };
    }

    function renderIdentity(me, sessions) {
        const role = me.role || 'guest';
        const meta = ROLE_META[role] || ROLE_META.guest;

        $('acc-username').textContent = me.username || '—';
        if (me.avatar_url) $('acc-avatar').src = me.avatar_url;

        const dot = $('acc-role-dot');
        dot.classList.remove('hidden');
        dot.classList.add(`role-${role}`);
        dot.title = `Role: ${role}`;
        dot.innerHTML = `<i class="fas ${meta.fa}"></i>`;

        const badge = $('acc-role-badge');
        badge.classList.add(`role-${role}`);
        badge.innerHTML = `<i class="fas ${meta.fa}"></i>${meta.label}`;

        const discord = me.auth_provider === 'discord';
        $('acc-via').innerHTML = discord
            ? '<i class="fab fa-discord"></i>Signed in with Discord'
            : '<i class="fas fa-key"></i>Signed in with a panel account';

        const current = sessions.find(s => s.current);
        const rows = [];
        if (me.discord_id) rows.push(kvRow('Discord ID', me.discord_id, true));
        rows.push(kvRow('Member since', fmtDate(me.created_at)));
        rows.push(kvRow('This session started', fmtDateTime(current && current.created_at)));
        rows.push(kvRow('Auth provider', me.auth_provider || 'local'));
        $('acc-identity-kv').innerHTML = rows.join('');

        $('acc-role-icon').className = `fas fa-fw ${meta.fa}`;
        $('acc-role-name').textContent = meta.label;
        $('acc-session-exp').textContent = fmtDateTime(current && current.expires_at);
    }

    function renderAccess(me, servers) {
        const role = me.role || 'guest';
        const limitedMod = role === 'mod' && (me.server_ids || []).length > 0;

        $('acc-scope').textContent = limitedMod
            ? `${me.server_ids.length} server${me.server_ids.length === 1 ? '' : 's'}`
            : 'All servers';
        $('acc-servers-head').textContent = limitedMod ? 'You moderate' : 'Servers you can reach';

        const list = $('acc-servers');
        if (!servers) {
            $('acc-servers-wrap').classList.add('hidden');
        } else if (!servers.length) {
            list.innerHTML = '<div class="prof-empty">No servers yet.</div>';
        } else {
            list.innerHTML = servers.map(s => `
                <div class="scope-row">
                    <i class="fas fa-fw fa-server"></i>
                    <span>${s.server_name || s.server_id}</span>
                    <span class="tag">${limitedMod ? 'MOD' : 'ALL'}</span>
                </div>`).join('');
        }

        $('acc-perms').innerHTML = PERMISSIONS
            .filter(p => level(role) >= level(p.min))
            .map(p => `<div class="perm yes"><i class="fas fa-check"></i><span>${p.label}</span></div>`)
            .join('');
    }

    function renderSessions(sessions) {
        const list = $('acc-sessions');
        $('acc-sess-count').textContent = `${sessions.length} device${sessions.length === 1 ? '' : 's'}`;

        if (!sessions.length) {
            list.innerHTML = '<div class="prof-empty">No active sessions.</div>';
            return;
        }

        list.innerHTML = sessions.map(s => {
            const dev = describeAgent(s.user_agent);
            return `
                <div class="sess${s.current ? ' current' : ''}">
                    <div class="dev"><i class="fas ${dev.icon}"></i></div>
                    <div class="info">
                        <div class="ua">${dev.text}</div>
                        <div class="meta">
                            <span>since ${fmtDateTime(s.created_at)}</span>
                            <span>expires ${fmtDateTime(s.expires_at)}</span>
                        </div>
                    </div>
                    ${s.current
                        ? '<span class="now">THIS DEVICE</span>'
                        : `<button class="btn-revoke" data-ref="${s.ref}">Revoke</button>`}
                </div>`;
        }).join('');

        $('acc-signout-others').classList.toggle('hidden', sessions.filter(s => !s.current).length === 0);

        list.querySelectorAll('.btn-revoke').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const r = await fetch(`/api/users/me/sessions/${btn.dataset.ref}`, { method: 'DELETE' });
                    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Failed to revoke session');
                    showToast('Session revoked');
                    loadSessions();
                } catch (e) {
                    btn.disabled = false;
                    showToast(e.message, 'error');
                }
            });
        });
    }

    async function loadSessions() {
        try {
            const r = await fetch('/api/users/me/sessions');
            if (!r.ok) throw new Error('Could not load sessions');
            const sessions = await r.json();
            renderSessions(sessions);
            return sessions;
        } catch (e) {
            $('acc-sessions').innerHTML = `<div class="prof-empty">${e.message}.</div>`;
            return [];
        }
    }

    async function loadUsage(me) {
        /* /api/stats/by-user is mod+ and keys rows by the Discord username seen in logs. */
        if (level(me.role) < ROLE_LEVEL.mod) return;
        try {
            const r = await fetch('/api/stats/by-user?days=30');
            if (!r.ok) return;
            const rows = await r.json();
            const names = [me.discord_username, me.username].filter(Boolean).map(n => n.toLowerCase());
            const mine = rows.find(row => names.includes(String(row.name || '').toLowerCase()));
            if (!mine) return;

            $('acc-usage-messages').textContent = Number(mine.total || 0).toLocaleString();
            $('acc-usage-tokens').textContent = Number(mine.tokens || 0).toLocaleString();
            $('acc-usage-errors').textContent = Number(mine.errors || 0).toLocaleString();
            $('acc-usage-card').classList.remove('hidden');
        } catch { /* usage is a nice-to-have — never block the page on it */ }
    }

    function wireAppearance() {
        if (window.ZahulTheme) ZahulTheme.wireToggle($('acc-theme-light'), $('acc-theme-dark'));

        const COMPACT_KEY = 'compact-lists';
        const box = $('acc-compact');
        box.checked = localStorage.getItem(COMPACT_KEY) === '1';
        document.documentElement.classList.toggle('compact-lists', box.checked);
        box.addEventListener('change', () => {
            localStorage.setItem(COMPACT_KEY, box.checked ? '1' : '0');
            document.documentElement.classList.toggle('compact-lists', box.checked);
        });
    }

    function wireSecurity(me) {
        const discord = me.auth_provider === 'discord';
        $('acc-password-state').textContent = discord ? 'Not set (Discord)' : 'Set';

        /* PATCH /api/users/{id}/password is admin+ and refuses Discord accounts,
           so only offer the control where it would actually succeed. */
        const canChange = !discord && level(me.role) >= ROLE_LEVEL.admin && me.id;
        if (!canChange) return;
        $('acc-password-wrap').classList.remove('hidden');

        $('acc-save-password').addEventListener('click', async () => {
            const input = $('acc-new-password');
            const value = input.value.trim();
            if (value.length < 8) {
                showToast('Password must be at least 8 characters', 'error');
                return;
            }
            try {
                const r = await fetch(`/api/users/${me.id}/password`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_password: value }),
                });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Could not update password');
                input.value = '';
                showToast('Password updated');
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    }

    async function init() {
        wireAppearance();

        let me;
        try {
            const r = await fetch('/api/users/me');
            if (!r.ok) throw new Error('Not authenticated');
            me = await r.json();
        } catch {
            document.querySelector('.prof-grid').innerHTML =
                '<div class="prof-card"><div class="prof-empty">You need to be signed in to view account settings.</div></div>';
            return;
        }

        const sessions = await loadSessions();
        renderIdentity(me, sessions);
        wireSecurity(me);

        let servers = null;
        if (level(me.role) >= ROLE_LEVEL.mod) {
            servers = await fetch('/api/servers/').then(r => (r.ok ? r.json() : null)).catch(() => null);
        }
        renderAccess(me, servers);
        loadUsage(me);

        $('acc-signout-others').addEventListener('click', async () => {
            try {
                const r = await fetch('/api/users/me/sessions', { method: 'DELETE' });
                if (!r.ok) throw new Error('Could not sign out other sessions');
                const { revoked } = await r.json();
                showToast(`Signed out ${revoked} other session${revoked === 1 ? '' : 's'}`);
                loadSessions();
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
