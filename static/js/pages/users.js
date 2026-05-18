document.addEventListener('DOMContentLoaded', () => {
    const esc = escapeHtml;

    const ROLE_ICONS = {
        super_admin: 'fa-crown',
        admin: 'fa-shield-halved',
        mod: 'fa-gavel',
        guest: 'fa-star',
        pending: 'fa-hourglass-half',
        rejected: 'fa-ban',
        user: 'fa-hourglass-half',
    };
    const ROLE_LABELS = {
        super_admin: 'super admin',
        admin: 'admin',
        mod: 'mod',
        guest: 'guest',
        pending: 'no access',
        rejected: 'denied',
        user: 'no access',
    };
    const ROLE_SORT_ORDER = { super_admin: 1, admin: 2, mod: 3, guest: 4, pending: 5, rejected: 6, user: 5 };
    const EDIT_ROLE_LONG = {
        super_admin: 'Super admin – full panel control',
        guest: 'Guest – read only',
        mod: 'Mod – assigned servers',
        admin: 'Admin – full control',
    };
    const DEFAULT_USER_AVATAR = '/static/avatars/default_user_avatar.png';
    const VALID_TABS = new Set(['users', 'requests', 'sessions']);
    const _qs = new URLSearchParams(window.location.search);
    let PAGE_SIZE = parseInt(_qs.get('limit'), 10);
    if (!Number.isInteger(PAGE_SIZE) || PAGE_SIZE <= 0) PAGE_SIZE = 25;
    const _tabFromUrlEarly = (_qs.get('tab') || '').trim().toLowerCase();
    const _initialTabFromUrl = VALID_TABS.has(_tabFromUrlEarly) ? _tabFromUrlEarly : 'users';
    const _urlPageNum = parseInt(_qs.get('page'), 10);
    const _initialPage = Number.isInteger(_urlPageNum) && _urlPageNum > 0 ? _urlPageNum : 1;

    let _currentUserRole = '';
    let _allUsers = [];
    let _requests = [];
    let _sessions = [];
    let _activeTab = 'users';
    let _usersPage = _initialTabFromUrl === 'users' ? _initialPage : 1;
    let _usersTotalPages = 1;
    let _requestsPage = _initialTabFromUrl === 'requests' ? _initialPage : 1;
    let _requestsTotalPages = 1;
    let _sessionPage = _initialTabFromUrl === 'sessions' ? _initialPage : 1;
    let _sessionTotalPages = 1;

    /** Local calendar date DD.MM.YYYY from ISO string */
    function formatDateDdMmYyyy(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    }

    /** DD.MM.YYYY HH:mm (local) */
    function formatDateTimeDdMmYyyy(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
    }

    function roleIcon(role) {
        const i = ROLE_ICONS[role] || 'fa-user';
        return `<i class="fas ${i}"></i> `;
    }
    function bindPasswordToggle(inputId, buttonId) {
        const input = document.getElementById(inputId);
        const button = document.getElementById(buttonId);
        if (!input || !button) return;
        const icon = button.querySelector('i');
        button.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            if (icon) {
                icon.classList.toggle('fa-eye', !show);
                icon.classList.toggle('fa-eye-slash', show);
            }
        });
    }
    function parseApiError(data, fallback = 'Failed') {
        if (!data) return fallback;
        if (typeof data.detail === 'string') return data.detail;
        if (Array.isArray(data.detail) && data.detail.length) {
            return data.detail.map(d => d.msg || JSON.stringify(d)).join('; ');
        }
        return fallback;
    }
    function roleLabel(role) {
        return ROLE_LABELS[role] || role;
    }

    function getTabFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const tab = (params.get('tab') || '').trim().toLowerCase();
        return VALID_TABS.has(tab) ? tab : null;
    }

    /** Same pattern as scheduler.js `updatePagination`: `tab`, `page`, `limit` in the query string. */
    function syncUsersUrl() {
        const p = new URLSearchParams(window.location.search);
        p.set('tab', _activeTab);
        let page = 1;
        if (_activeTab === 'users') page = _usersPage;
        else if (_activeTab === 'requests') page = _requestsPage;
        else if (_activeTab === 'sessions') page = _sessionPage;
        p.set('page', String(page));
        p.set('limit', String(PAGE_SIZE));
        window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}${window.location.hash}`);
    }

    function fillEditRoleSelect(u) {
        const sel = document.getElementById('edit-role');
        sel.innerHTML = '';
        const assignable = ['guest', 'mod', 'admin'];
        if (_currentUserRole === 'super_admin') assignable.unshift('super_admin');
        const fixed = u.role === 'user' && u.auth_provider === 'discord' ? 'pending' : u.role;

        if (fixed === 'pending' || fixed === 'rejected') {
            const o = document.createElement('option');
            o.value = fixed;
            o.textContent = fixed === 'pending'
                ? 'No panel access (not approved yet)'
                : 'Access request denied';
            o.disabled = true;
            sel.appendChild(o);
        } else if (!assignable.includes(u.role)) {
            const o = document.createElement('option');
            o.value = u.role;
            o.textContent = `Current: ${roleLabel(u.role)}`;
            o.disabled = true;
            sel.appendChild(o);
        }
        assignable.forEach(r => {
            const o = document.createElement('option');
            o.value = r;
            o.textContent = EDIT_ROLE_LONG[r];
            sel.appendChild(o);
        });
        if (fixed === 'pending' || fixed === 'rejected') sel.value = fixed;
        else if (assignable.includes(u.role)) sel.value = u.role;
        else sel.value = u.role;
    }
    function syncSuperAdminRoleOptions() {
        const allowSuperAdminRole = _currentUserRole === 'super_admin';
        ['new-role', 'edit-role'].forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            const superAdminOption = select.querySelector('option[value="super_admin"]');
            if (superAdminOption) superAdminOption.hidden = !allowSuperAdminRole;
            if (!allowSuperAdminRole && select.value === 'super_admin') {
                select.value = 'admin';
            }
        });
    }

    function setSecurityOffWarning(visible) {
        const warning = document.getElementById('security-off-warning');
        if (!warning) return;
        warning.classList.toggle('hidden', !visible);
    }

    // Guard: only super admin/admin
    fetch('/api/auth-status').then(r => r.json()).then(d => {
        if (!d.panel_auth_enabled) {
            setSecurityOffWarning(true);
            _currentUserRole = d.current_user?.role || 'super_admin';
            syncSuperAdminRoleOptions();
            loadUsers();
            refreshRequestsBadge();
            return;
        }
        setSecurityOffWarning(false);
        if (!d.current_user || (d.current_user.role !== 'super_admin' && d.current_user.role !== 'admin')) {
            window.location.href = '/';
            return;
        }
        _currentUserRole = d.current_user.role || '';
        syncSuperAdminRoleOptions();
        loadUsers();
        refreshRequestsBadge();
    }).catch(() => {
        setSecurityOffWarning(true);
        _currentUserRole = 'super_admin';
        syncSuperAdminRoleOptions();
        loadUsers();
        refreshRequestsBadge();
    });

    // Close buttons wired by data-modal attribute
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    bindPasswordToggle('new-password', 'new-password-toggle');
    bindPasswordToggle('edit-password', 'edit-password-toggle');
    initUserCombobox();
    initSessionFilters();
    initUsersPagination();
    initRequestsPagination();
    initPageSizeSelectors();
    document.getElementById('filter-role').addEventListener('change', () => {
        _usersPage = 1;
        renderUsers();
    });
    document.getElementById('filter-auth').addEventListener('change', () => {
        _usersPage = 1;
        renderUsers();
    });
    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        const fu = document.getElementById('filter-user');
        if (fu) {
            fu.value = '';
            if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(fu);
        }
        document.getElementById('filter-role').value = '';
        document.getElementById('filter-auth').value = '';
        document.getElementById('filter-user-dd').classList.add('hidden');
        document.querySelectorAll('#users-filters [data-clear]').forEach(btn => btn.classList.add('hidden'));
        document.querySelectorAll('#users-filters .select-wrap').forEach(w => w.classList.remove('has-value'));
        _usersPage = 1;
        renderUsers();
    });
    if (typeof initFilterClear === 'function') initFilterClear(() => {
        document.getElementById('filter-user-dd').classList.add('hidden');
        _usersPage = 1;
        renderUsers();
    }, document.getElementById('users-filters'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab || 'users'));
    });

    // --- Users List ---

    async function loadUsers() {
        const list = document.getElementById('user-list');
        try {
            _allUsers = await fetch('/api/users/').then(r => r.json());
            renderUsers();
        } catch (e) {
            list.innerHTML = `<div class="text-red-400 text-center py-12">Failed to load: ${esc(String(e))}</div>`;
        }
    }

    function updateRequestsBadge(count) {
        const badge = document.getElementById('requests-tab-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.remove('hidden');
        } else {
            badge.textContent = '';
            badge.classList.add('hidden');
        }
    }

    async function refreshRequestsBadge() {
        try {
            const res = await fetch('/api/users/requests');
            const data = await res.json();
            if (!res.ok) return;
            const n = Array.isArray(data) ? data.length : 0;
            updateRequestsBadge(n);
        } catch (_) {}
    }

    async function loadRequests() {
        const list = document.getElementById('request-list');
        try {
            const res = await fetch('/api/users/requests');
            const data = await res.json();
            if (!res.ok) throw new Error(parseApiError(data, 'Failed to load requests.'));
            _requests = Array.isArray(data) ? data : [];
            updateRequestsBadge(_requests.length);
            renderRequests();
        } catch (e) {
            list.innerHTML = `<div class="text-red-400 text-center py-12">Failed to load requests: ${esc(String(e))}</div>`;
        }
    }

    function setTab(tab, opts = {}) {
        const { syncUrl = true } = opts;
        const resolvedTab = VALID_TABS.has(tab) ? tab : 'users';
        _activeTab = resolvedTab;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const active = btn.dataset.tab === resolvedTab;
            btn.classList.toggle('tab-active', active);
            btn.classList.toggle('text-white', active);
        });
        document.getElementById('users-filters').classList.toggle('hidden', resolvedTab !== 'users');
        document.getElementById('sessions-filters').classList.toggle('hidden', resolvedTab !== 'sessions');
        document.getElementById('user-list').classList.toggle('hidden', resolvedTab !== 'users');
        document.getElementById('users-pagination').classList.toggle('hidden', resolvedTab !== 'users');
        document.getElementById('request-list').classList.toggle('hidden', resolvedTab !== 'requests');
        document.getElementById('requests-pagination').classList.toggle('hidden', resolvedTab !== 'requests');
        document.getElementById('session-list').classList.toggle('hidden', resolvedTab !== 'sessions');
        document.getElementById('session-list-footer').classList.toggle('hidden', resolvedTab !== 'sessions');
        if (resolvedTab === 'requests') loadRequests();
        if (resolvedTab === 'sessions') loadSessions();
        if (syncUrl) syncUsersUrl();
    }

    function initPageSizeSelectors() {
        const ids = ['users-page-size-select', 'requests-page-size-select', 'session-page-size-select'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = String(PAGE_SIZE);
            el.addEventListener('change', () => {
                const next = parseInt(el.value || '25', 10);
                if (!Number.isInteger(next) || next <= 0) return;
                PAGE_SIZE = next;
                ids.forEach(otherId => {
                    const other = document.getElementById(otherId);
                    if (other) other.value = String(PAGE_SIZE);
                });
                _usersPage = 1;
                _requestsPage = 1;
                _sessionPage = 1;
                syncUsersUrl();
                if (_activeTab === 'users') renderUsers();
                if (_activeTab === 'requests') renderRequests();
                if (_activeTab === 'sessions') renderFilteredSessions();
            });
        });
    }

    function parseUA(ua) {
        if (!ua) return null;
        let browser = 'Unknown';
        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Safari\//.test(ua)) browser = 'Safari';

        let os = 'Unknown';
        if (/Windows NT/.test(ua)) os = 'Windows';
        else if (/Android/.test(ua)) os = 'Android';
        else if (/iPhone|iPad/.test(ua)) os = 'iOS';
        else if (/Mac OS X/.test(ua)) os = 'macOS';
        else if (/Linux/.test(ua)) os = 'Linux';

        return { browser, os };
    }

    function formatUA(parsed) {
        if (!parsed) return null;
        return `${parsed.browser} · ${parsed.os}`;
    }

    /** Label + optional title for session list (handles missing legacy user_agent rows). */
    function sessionClientLabel(session) {
        const raw = (session && session.user_agent != null) ? String(session.user_agent).trim() : '';
        if (!raw) {
            return {
                text: 'No client info (legacy or missing User-Agent)',
                title: '',
            };
        }
        const parsed = parseUA(raw);
        const line = formatUA(parsed);
        return {
            text: line || 'Unknown browser · unknown OS',
            title: raw,
        };
    }

    async function loadSessions() {
        const list = document.getElementById('session-list');
        list.innerHTML = '<div class="text-gray-500 text-center py-8">Loading...</div>';
        try {
            const res = await fetch('/api/users/sessions');
            const data = await res.json();
            if (!res.ok) throw new Error(parseApiError(data, 'Failed to load sessions.'));
            _sessions = Array.isArray(data) ? data : [];
            renderFilteredSessions();
        } catch (e) {
            list.innerHTML = `<div class="text-red-400 text-center py-8">Failed to load: ${esc(String(e))}</div>`;
            updateSessionFooter(0);
        }
    }

    function applySessionFilters(sessions) {
        const q = (document.getElementById('filter-session-user')?.value || '').trim().toLowerCase();
        const browser = document.getElementById('filter-session-browser')?.value || '';
        const os = document.getElementById('filter-session-os')?.value || '';
        return sessions.filter(s => {
            if (q && !s.username.toLowerCase().includes(q)) return false;
            if (browser || os) {
                const parsed = parseUA(s.user_agent);
                if (browser && (!parsed || parsed.browser !== browser)) return false;
                if (os && (!parsed || parsed.os !== os)) return false;
            }
            return true;
        });
    }

    function renderFilteredSessions() {
        const filtered = applySessionFilters(_sessions);
        _sessionTotalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (_sessionPage > _sessionTotalPages) _sessionPage = _sessionTotalPages;
        const start = (_sessionPage - 1) * PAGE_SIZE;
        const pageItems = filtered.slice(start, start + PAGE_SIZE);
        renderSessions(pageItems);
        updateSessionFooter(filtered.length);
    }

    function initSessionCombobox() {
        function sessionUsernames() {
            return [...new Set(_sessions.map(s => s.username).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        }
        setupFilterCombobox(
            'filter-session-user',
            'filter-session-user-dd',
            sessionUsernames,
            () => { _sessionPage = 1; renderFilteredSessions(); },
            () => { _sessionPage = 1; renderFilteredSessions(); },
            'hover:bg-gray-800'
        );
    }

    function initSessionFilters() {
        initSessionCombobox();
        document.getElementById('filter-session-browser')?.addEventListener('change', () => {
            _sessionPage = 1;
            renderFilteredSessions();
        });
        document.getElementById('filter-session-os')?.addEventListener('change', () => {
            _sessionPage = 1;
            renderFilteredSessions();
        });
        document.getElementById('kick-all-sessions-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (!confirm('Kick all active sessions? This will log out everyone.')) return;
            btn.disabled = true;
            try {
                const res = await fetch('/api/users/sessions', { method: 'DELETE' });
                if (!res.ok) throw new Error(parseApiError(await res.json(), 'Failed'));
                showToast('All sessions revoked.', 'success');
                await loadSessions();
            } catch (err) {
                showToast(String(err), 'error');
            } finally {
                btn.disabled = false;
            }
        });
        document.getElementById('session-prev-btn')?.addEventListener('click', () => {
            if (_sessionPage <= 1) return;
            _sessionPage -= 1;
            renderFilteredSessions();
        });
        document.getElementById('session-next-btn')?.addEventListener('click', () => {
            if (_sessionPage >= _sessionTotalPages) return;
            _sessionPage += 1;
            renderFilteredSessions();
        });
        document.getElementById('clear-session-filters-btn')?.addEventListener('click', () => {
            const fu = document.getElementById('filter-session-user');
            if (fu) { fu.value = ''; if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(fu); }
            document.getElementById('filter-session-browser').value = '';
            document.getElementById('filter-session-os').value = '';
            document.getElementById('filter-session-user-dd')?.classList.add('hidden');
            document.querySelectorAll('#sessions-filters [data-clear]').forEach(btn => btn.classList.add('hidden'));
            document.querySelectorAll('#sessions-filters .select-wrap').forEach(w => w.classList.remove('has-value'));
            _sessionPage = 1;
            renderFilteredSessions();
        });
        if (typeof initFilterClear === 'function') initFilterClear(() => {
            document.getElementById('filter-session-user-dd')?.classList.add('hidden');
            _sessionPage = 1;
            renderFilteredSessions();
        }, document.getElementById('sessions-filters'));
    }

    function updateSessionFooter(totalItems) {
        const footer = document.getElementById('session-list-footer');
        const info = document.getElementById('session-pagination-info');
        const prev = document.getElementById('session-prev-btn');
        const next = document.getElementById('session-next-btn');
        if (!footer || !info || !prev || !next) return;
        const nd = '\u2013';
        const start = totalItems ? ((_sessionPage - 1) * PAGE_SIZE) + 1 : 0;
        const end = totalItems ? Math.min(_sessionPage * PAGE_SIZE, totalItems) : 0;
        footer.classList.toggle('hidden', _activeTab !== 'sessions');
        info.textContent = totalItems ? `${start}${nd}${end} of ${totalItems}` : '';
        prev.disabled = totalItems <= 0 || _sessionPage <= 1;
        next.disabled = totalItems <= 0 || _sessionPage * PAGE_SIZE >= totalItems;
        syncUsersUrl();
    }

    function initUsersPagination() {
        document.getElementById('users-prev-btn')?.addEventListener('click', () => {
            if (_usersPage <= 1) return;
            _usersPage -= 1;
            renderUsers();
        });
        document.getElementById('users-next-btn')?.addEventListener('click', () => {
            if (_usersPage >= _usersTotalPages) return;
            _usersPage += 1;
            renderUsers();
        });
    }

    function updateUsersFooter(totalItems) {
        const footer = document.getElementById('users-pagination');
        const info = document.getElementById('users-pagination-info');
        const prev = document.getElementById('users-prev-btn');
        const next = document.getElementById('users-next-btn');
        if (!footer || !info || !prev || !next) return;
        const nd = '\u2013';
        const start = totalItems ? ((_usersPage - 1) * PAGE_SIZE) + 1 : 0;
        const end = totalItems ? Math.min(_usersPage * PAGE_SIZE, totalItems) : 0;
        footer.classList.toggle('hidden', _activeTab !== 'users');
        info.textContent = totalItems ? `${start}${nd}${end} of ${totalItems}` : '';
        prev.disabled = totalItems <= 0 || _usersPage <= 1;
        next.disabled = totalItems <= 0 || _usersPage * PAGE_SIZE >= totalItems;
        syncUsersUrl();
    }

    function initRequestsPagination() {
        document.getElementById('requests-prev-btn')?.addEventListener('click', () => {
            if (_requestsPage <= 1) return;
            _requestsPage -= 1;
            renderRequests();
        });
        document.getElementById('requests-next-btn')?.addEventListener('click', () => {
            if (_requestsPage >= _requestsTotalPages) return;
            _requestsPage += 1;
            renderRequests();
        });
    }

    function updateRequestsFooter(totalItems) {
        const footer = document.getElementById('requests-pagination');
        const info = document.getElementById('requests-pagination-info');
        const prev = document.getElementById('requests-prev-btn');
        const next = document.getElementById('requests-next-btn');
        if (!footer || !info || !prev || !next) return;
        const nd = '\u2013';
        const start = totalItems ? ((_requestsPage - 1) * PAGE_SIZE) + 1 : 0;
        const end = totalItems ? Math.min(_requestsPage * PAGE_SIZE, totalItems) : 0;
        footer.classList.toggle('hidden', _activeTab !== 'requests');
        info.textContent = totalItems ? `${start}${nd}${end} of ${totalItems}` : '';
        prev.disabled = totalItems <= 0 || _requestsPage <= 1;
        next.disabled = totalItems <= 0 || _requestsPage * PAGE_SIZE >= totalItems;
        syncUsersUrl();
    }

    function renderSessions(sessions) {
        const list = document.getElementById('session-list');
        if (!sessions.length) {
            list.innerHTML = '<div class="text-gray-500 text-center py-12">No active sessions.</div>';
            return;
        }
        const DEFAULT_AVATAR = '/static/avatars/default_user_avatar.png';
        list.innerHTML = sessions.map(s => {
            const authIcon = s.auth_provider === 'discord'
                ? '<i class="fab fa-discord text-indigo-400 text-xs" title="Discord"></i>'
                : '<i class="fas fa-key text-gray-500 text-xs" title="Local"></i>';
            const since = formatDateTimeDdMmYyyy(s.created_at);
            const expires = formatDateTimeDdMmYyyy(s.expires_at);
            const safeAvatar = esc(s.avatar_url || DEFAULT_AVATAR);
            const safeDefault = esc(DEFAULT_AVATAR);
            const client = sessionClientLabel(s);
            const uaTitle = client.title ? ` title="${esc(client.title)}"` : '';
            const uaLine = `<span class="text-xs text-gray-500"${uaTitle}>${esc(client.text)}</span><span class="text-xs text-gray-600"> · </span>`;
            return `<div class="list-card flex items-center justify-between gap-4">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="${safeAvatar}" onerror="this.onerror=null;this.src='${safeDefault}'" alt="avatar" class="w-8 h-8 rounded-full object-cover border border-gray-700 bg-gray-900 flex-shrink-0">
                    ${authIcon}
                    <div class="min-w-0">
                        <span class="font-medium text-sm text-white truncate block">${esc(s.username)}</span>
                        <span class="text-xs text-gray-500">${uaLine}since ${esc(since)} · expires ${esc(expires)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                    <span class="role-badge role-${esc(s.role)}">${roleIcon(s.role)}<span class="role-badge-label">${esc(roleLabel(s.role))}</span></span>
                    <button class="btn-danger text-xs session-revoke-btn" data-session-token="${esc(s.session_token)}" title="Revoke this session only">
                        <i class="fas fa-right-from-bracket mr-1"></i>Kick
                    </button>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.session-revoke-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sessionToken = btn.dataset.sessionToken;
                if (!sessionToken) {
                    showToast('Missing session token.', 'error');
                    return;
                }
                btn.disabled = true;
                try {
                    const encodedToken = encodeURIComponent(sessionToken);
                    const res = await fetch(`/api/users/sessions/${encodedToken}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error(parseApiError(await res.json(), 'Failed'));
                    showToast('Session revoked.', 'success');
                    loadSessions();
                } catch (e) {
                    showToast(String(e), 'error');
                    btn.disabled = false;
                }
            });
        });
    }

    function renderUsers() {
        const list = document.getElementById('user-list');
        const users = applyFilters(_allUsers).sort((a, b) => {
            const roleA = ROLE_SORT_ORDER[a.role] || 999;
            const roleB = ROLE_SORT_ORDER[b.role] || 999;
            if (roleA !== roleB) return roleA - roleB;
            const nameA = (a.auth_provider === 'discord' ? (a.discord_username || a.username) : a.username || '').toLowerCase();
            const nameB = (b.auth_provider === 'discord' ? (b.discord_username || b.username) : b.username || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
        if (!users.length) {
            list.innerHTML = _allUsers.length
                ? '<div class="text-gray-500 text-center py-12">No users match current filters.</div>'
                : '<div class="text-gray-500 text-center py-12">No users.</div>';
            updateUsersFooter(0);
            return;
        }
        _usersTotalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
        if (_usersPage > _usersTotalPages) _usersPage = _usersTotalPages;
        const start = (_usersPage - 1) * PAGE_SIZE;
        const pageUsers = users.slice(start, start + PAGE_SIZE);
        list.innerHTML = pageUsers.map(userRow).join('');
        list.querySelectorAll('[data-user-id]').forEach(row => {
            row.addEventListener('click', () => openEditModal(pageUsers.find(u => u.id == row.dataset.userId)));
        });
        updateUsersFooter(users.length);
    }

    function applyFilters(users) {
        const q = (document.getElementById('filter-user').value || '').trim().toLowerCase();
        const role = document.getElementById('filter-role').value;
        const auth = document.getElementById('filter-auth').value;
        return users.filter(u => {
            const name = (u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username || '').toLowerCase();
            if (q && !name.includes(q)) return false;
            if (role && u.role !== role) return false;
            if (auth && (u.auth_provider || 'local') !== auth) return false;
            return true;
        });
    }

    function initUserCombobox() {
        function allNames() {
            return [...new Set(_allUsers.map(u => (
                u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username
            )).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        }
        setupFilterCombobox(
            'filter-user',
            'filter-user-dd',
            allNames,
            () => { _usersPage = 1; renderUsers(); },
            () => { _usersPage = 1; renderUsers(); },
            'hover:bg-gray-800'
        );
    }

    function userRow(u) {
        const name = u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username;
        const authIcon = u.auth_provider === 'discord'
            ? '<i class="fab fa-discord text-indigo-400 text-xs" title="Discord"></i>'
            : '<i class="fas fa-key text-gray-500 text-xs" title="Local"></i>';
        const created = formatDateDdMmYyyy(u.created_at);
        const avatarUrl = u.avatar_url || DEFAULT_USER_AVATAR;
        const safeAvatarUrl = esc(avatarUrl);
        const safeDefaultAvatar = esc(DEFAULT_USER_AVATAR);
        return `<div data-user-id="${u.id}" class="list-card cursor-pointer flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
                <img src="${safeAvatarUrl}" onerror="this.onerror=null;this.src='${safeDefaultAvatar}'" alt="${esc(name)} avatar" class="w-8 h-8 rounded-full object-cover border border-gray-700 bg-gray-900 flex-shrink-0">
                ${authIcon}
                <span class="font-medium text-sm text-white truncate users-name">${esc(name)}</span>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <span class="role-badge role-${esc(u.role)}">${roleIcon(u.role)}<span class="role-badge-label">${esc(roleLabel(u.role))}</span></span>
                <span class="text-xs text-gray-600 users-date">${created}</span>
            </div>
        </div>`;
    }

    function requestRoleOptions() {
        const roles = ['guest', 'mod', 'admin'];
        if (_currentUserRole === 'super_admin') roles.unshift('super_admin');
        return roles.map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('');
    }

    function renderRequests() {
        const list = document.getElementById('request-list');
        if (!_requests.length) {
            list.innerHTML = '<div class="text-gray-500 text-center py-12">No pending access requests.</div>';
            updateRequestsFooter(0);
            return;
        }
        _requestsTotalPages = Math.max(1, Math.ceil(_requests.length / PAGE_SIZE));
        if (_requestsPage > _requestsTotalPages) _requestsPage = _requestsTotalPages;
        const start = (_requestsPage - 1) * PAGE_SIZE;
        const pageRequests = _requests.slice(start, start + PAGE_SIZE);
        list.innerHTML = pageRequests.map(r => {
            const ts = formatDateTimeDdMmYyyy(r.requested_at);
            return `<div class="list-card flex flex-col md:flex-row md:items-center md:justify-between gap-3" data-request-id="${r.id}">
                <div class="min-w-0">
                    <p class="text-sm text-white font-medium truncate users-name">${esc(r.discord_username || 'unknown')}</p>
                    <p class="text-xs text-gray-500">${esc(ts)}</p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <select class="input-field text-sm py-2 px-2 w-40 request-role-select">${requestRoleOptions()}</select>
                    <button class="btn-primary text-sm request-approve-btn"><i class="fas fa-check mr-1"></i>Approve</button>
                    <button class="btn-danger text-sm request-deny-btn"><i class="fas fa-xmark mr-1"></i>Deny</button>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('[data-request-id]').forEach(row => {
            const requestId = row.getAttribute('data-request-id');
            const approveBtn = row.querySelector('.request-approve-btn');
            const denyBtn = row.querySelector('.request-deny-btn');
            const roleSelect = row.querySelector('.request-role-select');
            if (approveBtn) {
                approveBtn.addEventListener('click', async () => {
                    try {
                        const res = await fetch(`/api/users/requests/${requestId}/approve`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ role: roleSelect.value }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(parseApiError(data, 'Failed to approve request.'));
                        showToast('Request approved.', 'success');
                        await loadRequests();
                        await loadUsers();
                    } catch (e) {
                        showToast(String(e), 'error');
                    }
                });
            }
            if (denyBtn) {
                denyBtn.addEventListener('click', async () => {
                    try {
                        const res = await fetch(`/api/users/requests/${requestId}/deny`, { method: 'PATCH' });
                        const data = await res.json();
                        if (!res.ok) throw new Error(parseApiError(data, 'Failed to deny request.'));
                        showToast('Request denied.', 'success');
                        await loadRequests();
                    } catch (e) {
                        showToast(String(e), 'error');
                    }
                });
            }
        });
        updateRequestsFooter(_requests.length);
    }

    // --- New User Modal ---

    let _authTab = 'local';

    document.getElementById('new-user-btn').addEventListener('click', () => {
        resetNewForm();
        openModal('new-modal');
    });

    document.getElementById('auth-tab-local').addEventListener('click', () => setAuthTab('local'));
    document.getElementById('auth-tab-discord').addEventListener('click', () => setAuthTab('discord'));

    document.getElementById('new-role').addEventListener('change', function () {
        document.getElementById('new-servers-field').classList.toggle('hidden', this.value !== 'mod');
    });

    document.getElementById('new-modal-save').addEventListener('click', async () => {
        const errEl = document.getElementById('new-modal-error');
        errEl.classList.add('hidden');

        const role = document.getElementById('new-role').value;
        const body = { role, auth_provider: _authTab };

        if (_authTab === 'local') {
            const username = document.getElementById('new-username').value.trim();
            const password = document.getElementById('new-password').value;
            if (!username) return showErr(errEl, 'Username is required.');
            if (password.length < 8) return showErr(errEl, 'Password must be at least 8 characters.');
            body.username = username;
            body.password = password;
        } else {
            const du = document.getElementById('new-discord-username').value.trim();
            if (!du) return showErr(errEl, 'Discord username is required.');
            body.discord_username = du;
        }

        if (role === 'mod') {
            const ids = document.getElementById('new-server-ids').value.trim();
            body.server_ids = ids ? ids.split(',').map(s => s.trim()).filter(Boolean) : [];
        }

        try {
            const res = await fetch('/api/users/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(parseApiError(data, 'Failed'));
            closeModal('new-modal');
            showToast('User created', 'success');
            loadUsers();
            if (_activeTab === 'requests') loadRequests();
        } catch (e) {
            showErr(errEl, String(e));
        }
    });

    function setAuthTab(tab) {
        _authTab = tab;
        document.getElementById('local-fields').classList.toggle('hidden', tab !== 'local');
        document.getElementById('discord-fields').classList.toggle('hidden', tab !== 'discord');
        document.getElementById('auth-tab-local').className = tab === 'local' ? 'mode-tab mode-tab-on' : 'mode-tab mode-tab-off';
        document.getElementById('auth-tab-discord').className = tab === 'discord' ? 'mode-tab mode-tab-on' : 'mode-tab mode-tab-off';
    }

    function resetNewForm() {
        document.getElementById('new-username').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-discord-username').value = '';
        document.getElementById('new-role').value = 'mod';
        syncSuperAdminRoleOptions();
        document.getElementById('new-server-ids').value = '';
        document.getElementById('new-servers-field').classList.add('hidden');
        document.getElementById('new-modal-error').classList.add('hidden');
        setAuthTab('local');
    }

    // --- Edit Modal ---

    let _editUser = null;

    function openEditModal(u) {
        _editUser = u;
        const name = u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username;
        const isOwner = u.role === 'super_admin';
        const isDiscord = u.auth_provider === 'discord';
        const canChangePassword = !isOwner && !isDiscord;
        const canUploadAvatar = !isDiscord;

        document.getElementById('edit-modal-title').innerHTML =
            `<span class="role-badge role-${esc(u.role)} mr-2">${roleIcon(u.role)}<span class="role-badge-label">${esc(roleLabel(u.role))}</span></span>${esc(name)}`;

        // Role field — visible for all users
        const roleField = document.getElementById('edit-role-field');
        roleField.classList.remove('hidden');
        fillEditRoleSelect(u);

        // Servers field
        const serversField = document.getElementById('edit-servers-field');
        serversField.classList.toggle('hidden', u.role !== 'mod');
        document.getElementById('edit-server-ids').value = (u.server_ids || []).join(', ');

        // Avatar field — local accounts can upload profile picture
        const avatarField = document.getElementById('edit-avatar-field');
        const avatarPreview = document.getElementById('edit-avatar-preview');
        const avatarFileInput = document.getElementById('edit-avatar-file');
        avatarField.classList.toggle('hidden', !canUploadAvatar);
        avatarPreview.src = u.avatar_url || DEFAULT_USER_AVATAR;
        avatarFileInput.value = '';

        // Password field — hidden for super admin and discord accounts
        document.getElementById('edit-pw-field').classList.toggle('hidden', !canChangePassword);
        document.getElementById('edit-password').value = '';

        // Delete button — visible for all users
        document.getElementById('edit-delete-btn').classList.remove('hidden');

        document.getElementById('edit-modal-error').classList.add('hidden');

        // Show/hide servers when role changes
        document.getElementById('edit-role').onchange = function () {
            serversField.classList.toggle('hidden', this.value !== 'mod');
        };

        openModal('edit-modal');
    }

    document.getElementById('edit-modal-save').addEventListener('click', async () => {
        const errEl = document.getElementById('edit-modal-error');
        errEl.classList.add('hidden');
        const u = _editUser;
        const canChangePassword = u.role !== 'super_admin' && u.auth_provider !== 'discord';
        const canUploadAvatar = u.auth_provider === 'local';

        try {
            // Update role (only real panel roles — not pending/rejected placeholders)
            const newRole = document.getElementById('edit-role').value;
            const assignableRoles = ['guest', 'mod', 'admin'];
            if (_currentUserRole === 'super_admin') assignableRoles.unshift('super_admin');
            if (assignableRoles.includes(newRole) && newRole !== u.role) {
                const res = await fetch(`/api/users/${u.id}/role`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: newRole })
                });
                if (!res.ok) throw new Error(parseApiError(await res.json(), 'Role update failed'));
            }

            // Update server access for mod
            if (newRole === 'mod') {
                const ids = document.getElementById('edit-server-ids').value.trim();
                const server_ids = ids ? ids.split(',').map(s => s.trim()).filter(Boolean) : [];
                const res = await fetch(`/api/users/${u.id}/servers`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ server_ids })
                });
                if (!res.ok) throw new Error(parseApiError(await res.json(), 'Server update failed'));
            }

            // Update password (only local non-super-admin accounts)
            const pw = document.getElementById('edit-password').value;
            if (canChangePassword && pw) {
                if (pw.length < 8) return showErr(errEl, 'Password must be at least 8 characters.');
                const res = await fetch(`/api/users/${u.id}/password`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_password: pw })
                });
                if (!res.ok) throw new Error(parseApiError(await res.json(), 'Password update failed'));
            }

            // Upload profile avatar (local accounts)
            if (canUploadAvatar) {
                const avatarFileInput = document.getElementById('edit-avatar-file');
                const file = avatarFileInput?.files?.[0];
                if (file) {
                    const formData = new FormData();
                    formData.append('image', file);
                    const res = await fetch(`/api/users/${u.id}/avatar`, {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(parseApiError(data, 'Avatar upload failed'));
                }
            }

            closeModal('edit-modal');
            showToast('Saved', 'success');
            loadUsers();
            if (_activeTab === 'requests') loadRequests();
        } catch (e) {
            showErr(errEl, String(e));
        }
    });

    document.getElementById('edit-delete-btn').addEventListener('click', () => {
        const userName = _editUser.auth_provider === 'discord' ? (_editUser.discord_username || _editUser.username) : _editUser.username;
        document.getElementById('delete-modal-name').textContent = userName;
        const deleteErr = document.getElementById('delete-modal-error');
        if (deleteErr) {
            deleteErr.textContent = '';
            deleteErr.classList.add('hidden');
        }
        const prefix = document.getElementById('delete-modal-prefix');
        const suffix = document.getElementById('delete-modal-suffix');
        if (prefix && suffix) {
            if (_editUser.role === 'super_admin') {
                prefix.textContent = 'Warning: You are deleting a super admin account';
                suffix.textContent = '. Are you sure?';
            } else {
                prefix.textContent = 'Delete';
                suffix.textContent = '? This cannot be undone.';
            }
        }
        closeModal('edit-modal');
        openModal('delete-modal');
    });

    document.getElementById('delete-modal-confirm').addEventListener('click', async () => {
        const deleteErr = document.getElementById('delete-modal-error');
        if (deleteErr) {
            deleteErr.textContent = '';
            deleteErr.classList.add('hidden');
        }
        try {
            const res = await fetch(`/api/users/${_editUser.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(parseApiError(await res.json(), 'Failed'));
            closeModal('delete-modal');
            showToast('User deleted', 'success');
            loadUsers();
            if (_activeTab === 'requests') loadRequests();
        } catch (e) {
            if (deleteErr) {
                deleteErr.textContent = String(e);
                deleteErr.classList.remove('hidden');
            } else {
                showToast(String(e), 'error');
            }
        }
    });

    // --- Helpers ---

    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
    }

    function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    function showErr(el, msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    setTab(getTabFromUrl() || 'users', { syncUrl: false });
    syncUsersUrl();
});
