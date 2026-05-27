(() => {
    let LIMIT = 25;
    let currentTab = new URLSearchParams(location.search).get('tab') === 'admin' ? 'admin' : 'discord';
    let currentPage = 1;
    let totalItems = 0;
    let currentUserRole = 'guest';
    let _initialAutoOpen = !!new URLSearchParams(location.search).get('task_id');
    let channelMap = {};  // channel_id -> {server_name, channel_name}
    let serverNames = {};  // server_id -> server_name
    let serverNameMap = {};  // display name -> server_id
    let modScopeNoChannels = false;
    const esc = escapeHtml;

    function isMod() { return currentUserRole === 'mod'; }

    function canViewDiscordLogs() {
        return currentUserRole === 'guest' || currentUserRole === 'mod' ||
            currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    function canViewAdminLogs() {
        return currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    function effectiveLogTab() {
        return currentTab === 'admin' ? 'admin' : 'discord';
    }

    function resetPageAndFetch() {
        currentPage = 1;
        fetchLogs();
    }

    function adminPermissionHtml() {
        return `<div class="text-gray-500 text-center py-12">
            <i class="fas fa-lock text-3xl mb-3 block opacity-40"></i>
            <p class="text-base">You do not have permission to view admin logs.</p>
            <p class="text-sm text-gray-600 mt-1">Admin activity is only visible to admins.</p>
        </div>`;
    }

    function clearDiscordUrlFilters() {
        const p = new URLSearchParams(location.search);
        let changed = false;
        ['task_id', 'character', 'source'].forEach(k => {
            if (p.has(k)) { p.delete(k); changed = true; }
        });
        if (changed) {
            const q = p.toString();
            history.replaceState(null, '', q ? `?${q}` : location.pathname);
        }
    }

    async function loadServerNames() {
        try {
            const servers = await fetch('/api/servers/').then(r => r.json());
            const names = [];
            servers.forEach(s => {
                serverNames[s.server_id] = s.server_name;
                if (!s.server_name?.toLowerCase().includes('direct message')) {
                    serverNameMap[s.server_name] = s.server_id;
                    names.push(s.server_name);
                }
            });
            if (typeof setupFilterCombobox === 'function') {
                setupFilterCombobox(
                    'df-server', 'df-server-dd',
                    () => names,
                    () => { currentPage = 1; fetchLogs(); },
                    () => { currentPage = 1; fetchLogs(); },
                    'hover:bg-gray-700'
                );
            }
        } catch {}
    }

    async function loadMeta() {
        try {
            const res = await fetch('/api/logs/meta');
            if (!res.ok) return;
            const data = await res.json();
            channelMap = data.channels || {};
            modScopeNoChannels = isMod() && Object.keys(channelMap).length === 0;
            setupFilterCombobox(
                'df-character',
                'df-character-dd',
                data.characters || [],
                resetPageAndFetch,
                resetPageAndFetch
            );
            setupFilterCombobox(
                'df-user',
                'df-user-dd',
                data.users || [],
                () => { currentPage = 1; fetchLogs(); },
                () => { currentPage = 1; fetchLogs(); }
            );
            setupFilterCombobox(
                'af-user',
                'af-user-dd',
                data.admin_users || [],
                () => { currentPage = 1; fetchLogs(); },
                () => { currentPage = 1; fetchLogs(); }
            );
        } catch (e) {}
    }

    function parseSimulatorServerId(channel_id) {
        if (!channel_id) return null;
        if (channel_id.startsWith('simulator:')) return channel_id.slice('simulator:'.length) || null;
        if (channel_id.startsWith('simulation:')) return channel_id.slice('simulation:'.length) || null;
        return null;
    }

    function simulatorServerName(serverId) {
        if (!serverId) return '';
        if (serverNames[serverId]) return serverNames[serverId];
        const info = channelMap[`simulator:${serverId}`];
        if (info?.server_name && info.server_name !== serverId) return info.server_name;
        for (const info of Object.values(channelMap)) {
            if (info.server_id === serverId && info.server_name && info.server_name !== serverId) {
                return info.server_name;
            }
        }
        return '';
    }

    function resolveSimulatorLocation(channel_id) {
        const serverId = parseSimulatorServerId(channel_id);
        const serverName = simulatorServerName(serverId);
        if (serverName) return `${serverName} / simulator`;
        return 'simulator';
    }

    function resolveChannel(channel_id) {
        if (!channel_id) return '';
        if (channel_id.startsWith('simulation:') || channel_id.startsWith('simulator:') || channel_id === 'simulation') {
            return resolveSimulatorLocation(channel_id);
        }
        if (channel_id === 'dm') return 'Direct Message';
        if (channel_id.startsWith('dm:')) return `DM: ${channel_id.slice(3)}`;
        const rawId = channel_id.startsWith('channel:') ? channel_id.slice(8) : channel_id;
        const info = channelMap[rawId];
        if (info) return `${info.server_name} / #${info.channel_name}`;
        return channel_id;
    }

    function activateTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => {
            const active = b.dataset.tab === tab;
            b.classList.toggle('tab-active', active);
            b.classList.toggle('text-white', active);
        });
        document.getElementById('discord-filters').classList.toggle('hidden', tab !== 'discord');
        document.getElementById('admin-filters').classList.toggle('hidden', tab !== 'admin');
    }

    function updateAdminTabAccess() {
        document.querySelectorAll('.tab-btn[data-tab="admin"]').forEach(btn => {
            const locked = !canViewAdminLogs();
            const lockTitle = 'You do not have permission to view admin logs.';
            btn.classList.remove('hidden');
            btn.classList.toggle('tab-locked', locked);
            btn.disabled = locked;
            btn.setAttribute('aria-disabled', locked ? 'true' : 'false');

            const wrap = btn.parentElement?.classList.contains('tab-lock-wrap')
                ? btn.parentElement : null;
            if (locked) {
                if (!wrap) {
                    const span = document.createElement('span');
                    span.className = 'tab-lock-wrap';
                    span.title = lockTitle;
                    btn.parentNode.insertBefore(span, btn);
                    span.appendChild(btn);
                } else {
                    wrap.title = lockTitle;
                }
                btn.removeAttribute('title');
            } else {
                btn.title = '';
                if (wrap) {
                    wrap.parentNode.insertBefore(btn, wrap);
                    wrap.remove();
                }
            }
        });
    }

    function hasActiveFilters() {
        if (currentTab === 'discord') {
            const v = id => (document.getElementById(id)?.value || '').trim();
            if (v('df-from') || v('df-to') || v('df-server') || v('df-character') || v('df-user')) return true;
            if (getChecked('df-source-cb').length || getChecked('df-status-cb').length) return true;
            if (new URLSearchParams(location.search).get('task_id')) return true;
            return false;
        }
        const v = id => (document.getElementById(id)?.value || '').trim();
        if (v('af-from') || v('af-to') || v('af-user')) return true;
        return getChecked('af-action-cb').length > 0;
    }

    function emptyLogsHtml() {
        const filtered = hasActiveFilters();
        let title;
        let hint;
        if (currentTab === 'admin') {
            title = filtered ? 'No admin logs match your filters.' : 'No admin activity yet.';
            hint = filtered ? 'Try clearing or changing the filters above.' : 'Panel actions will show up here when they happen.';
        } else if (isMod() && modScopeNoChannels && !filtered) {
            title = 'No channels on your servers yet.';
            hint = 'Add channels under Servers — once the bot is active there, logs will show up here.';
        } else {
            title = filtered ? 'No logs match your filters.' : 'No activity yet.';
            hint = filtered ? 'Try clearing or changing the filters above.' : 'Logs will appear here when the bot responds in your channels.';
        }
        return `<div class="text-gray-500 text-center py-12">
            <i class="fas fa-inbox text-3xl mb-3 block opacity-40"></i>
            <p class="text-base">${esc(title)}</p>
            <p class="text-sm text-gray-600 mt-1">${esc(hint)}</p>
        </div>`;
    }

    const adminActionSearch = typeof initSearchableCheckboxDropdown === 'function'
        ? initSearchableCheckboxDropdown({ searchInputId: 'af-action-search', dropdownId: 'dd-action' })
        : null;

    function clearDd(cls) {
        clearCheckboxDropdownPrefix(cls, {
            afterReset: (prefix) => {
                if (prefix === 'af-action') adminActionSearch?.reset();
            },
        });
    }

    if (typeof initCbDdInteractions === 'function') {
        initCbDdInteractions({
            containers: [
                document.getElementById('discord-filters'),
                document.getElementById('admin-filters'),
            ],
            onCheckboxChange: () => {
                currentPage = 1;
                fetchLogs();
            },
        });
    }

    if (typeof wireCbDdClear === 'function') {
        wireCbDdClear('dd-source-clear', 'dd-source', () => {
            currentPage = 1;
            fetchLogs();
        });
        wireCbDdClear('dd-status-clear', 'dd-status', () => {
            currentPage = 1;
            fetchLogs();
        });
        wireCbDdClear('dd-action-clear', 'dd-action', () => {
            adminActionSearch?.reset();
            currentPage = 1;
            fetchLogs();
        });
    }

    // --- Tab switching ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (btn.disabled || btn.classList.contains('tab-locked')) {
                e.preventDefault();
                showToast('You do not have permission to view admin logs.', 'error');
                return;
            }
            currentPage = 1;
            activateTab(btn.dataset.tab);
            history.replaceState(null, '', `?tab=${currentTab}`);
            fetchLogs();
        });
    });

    // --- Filter auto-fire (date fields: same native input + custom popup as scheduler) ---
    [
        { input: 'df-from', clear: 'clear-df-from-btn' },
        { input: 'df-to', clear: 'clear-df-to-btn' },
        { input: 'af-from', clear: 'clear-af-from-btn' },
        { input: 'af-to', clear: 'clear-af-to-btn' },
    ].forEach(({ input, clear }) => {
        const el = document.getElementById(input);
        if (!el) return;
        el.addEventListener('change', resetPageAndFetch);
        if (typeof setupDatePickerPopupOnly === 'function') {
            setupDatePickerPopupOnly(el, { onChange: resetPageAndFetch });
        }
        const clearBtn = document.getElementById(clear);
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                el.value = '';
                currentPage = 1;
                fetchLogs();
            });
        }
    });

    document.getElementById('discord-clear-btn').addEventListener('click', () => {
        ['df-from', 'df-to', 'df-server', 'df-character', 'df-user'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(el);
            }
        });
        clearDd('df-source'); clearDd('df-status');
        clearDiscordUrlFilters();
        document.querySelectorAll('#discord-filters [data-clear]').forEach(btn => btn.classList.add('hidden'));
        currentPage = 1; fetchLogs();
    });
    document.getElementById('admin-clear-btn').addEventListener('click', () => {
        ['af-from', 'af-to', 'af-user'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(el);
            }
        });
        clearDd('af-action');
        document.querySelectorAll('#admin-filters [data-clear]').forEach(btn => btn.classList.add('hidden'));
        currentPage = 1; fetchLogs();
    });
    if (typeof initFilterClear === 'function') initFilterClear(() => { currentPage = 1; fetchLogs(); }, document.getElementById('discord-filters'));

    // --- Pagination ---
    document.getElementById('prev-btn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; fetchLogs(); } });
    document.getElementById('next-btn').addEventListener('click', () => { if (currentPage * LIMIT < totalItems) { currentPage++; fetchLogs(); } });
    document.getElementById('limit-select').addEventListener('change', function() { LIMIT = parseInt(this.value); currentPage = 1; fetchLogs(); });

    // --- Export ---
    document.getElementById('export-btn').addEventListener('click', () => {
        const exportTab = effectiveLogTab();
        if (exportTab === 'admin' ? !canViewAdminLogs() : !canViewDiscordLogs()) {
            showToast('You do not have permission to export logs.', 'error');
            return;
        }
        const params = buildParams();
        window.location.href = `/api/logs/${effectiveLogTab()}/export?${params}`;
    });

    function getChecked(cls) {
        return [...document.querySelectorAll('.' + cls + ':checked')].map(el => el.value);
    }
    function buildParams() {
        const p = new URLSearchParams({ page: currentPage, limit: LIMIT });
        if (effectiveLogTab() === 'discord') {
            const v = id => document.getElementById(id).value;
            if (v('df-from')) p.set('from_date', v('df-from'));
            if (v('df-to')) p.set('to_date', v('df-to'));
            const serverName = v('df-server').trim();
            if (serverName && serverNameMap[serverName]) p.set('server_id', serverNameMap[serverName]);
            if (v('df-character')) p.set('character', v('df-character'));
            if (v('df-user')) p.set('user', v('df-user'));
            const taskIdParam = new URLSearchParams(location.search).get('task_id');
            if (taskIdParam) p.set('task_id', taskIdParam);
            getChecked('df-source-cb').forEach(s => p.append('source', s));
            getChecked('df-status-cb').forEach(s => p.append('status', s));
        } else {
            const v = id => document.getElementById(id).value;
            if (v('af-from')) p.set('from_date', v('af-from'));
            if (v('af-to')) p.set('to_date', v('af-to'));
            if (v('af-user')) p.set('user', v('af-user'));
            getChecked('af-action-cb').forEach(s => p.append('action', s));
        }
        return p.toString();
    }

    async function fetchLogs() {
        const list = document.getElementById('log-list');
        const apiTab = effectiveLogTab();
        if (apiTab === 'admin' && !canViewAdminLogs()) {
            list.innerHTML = adminPermissionHtml();
            totalItems = 0;
            updatePagination();
            return;
        }

        if (apiTab === 'discord' && !canViewDiscordLogs()) {
            list.innerHTML = emptyLogsHtml();
            totalItems = 0;
            updatePagination();
            return;
        }
        showPanelLoader(list, 'Loading logs...');
        try {
            const res = await fetch(`/api/logs/${apiTab}?${buildParams()}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (apiTab === 'discord') {
                    totalItems = 0;
                    renderLogs([]);
                    updatePagination();
                    return;
                }
                const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`;
                throw new Error(detail);
            }
            totalItems = data.total ?? 0;
            const items = Array.isArray(data.items) ? data.items : [];
            renderLogs(items);
            updatePagination();
            if (_initialAutoOpen) {
                _initialAutoOpen = false;
                if (data.total === 1 && items[0]) openDetail(items[0].id);
                else if (data.total === 0) showToast('No logs found for this task.', 'error');
            }
        } catch (e) {
            console.error('fetchLogs:', e);
            if (apiTab === 'discord') {
                totalItems = 0;
                renderLogs([]);
                updatePagination();
                return;
            }
            list.innerHTML = `<div class="text-red-400 text-center py-12">
                <i class="fas fa-exclamation-circle text-3xl mb-3 block opacity-60"></i>
                <p>Could not load logs.</p>
                <p class="text-sm text-red-300/80 mt-1">${esc(e.message || 'Please try again.')}</p>
            </div>`;
        }
    }

    function renderLogs(items) {
        const list = document.getElementById('log-list');
        if (!items || !items.length) {
            list.innerHTML = emptyLogsHtml();
            return;
        }
        list.innerHTML = items.map(item => currentTab === 'discord' ? discordRow(item) : adminRow(item)).join('');
        list.querySelectorAll('[data-log-id]').forEach(row => {
            row.addEventListener('click', () => openDetail(parseInt(row.dataset.logId)));
        });
    }

    function fmt(ts) {
        if (!ts) return '';
        // Timestamps are stored as Europe/Bratislava local time without a timezone suffix.
        const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (m) {
            const d = new Date(
                Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                Number(m[4]), Number(m[5]), Number(m[6] || 0),
            );
            return d.toLocaleString('sk-SK', { hour12: false });
        }
        return new Date(ts).toLocaleString('sk-SK', { hour12: false });
    }

    function discordRow(item) {
        const statusColor = item.status === 'error' ? 'text-red-400' : 'text-green-400';
        const sourceColor = item.source === 'scheduler'
            ? 'bg-indigo-900 text-indigo-300'
            : item.source === 'test'
                ? 'bg-amber-900 text-amber-300'
                : 'bg-gray-800 text-gray-300';
        return `<div data-log-id="${item.id}" class="card-dark card-dark--row card-dark--clickable">
            <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs px-2 py-0.5 rounded ${sourceColor}">${item.source || 'chat'}</span>
                    <span class="font-semibold text-white text-sm">${esc(item.character || '')}</span>
                    ${item.user && item.user !== 'system' ? `<span class="text-xs text-gray-500">← ${esc(item.user)}</span>` : ''}
                    ${item.channel_id ? `<span class="text-xs text-gray-600">${esc(resolveChannel(item.channel_id))}</span>` : ''}
                </div>
                <div class="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                    <span class="${statusColor}">${item.status === 'error' ? 'error' : 'ok'}</span>
                    <span title="in/out tokens"><i class="fas fa-coins mr-1"></i>${item.input_tokens || 0}/${item.output_tokens || 0}</span>
                    <span>${fmt(item.timestamp)}</span>
                </div>
            </div>
            <p class="text-xs text-gray-400 truncate">${esc(item.trigger || '')}</p>
            ${item.response ? `<p class="text-xs text-gray-500 truncate mt-0.5">${esc(item.response)}</p>` : ''}
        </div>`;
    }

    function adminRow(item) {
        const colors = {
            'access.request.approve': 'bg-emerald-900 text-emerald-300',
            'access.request.create': 'bg-purple-900 text-purple-300',
            'access.request.deny': 'bg-red-900 text-red-300',
            'discord.dm.queued': 'bg-slate-800 text-slate-300',
            'discord.dm.delivered': 'bg-emerald-950 text-emerald-200',
            'discord.dm.retry': 'bg-amber-950 text-amber-200',
            'discord.dm.queue_drop': 'bg-gray-800 text-gray-400',
            'auth.super_admin.created': 'bg-amber-900 text-amber-200',
            'channel.create': 'bg-teal-900 text-teal-300',
            'channel.delete': 'bg-red-900 text-red-300',
            'channel.update': 'bg-blue-900 text-blue-300',
            'character.avatar.mirror': 'bg-green-800 text-green-200',
            'character.avatar.upload': 'bg-green-800 text-green-200',
            'character.create': 'bg-green-900 text-green-300',
            'character.delete': 'bg-red-900 text-red-300',
            'character.image.upload': 'bg-green-800 text-green-200',
            'character.import': 'bg-green-800 text-green-200',
            'character.update': 'bg-blue-900 text-blue-300',
            'config.security.methods.update': 'bg-amber-900 text-amber-300',
            'config.security.update': 'bg-red-900 text-red-300',
            'config.security_update': 'bg-red-900 text-red-300',
            'config.update': 'bg-amber-900 text-amber-300',
            'log.delete': 'bg-gray-700 text-gray-200',
            'preset.create': 'bg-violet-900 text-violet-300',
            'preset.delete': 'bg-red-900 text-red-300',
            'preset.update': 'bg-violet-800 text-violet-200',
            'server.activate': 'bg-yellow-900 text-yellow-300',
            'server.create': 'bg-teal-900 text-teal-300',
            'server.deactivate': 'bg-yellow-900 text-yellow-300',
            'server.delete': 'bg-red-900 text-red-300',
            'servers.override.on': 'bg-blue-900 text-blue-300',
            'servers.override.off': 'bg-blue-900 text-blue-300',
            'task.create': 'bg-green-900 text-green-300',
            'task.delete': 'bg-red-900 text-red-300',
            'task.update': 'bg-blue-900 text-blue-300',
            'test.chatbot': 'bg-indigo-950 text-indigo-200',
            'trash.restore': 'bg-orange-900 text-orange-300',
            'user.create': 'bg-indigo-900 text-indigo-300',
            'user.delete': 'bg-red-900 text-red-300',
            'user.password_update': 'bg-blue-900 text-blue-300',
            'user.role_update': 'bg-blue-900 text-blue-300',
        };
        const labels = {
            'config.security_update': 'config.security.update',
            'test.chatbot': 'test.chatbot',
        };
        const overrideOn  = ['servers.override.on'];
        const overrideOff = ['servers.override.off'];
        const isServerOverride = item.action === 'servers.override.on' || item.action === 'servers.override.off';
        const overrideLabel = overrideOn.includes(item.action) ? 'override on' : overrideOff.includes(item.action) ? 'override off' : null;
        const color = colors[item.action] || 'bg-gray-800 text-gray-300';
        const label = labels[item.action] ?? item.action;
        const actorName = String(item.actor_username || 'system');
        const actorId = item.actor_user_id != null ? `#${item.actor_user_id}` : null;
        const actorDisplay = actorId ? `${actorName} (${actorId})` : actorName;
        const targetDisplay = isServerOverride
            ? (serverNames[item.target] || item.target || '')
            : (item.target || '');
        return `<div class="card-dark card-dark--row card-dark--row-admin">
            <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs px-2 py-0.5 rounded flex-shrink-0 ${color}">${esc(label)}</span>
                ${overrideLabel ? `<span class="text-xs text-gray-400 flex-shrink-0">${overrideLabel}</span>` : ''}
                ${targetDisplay ? `<span class="text-xs text-gray-400 flex-shrink-0">${esc(targetDisplay)}</span>` : ''}
                ${item.detail ? `<span class="text-xs text-gray-500 truncate">${esc(item.detail)}</span>` : ''}
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                <span>${esc(actorDisplay)}</span>
                <span>${fmt(item.timestamp)}</span>
            </div>
        </div>`;
    }

    function updatePagination() {
        const start = (currentPage - 1) * LIMIT + 1;
        const end = Math.min(currentPage * LIMIT, totalItems);
        document.getElementById('pagination').classList.toggle('hidden', totalItems <= 10);
        document.getElementById('pagination-info').textContent = totalItems ? `${start}–${end} of ${totalItems}` : '';
        document.getElementById('prev-btn').disabled = currentPage <= 1;
        document.getElementById('next-btn').disabled = currentPage * LIMIT >= totalItems;
    }

    // --- Detail modal ---
    function closeDetailModal() {
        document.getElementById('detail-modal').classList.add('hidden');
        const p = new URLSearchParams(location.search);
        if (p.has('task_id')) { p.delete('task_id'); history.replaceState(null, '', `?${p.toString()}`); }
    }
    document.getElementById('detail-close').addEventListener('click', closeDetailModal);
    document.getElementById('detail-modal').addEventListener('click', e => { if (e.target === document.getElementById('detail-modal')) closeDetailModal(); });

    async function openDetail(id) {
        const res = await fetch(`/api/logs/discord/${id}`);
        if (!res.ok) return;
        const item = await res.json();
        const body = document.getElementById('detail-body');
        const isDM = !item.channel_id || item.channel_id === 'dm' || item.channel_id.startsWith('dm:');
        const simServerId = parseSimulatorServerId(item.channel_id || '');
        let chServer;
        let chChannel;
        if (simServerId) {
            chServer = simulatorServerName(simServerId) || '—';
            chChannel = 'simulator';
        } else {
            const chResolved = resolveChannel(item.channel_id || '');
            const chParts = (!isDM && chResolved.includes(' / ')) ? chResolved.split(' / ') : [chResolved, ''];
            chServer = isDM ? 'DM' : chParts[0];
            const dmRecipient = item.channel_id && item.channel_id.startsWith('dm:') ? item.channel_id.slice(3) : null;
            chChannel = isDM ? (dmRecipient ? `DM - ${dmRecipient}` : 'DM') : (chParts.slice(1).join(' / ') || chParts[0]);
        }
        const statusCls = item.status === 'error' ? 'text-red-400' : 'text-green-400';

        const row = (label, value, cls='') =>
            `<div class="metadata-label">${label}</div><div class="${cls}">${value}</div>`;

        body.innerHTML = `
            <div class="detail-content">

                <div class="flex items-center justify-between log-ts">
                    <span>${fmt(item.timestamp)}</span>
                    <span class="${statusCls} mr-4">${item.status === 'error' ? 'error' : 'ok'}</span>
                </div>

                <div class="metadata-grid">
                    ${row('Character', esc(item.character || ''))}
                    ${row('User', esc(item.user || ''))}
                    ${row('Server', esc(chServer))}
                    ${row('Channel', esc(chChannel))}
                    ${row('Source', esc(item.source || ''))}
                    ${row('Tokens in/out', `${item.input_tokens || 0} / ${item.output_tokens || 0}`)}
                    ${row('History', `${item.history_count ?? '—'} msgs`)}
                    ${row('Temperature', item.temperature != null ? item.temperature : '—')}
                    ${(item.source === 'scheduler' && item.task_id) ? row('Scheduler', `<a href="/scheduler?open=${item.task_id}&character=${encodeURIComponent(item.character || '')}" class="link-indigo-sm"><i class="fas fa-calendar-alt mr-1"></i>View task</a>`) : ''}
                    ${item.model ? `<div class="metadata-label">Model</div><div class="metadata-full-value font-mono">${esc(item.model)}${item.endpoint ? ` <span class="text-gray-500">(${esc(item.endpoint)})</span>` : ''}</div>` : ''}
                </div>

                <div class="log-section">
                    <div class="log-section-label">Trigger</div>
                    <pre class="log-pre">${esc(item.trigger || '')}</pre>
                </div>

                ${item.error_message ? `<div><p class="log-section-label">Error</p><pre class="log-pre-error">${esc(item.error_message)}</pre></div>` : ''}

                <div><p class="log-section-label">Response</p><pre class="log-pre">${esc(item.response || '')}</pre></div>

                ${item.conversation_history ? `<div>
                    <div class="log-json-header">
                        <p class="log-section-label">Request JSON</p>
                        <div class="log-json-controls">
                            <button id="copy-response-btn" class="btn-copy"><i class="fas fa-copy"></i> Copy</button>
                            <label class="log-prettier-label">
                                <input type="checkbox" id="req-prettier" class="custom-cb">
                                <span>Prettier</span>
                            </label>
                        </div>
                    </div>
                    <div id="req-json" class="log-json"></div>
                </div>` : ''}

            </div>
        `;
        document.getElementById('detail-modal').classList.remove('hidden');

        const copyBtn = document.getElementById('copy-response-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const cb = document.getElementById('req-prettier');
                let text;
                if (cb && cb.checked && item.conversation_history) {
                    text = item.conversation_history.map(m => {
                        const content = (m.content || '').replace(/\n/g, '\n').replace(/\[Reply\]/g, '').replace(/\[End\]/g, '').replace(/\[History\]/g, '\n\n[History]').replace(/\]\n(?!\n)/g, ']\n\n').replace(/\n(?!\n)\[/g, '\n\n[').replace(/\n{3,}/g, '\n\n').trim();
                        return `--------------# ${m.role.toUpperCase()} #--------------\n\n${content}`;
                    }).join('\n\n');
                } else {
                    text = item.response || '';
                }
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 1500);
                });
            });
        }

        if (item.conversation_history) {
            const raw = JSON.stringify(item.conversation_history, null, 2);
            const prettier = () => {
                const text = item.conversation_history.map(m => {
                    const content = (m.content || '').replace(/\n/g, '\n').replace(/\[Reply\]/g, '').replace(/\[End\]/g, '').replace(/\[History\]/g, '\n\n[History]').replace(/\]\n(?!\n)/g, ']\n\n').replace(/\n(?!\n)\[/g, '\n\n[').replace(/\n{3,}/g, '\n\n').trim();
                    return `--------------# ${m.role.toUpperCase()} #--------------\n\n${content}`;
                }).join('\n\n');
                return `<pre class="whitespace-pre-wrap break-words">${esc(text)}</pre>`;
            };
            const el = document.getElementById('req-json');
            const cb = document.getElementById('req-prettier');
            const render = () => { el.innerHTML = cb.checked ? prettier() : `<pre class="whitespace-pre-wrap break-words">${esc(raw)}</pre>`; };
            render();
            cb.addEventListener('change', render);
        }
    }

    (window.__authStatus || fetch('/api/me').then(r => r.json()))
        .then(d => {
            currentUserRole = d?.current_user?.role || (d?.panel_auth_enabled ? 'guest' : 'super_admin');
            updateAdminTabAccess();
            activateTab(currentTab);
        })
        .catch(() => {})
        .finally(() => {
            Promise.all([loadMeta(), loadServerNames()]).then(() => {
                if (canViewDiscordLogs()) {
                    const urlParams = new URLSearchParams(location.search);
                    const paramChar = urlParams.get('character');
                    const paramSource = urlParams.get('source');
                    if (paramChar) {
                        const dc = document.getElementById('df-character');
                        if (dc) {
                            dc.value = paramChar;
                            if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(dc);
                        }
                    }
                    if (paramSource) {
                        const cb = document.querySelector(`.df-source-cb[value="${paramSource}"]`);
                        if (cb) {
                            cb.checked = true;
                            document.querySelectorAll('.cb-dd-btn').forEach(btn => updateCbDdLabel(btn));
                        }
                    }
                }
                fetchLogs();
            });
        });
})();
