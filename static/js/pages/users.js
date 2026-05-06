document.addEventListener('DOMContentLoaded', () => {
    const esc = escapeHtml;

    const ROLE_ICONS = { super_admin: 'fa-crown', admin: 'fa-shield-halved', mod: 'fa-user-shield', guest: 'fa-user' };
    const ROLE_LABELS = { super_admin: 'super admin', admin: 'admin', mod: 'mod', guest: 'guest' };
    const ROLE_SORT_ORDER = { super_admin: 1, admin: 2, mod: 3, guest: 4 };
    let _currentUserRole = '';
    let _allUsers = [];
    let _requests = [];
    let _activeTab = 'users';
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

    // Guard: only super admin/admin
    fetch('/api/auth-status').then(r => r.json()).then(d => {
        if (!d.current_user || (d.current_user.role !== 'super_admin' && d.current_user.role !== 'admin')) {
            window.location.href = '/';
            return;
        }
        _currentUserRole = d.current_user.role || '';
        syncSuperAdminRoleOptions();
        loadUsers();
        refreshRequestsBadge();
    }).catch(() => { window.location.href = '/'; });

    // Close buttons wired by data-modal attribute
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    bindPasswordToggle('new-password', 'new-password-toggle');
    bindPasswordToggle('edit-password', 'edit-password-toggle');
    initUserCombobox();
    document.getElementById('filter-user-clear').addEventListener('click', () => {
        document.getElementById('filter-user').value = '';
        document.getElementById('filter-user-dd').classList.add('hidden');
        renderUsers();
    });
    document.getElementById('filter-role').addEventListener('change', renderUsers);
    document.getElementById('filter-auth').addEventListener('change', renderUsers);
    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        document.getElementById('filter-user').value = '';
        document.getElementById('filter-role').value = '';
        document.getElementById('filter-auth').value = '';
        renderUsers();
    });
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

    function setTab(tab) {
        _activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const active = btn.dataset.tab === tab;
            btn.classList.toggle('tab-active', active);
            btn.classList.toggle('text-white', active);
        });
        document.getElementById('users-filters').classList.toggle('hidden', tab !== 'users');
        document.getElementById('user-list').classList.toggle('hidden', tab !== 'users');
        document.getElementById('request-list').classList.toggle('hidden', tab !== 'requests');
        if (tab === 'requests') loadRequests();
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
            return;
        }
        list.innerHTML = users.map(userRow).join('');
        list.querySelectorAll('[data-user-id]').forEach(row => {
            row.addEventListener('click', () => openEditModal(users.find(u => u.id == row.dataset.userId)));
        });
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
        const input = document.getElementById('filter-user');
        const dropdown = document.getElementById('filter-user-dd');
        function allNames() {
            return [...new Set(_allUsers.map(u => (
                u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username
            )).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        }
        function showDropdown() {
            const names = allNames();
            const q = input.value.trim().toLowerCase();
            const filtered = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
            if (!filtered.length) {
                dropdown.classList.add('hidden');
                return;
            }
            dropdown.innerHTML = filtered.map(n =>
                `<div class="px-3 py-2 cursor-pointer hover:bg-gray-800 text-sm text-white" data-val="${esc(n)}">${esc(n)}</div>`
            ).join('');
            dropdown.querySelectorAll('[data-val]').forEach(item => {
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    input.value = item.dataset.val;
                    dropdown.classList.add('hidden');
                    renderUsers();
                });
            });
            dropdown.classList.remove('hidden');
        }
        input.addEventListener('focus', showDropdown);
        input.addEventListener('input', () => {
            renderUsers();
            showDropdown();
        });
        input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
    }

    function userRow(u) {
        const name = u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username;
        const authIcon = u.auth_provider === 'discord'
            ? '<i class="fab fa-discord text-indigo-400 text-xs" title="Discord"></i>'
            : '<i class="fas fa-key text-gray-500 text-xs" title="Local"></i>';
        const created = u.created_at ? u.created_at.slice(0, 10) : '';
        return `<div data-user-id="${u.id}" class="list-card cursor-pointer flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
                ${authIcon}
                <span class="font-medium text-sm text-white truncate">${esc(name)}</span>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <span class="role-badge role-${esc(u.role)}">${roleIcon(u.role)}${esc(roleLabel(u.role))}</span>
                <span class="text-xs text-gray-600">${created}</span>
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
            return;
        }
        list.innerHTML = _requests.map(r => {
            const ts = r.requested_at ? new Date(r.requested_at).toLocaleString('sk-SK', { hour12: false }) : '';
            return `<div class="list-card flex flex-col md:flex-row md:items-center md:justify-between gap-3" data-request-id="${r.id}">
                <div class="min-w-0">
                    <p class="text-sm text-white font-medium truncate">${esc(r.discord_username || 'unknown')}</p>
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

        document.getElementById('edit-modal-title').innerHTML =
            `<span class="role-badge role-${esc(u.role)} mr-2">${roleIcon(u.role)}${esc(roleLabel(u.role))}</span>${esc(name)}`;

        // Role field — visible for all users
        const roleField = document.getElementById('edit-role-field');
        roleField.classList.remove('hidden');
        document.getElementById('edit-role').value = u.role;

        // Servers field
        const serversField = document.getElementById('edit-servers-field');
        serversField.classList.toggle('hidden', u.role !== 'mod');
        document.getElementById('edit-server-ids').value = (u.server_ids || []).join(', ');

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

        try {
            // Update role
            const newRole = document.getElementById('edit-role').value;
            if (newRole !== u.role) {
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

    setTab('users');
});
