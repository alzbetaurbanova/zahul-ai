(() => {
    let LIMIT = 25;
    let currentTab = new URLSearchParams(location.search).get('tab') === 'admin' ? 'admin' : 'discord';
    let currentPage = 1;
    let totalItems = 0;
    let currentUserRole = 'guest';
    let canViewLogs = false;
    let _initialAutoOpen = !!new URLSearchParams(location.search).get('task_id');
    let channelMap = {};  // channel_id -> {server_name, channel_name}
    let serverNames = {};  // server_id -> server_name
    const esc = escapeHtml;

    function canReadLogs() {
        return currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    async function loadServerNames() {
        try {
            const servers = await fetch('/api/servers/').then(r => r.json());
            servers.forEach(s => { serverNames[s.server_id] = s.server_name; });
        } catch {}
    }

    async function loadMeta() {
        try {
            const data = await fetch('/api/logs/meta').then(r => r.json());
            channelMap = data.channels || {};
            setupFilterCombobox(
                'df-character',
                'df-character-dd',
                data.characters || [],
                () => { currentPage = 1; fetchLogs(); },
                () => { currentPage = 1; fetchLogs(); }
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

    function resolveChannel(channel_id) {
        if (!channel_id) return '';
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
        btn.addEventListener('click', () => {
            currentPage = 1;
            activateTab(btn.dataset.tab);
            history.replaceState(null, '', `?tab=${currentTab}`);
            fetchLogs();
        });
    });

    // --- Filter auto-fire ---
    ['df-from','df-to'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => { currentPage = 1; fetchLogs(); });
    });
    ['af-from','af-to'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => { currentPage = 1; fetchLogs(); });
    });

    document.getElementById('df-from-clear').addEventListener('click', () => { document.getElementById('df-from').value = ''; currentPage = 1; fetchLogs(); });
    document.getElementById('df-to-clear').addEventListener('click', () => { document.getElementById('df-to').value = ''; currentPage = 1; fetchLogs(); });
    document.getElementById('af-from-clear').addEventListener('click', () => { document.getElementById('af-from').value = ''; currentPage = 1; fetchLogs(); });
    document.getElementById('af-to-clear').addEventListener('click', () => { document.getElementById('af-to').value = ''; currentPage = 1; fetchLogs(); });
    document.getElementById('discord-clear-btn').addEventListener('click', () => {
        ['df-from','df-to','df-character','df-user'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(el);
            }
        });
        clearDd('df-source'); clearDd('df-status');
        document.querySelectorAll('#discord-filters [data-clear]').forEach(btn => btn.classList.add('hidden'));
        currentPage = 1; fetchLogs();
    });
    document.getElementById('admin-clear-btn').addEventListener('click', () => {
        ['af-from','af-to', 'af-user'].forEach(id => {
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
        if (!canViewLogs) {
            showToast('You do not have permission to export logs.', 'error');
            return;
        }
        const params = buildParams();
        window.location.href = `/api/logs/${currentTab}/export?${params}`;
    });

    function getChecked(cls) {
        return [...document.querySelectorAll('.' + cls + ':checked')].map(el => el.value);
    }
    function buildParams() {
        const p = new URLSearchParams({ page: currentPage, limit: LIMIT });
        if (currentTab === 'discord') {
            const v = id => document.getElementById(id).value;
            if (v('df-from')) p.set('from_date', v('df-from'));
            if (v('df-to')) p.set('to_date', v('df-to'));
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
        if (!canViewLogs) {
            list.innerHTML = '<div class="text-gray-500 text-center py-12">You do not have permission to view logs.</div>';
            totalItems = 0;
            updatePagination();
            return;
        }
        list.innerHTML = '<div class="text-gray-500 text-center py-12">Loading...</div>';
        try {
            const res = await fetch(`/api/logs/${currentTab}?${buildParams()}`);
            const data = await res.json();
            totalItems = data.total;
            renderLogs(data.items);
            updatePagination();
            if (_initialAutoOpen) {
                _initialAutoOpen = false;
                if (data.total === 1 && data.items[0]) openDetail(data.items[0].id);
                else if (data.total === 0) showToast('No logs found for this task.', 'error');
            }
        } catch (e) {
            list.innerHTML = '<div class="text-red-400 text-center py-12">Failed to load logs.</div>';
        }
    }

    function renderLogs(items) {
        const list = document.getElementById('log-list');
        if (!items.length) { list.innerHTML = '<div class="text-gray-500 text-center py-12">No logs found.</div>'; return; }
        list.innerHTML = items.map(item => currentTab === 'discord' ? discordRow(item) : adminRow(item)).join('');
        list.querySelectorAll('[data-log-id]').forEach(row => {
            row.addEventListener('click', () => openDetail(parseInt(row.dataset.logId)));
        });
    }

    function fmt(ts) {
        return ts ? new Date(ts).toLocaleString('sk-SK', { hour12: false }) : '';
    }

    function discordRow(item) {
        const statusColor = item.status === 'error' ? 'text-red-400' : 'text-green-400';
        const sourceColor = item.source === 'scheduler' ? 'bg-indigo-900 text-indigo-300' : 'bg-gray-800 text-gray-300';
        return `<div data-log-id="${item.id}" class="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-lg p-4 cursor-pointer transition-colors">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs px-2 py-0.5 rounded ${sourceColor}">${item.source || 'chat'}</span>
                    <span class="font-semibold text-white text-sm">${esc(item.character || '')}</span>
                    ${item.user && item.user !== 'system' ? `<span class="text-xs text-gray-500">← ${esc(item.user)}</span>` : ''}
                    ${item.channel_id ? `<span class="text-xs text-gray-600">${esc(resolveChannel(item.channel_id))}</span>` : ''}
                    <span class="${statusColor} text-xs"><i class="fas fa-circle text-[8px]"></i> ${item.status}</span>
                </div>
                <div class="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
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
            'plugins.reload': 'bg-cyan-900 text-cyan-300',
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
            'trash.restore': 'bg-orange-900 text-orange-300',
            'user.create': 'bg-indigo-900 text-indigo-300',
            'user.delete': 'bg-red-900 text-red-300',
            'user.password_update': 'bg-blue-900 text-blue-300',
            'user.role_update': 'bg-blue-900 text-blue-300',
        };
        const labels = {
            'config.security_update': 'config.security.update',
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
        return `<div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
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
        const chResolved = resolveChannel(item.channel_id || '');
        const chParts = (!isDM && chResolved.includes(' / ')) ? chResolved.split(' / ') : [chResolved, ''];
        const chServer = isDM ? 'DM' : chParts[0];
        const dmRecipient = item.channel_id && item.channel_id.startsWith('dm:') ? item.channel_id.slice(3) : null;
        const chChannel = isDM ? (dmRecipient ? `DM - ${dmRecipient}` : 'DM') : (chParts.slice(1).join(' / ') || chParts[0]);
        const statusCls = item.status === 'error' ? 'text-red-400' : 'text-green-400';

        const row = (label, value, cls='') =>
            `<div class="metadata-label">${label}</div><div class="${cls}">${value}</div>`;

        body.innerHTML = `
            <div class="detail-content">

                <div class="log-ts">${fmt(item.timestamp)}</div>

                <div class="metadata-grid">
                    ${row('Character', esc(item.character || ''))}
                    ${row('User', esc(item.user || ''))}
                    ${row('Server', esc(chServer))}
                    ${row('Channel', esc(chChannel))}
                    ${row('Model', esc(item.model || ''))}
                    ${row('Tokens in/out', `${item.input_tokens || 0} / ${item.output_tokens || 0}`)}
                    ${row('History', `${item.history_count ?? '—'} msgs`)}
                    ${row('Temperature', item.temperature != null ? item.temperature : '—')}
                    ${row('Source', esc(item.source || ''))}
                    ${row('Status', esc(item.status || ''), statusCls)}
                    ${(item.source === 'scheduler' && item.task_id) ? row('Scheduler', `<a href="/scheduler?open=${item.task_id}&character=${encodeURIComponent(item.character || '')}" class="link-indigo-sm"><i class="fas fa-calendar-alt mr-1"></i>View task</a>`) : ''}
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
                                <input type="checkbox" id="req-prettier" class="accent-indigo-500">
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

    fetch('/api/auth-status')
        .then(r => r.json())
        .then(d => {
            currentUserRole = d?.current_user?.role || (d?.panel_auth_enabled ? 'guest' : 'super_admin');
            canViewLogs = canReadLogs();
            activateTab(currentTab);
        })
        .catch(() => {})
        .finally(() => {
            Promise.all([loadMeta(), loadServerNames()]).then(() => {
                if (canViewLogs) {
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
