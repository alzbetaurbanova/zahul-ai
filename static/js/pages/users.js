document.addEventListener('DOMContentLoaded', () => {
    const esc = escapeHtml;

    const ROLE_ICONS = { owner: 'fa-crown', admin: 'fa-shield-halved', mod: 'fa-user-shield', guest: 'fa-user' };
    function roleIcon(role) {
        const i = ROLE_ICONS[role] || 'fa-user';
        return `<i class="fas ${i}"></i> `;
    }

    // Guard: only owners
    fetch('/api/auth-status').then(r => r.json()).then(d => {
        if (!d.current_user || (d.current_user.role !== 'owner' && d.current_user.role !== 'admin')) {
            window.location.href = '/';
            return;
        }
        loadUsers();
    }).catch(() => { window.location.href = '/'; });

    // Close buttons wired by data-modal attribute
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    // --- Users List ---

    async function loadUsers() {
        const list = document.getElementById('user-list');
        try {
            const users = await fetch('/api/users/').then(r => r.json());
            if (!users.length) {
                list.innerHTML = '<div class="text-gray-500 text-center py-12">No users.</div>';
                return;
            }
            list.innerHTML = users.map(userRow).join('');
            list.querySelectorAll('[data-user-id]').forEach(row => {
                row.addEventListener('click', () => openEditModal(users.find(u => u.id == row.dataset.userId)));
            });
        } catch (e) {
            list.innerHTML = `<div class="text-red-400 text-center py-12">Failed to load: ${esc(String(e))}</div>`;
        }
    }

    function userRow(u) {
        const name = u.auth_provider === 'discord' ? (u.discord_username || u.username) : u.username;
        const authIcon = u.auth_provider === 'discord'
            ? '<i class="fab fa-discord text-indigo-400 text-xs" title="Discord"></i>'
            : '<i class="fas fa-key text-gray-500 text-xs" title="Local"></i>';
        const created = u.created_at ? u.created_at.slice(0, 10) : '';
        return `<div data-user-id="${u.id}" class="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-lg p-4 cursor-pointer transition-colors flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
                ${authIcon}
                <span class="font-medium text-sm text-white truncate">${esc(name)}</span>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <span class="role-badge role-${esc(u.role)}">${roleIcon(u.role)}${esc(u.role)}</span>
                <span class="text-xs text-gray-600">${created}</span>
            </div>
        </div>`;
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
            if (!res.ok) throw new Error(data.detail || 'Failed');
            closeModal('new-modal');
            showToast('User created', 'success');
            loadUsers();
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
        const isOwner = u.role === 'owner';
        const isDiscord = u.auth_provider === 'discord';

        document.getElementById('edit-modal-title').innerHTML =
            `<span class="role-badge role-${esc(u.role)} mr-2">${roleIcon(u.role)}${esc(u.role)}</span>${esc(name)}`;

        // Role field — hidden for owner
        const roleField = document.getElementById('edit-role-field');
        roleField.classList.toggle('hidden', isOwner);
        if (!isOwner) document.getElementById('edit-role').value = u.role;

        // Servers field
        const serversField = document.getElementById('edit-servers-field');
        serversField.classList.toggle('hidden', u.role !== 'mod');
        document.getElementById('edit-server-ids').value = (u.server_ids || []).join(', ');

        // Password field — only for local accounts
        document.getElementById('edit-pw-field').classList.toggle('hidden', isDiscord);
        document.getElementById('edit-password').value = '';

        // Delete button — hidden for owner
        document.getElementById('edit-delete-btn').classList.toggle('hidden', isOwner);

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
        const isOwner = u.role === 'owner';

        try {
            // Update role
            if (!isOwner) {
                const newRole = document.getElementById('edit-role').value;
                if (newRole !== u.role) {
                    const res = await fetch(`/api/users/${u.id}/role`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: newRole })
                    });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Role update failed');
                }

                // Update server access for mod
                if (newRole === 'mod') {
                    const ids = document.getElementById('edit-server-ids').value.trim();
                    const server_ids = ids ? ids.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const res = await fetch(`/api/users/${u.id}/servers`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ server_ids })
                    });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Server update failed');
                }
            }

            // Update password (local only)
            const pw = document.getElementById('edit-password').value;
            if (pw) {
                if (pw.length < 8) return showErr(errEl, 'Password must be at least 8 characters.');
                const res = await fetch(`/api/users/${u.id}/password`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_password: pw })
                });
                if (!res.ok) throw new Error((await res.json()).detail || 'Password update failed');
            }

            closeModal('edit-modal');
            showToast('Saved', 'success');
            loadUsers();
        } catch (e) {
            showErr(errEl, String(e));
        }
    });

    document.getElementById('edit-delete-btn').addEventListener('click', () => {
        document.getElementById('delete-modal-name').textContent =
            _editUser.auth_provider === 'discord' ? (_editUser.discord_username || _editUser.username) : _editUser.username;
        closeModal('edit-modal');
        openModal('delete-modal');
    });

    document.getElementById('delete-modal-confirm').addEventListener('click', async () => {
        try {
            const res = await fetch(`/api/users/${_editUser.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
            closeModal('delete-modal');
            showToast('User deleted', 'success');
            loadUsers();
        } catch (e) {
            showToast(String(e), 'error');
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
});
