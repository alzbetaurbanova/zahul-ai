(() => {
        const API = '/api/tasks';
        const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const esc = escapeHtml;

        // --- DOM refs ---
        const taskList = document.getElementById('task-list');
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const form = document.getElementById('task-form');
        const taskIdInput = document.getElementById('task-id');
        const reminderFields = document.getElementById('reminder-fields');
        const scheduleFields = document.getElementById('schedule-fields');
        const statusField = document.getElementById('status-field');
        const toastContainer = document.getElementById('toast-container');
        const dayCheckboxes = document.getElementById('day-checkboxes');

        // Build day pill buttons
        DAYS.forEach((d, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.day = i;
            btn.className = 'day-pill tab-off';
            btn.textContent = d;
            btn.addEventListener('click', () => {
                btn.classList.toggle('tab-indigo-on');
                btn.classList.toggle('tab-off');
            });
            dayCheckboxes.appendChild(btn);
        });

        // Repeat type switching
        document.getElementById('f-repeat-type').addEventListener('change', function() {
            updateRepeatFields(this.value);
        });

        function updateRepeatFields(type) {
            document.getElementById('rp-daily').classList.toggle('hidden', type !== 'daily');
            document.getElementById('rp-weekly').classList.toggle('hidden', type !== 'weekly');
            document.getElementById('rp-monthly').classList.toggle('hidden', type !== 'monthly');
            document.getElementById('rp-yearly').classList.toggle('hidden', type !== 'yearly');
        }

        function getSelectedDays() {
            return [...document.querySelectorAll('.day-pill')].filter(b => b.classList.contains('tab-indigo-on')).map(b => parseInt(b.dataset.day));
        }

        function setSelectedDays(days) {
            document.querySelectorAll('.day-pill').forEach(b => {
                const active = days.includes(parseInt(b.dataset.day));
                b.classList.toggle('tab-indigo-on', active);
                b.classList.toggle('tab-off', !active);
            });
        }

        function setStatusOptions(type, selectedValue = '') {
            const statusSelect = document.getElementById('f-status');
            let options = [];
            if (type === 'schedule') {
                options = [
                    { value: 'active', label: 'Active' },
                    { value: 'disabled', label: 'Disabled' }
                ];
            } else {
                options = [
                    { value: 'upcoming', label: 'Upcoming' },
                    { value: 'done', label: 'Done' },
                    { value: 'disabled', label: 'Disabled' },
                    { value: 'failed', label: 'Failed' }
                ];
            }
            statusSelect.innerHTML = options.map(opt =>
                `<option value="${opt.value}">${opt.label}</option>`
            ).join('');
            if (selectedValue && options.some(opt => opt.value === selectedValue)) {
                statusSelect.value = selectedValue;
            }
        }

        // Type pill buttons
        function updateModeButtonLabels(type) {
            const generateBtn = document.getElementById('mode-generate');
            generateBtn.textContent = type === 'schedule' ? 'Instructions' : 'Generate';
        }

        function setType(type) {
            document.getElementById('selected-type').value = type;
            const isSchedule = type === 'schedule';
            reminderFields.classList.toggle('hidden', isSchedule);
            scheduleFields.classList.toggle('hidden', !isSchedule);
            document.getElementById('name-field').classList.toggle('hidden', !isSchedule);
            if (isSchedule) {
                setMessageMode('exact');
                document.getElementById('f-instructions').placeholder = "e.g. Write a dramatic scene about today's events.";
                const repeatTimeEl = document.getElementById('f-repeat-time');
                if (!repeatTimeEl.value) repeatTimeEl.value = '09:00';
            } else {
                document.getElementById('f-instructions').placeholder = 'What the character will say...';
            }
            updateModeButtonLabels(type);
            document.querySelectorAll('.type-btn').forEach(btn => {
                const isActive = btn.dataset.type === type;
                const isScheduleBtn = btn.dataset.type === 'schedule';
                const activeClass = isScheduleBtn ? 'tab-indigo-on' : 'tab-amber-on';
                if (isActive) {
                    btn.classList.remove('tab-off');
                    btn.classList.add(activeClass);
                } else {
                    btn.classList.remove(activeClass);
                    btn.classList.add('tab-off');
                }
            });
        }

        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => setType(btn.dataset.type));
        });

        function setMessageMode(mode) {
            document.getElementById('f-message-mode').value = mode;
            const label = document.getElementById('instructions-label');
            const textarea = document.getElementById('f-instructions');
            const type = document.getElementById('selected-type').value;
            document.querySelectorAll('.mode-btn').forEach(btn => {
                const active = btn.dataset.mode === mode;
                btn.classList.toggle('mode-tab-on', active);
                btn.classList.toggle('mode-tab-off', !active);
            });
            if (mode === 'generate') {
                if (type === 'schedule') {
                    label.textContent = 'Instructions';
                    textarea.placeholder = 'e.g. Ask the character to describe a dramatic scene from today.';
                } else {
                    label.textContent = 'Message prefix (bot will continue from here)';
                    textarea.placeholder = 'e.g. I wanted to remind you that...';
                }
                document.getElementById('history-limit-row').classList.remove('hidden');
                document.getElementById('history-limit-row').classList.add('flex');
                document.getElementById('char-col').classList.remove('w-full');
                document.getElementById('char-col').classList.add('w-[70%]');
            } else {
                label.textContent = 'Message Text';
                textarea.placeholder = 'What the character will say...';
                document.getElementById('history-limit-row').classList.add('hidden');
                document.getElementById('history-limit-row').classList.remove('flex');
                document.getElementById('char-col').classList.remove('w-[70%]');
                document.getElementById('char-col').classList.add('w-full');
                setHistoryToggle(false);
            }
        }

        function setHistoryToggle(on) {
            const btn = document.getElementById('history-toggle');
            const thumb = document.getElementById('history-thumb');
            const input = document.getElementById('f-history-limit');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.classList.toggle('is-on', on);
            thumb.classList.toggle('is-on', on);
            input.disabled = !on;
            if (!on) input.value = '';
        }

        async function loadHistoryDefault() {
            try {
                const charName = document.getElementById('f-character').value;
                let limit = null;
                if (charName) {
                    const chars = await fetch('/api/characters').then(r => r.json());
                    const char = chars.find(c => c.name === charName);
                    if (char?.data?.history_limit != null) limit = char.data.history_limit;
                }
                if (limit == null) {
                    const cfg = await fetch('/api/config/').then(r => r.json());
                    limit = cfg.history_limit ?? 10;
                }
                document.getElementById('f-history-limit').value = limit;
            } catch { }
        }

        document.getElementById('history-toggle').addEventListener('click', async () => {
            const isOn = document.getElementById('history-toggle').getAttribute('aria-pressed') === 'true';
            setHistoryToggle(!isOn);
            if (!isOn) await loadHistoryDefault();
        });

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => setMessageMode(btn.dataset.mode));
        });

        // Populate character dropdown
        let _charNames = [];

        async function loadCharacters() {
            try {
                const data = await fetch('/api/characters').then(r => r.json());
                _charNames = data.map(c => c.name);
                data.forEach(c => { _charCache[c.name] = c; });
            } catch { _charNames = []; }
            setupFilterCombobox('f-character', 'f-character-dd', _charNames, null, null, 'hover:bg-gray-700');
            setupFilterCombobox(
                'filter-character',
                'filter-character-dd',
                _charNames,
                () => { currentPage = 1; renderTasks(allTasks); },
                () => { currentPage = 1; renderTasks(allTasks); },
                'hover:bg-gray-700'
            );
        }

        // --- Target comboboxes ---
        let _channelOptions = [];  // [{id, label}]
        let _dmOptions = [];

        async function loadTargetOptions() {
            try {
                const servers = await fetch('/api/servers/').then(r => r.json());
                _channelOptions = [];
                for (const srv of servers) {
                    if (srv.server_id === 'DM_VIRTUAL_SERVER') continue;
                    const channels = await fetch(`/api/servers/${srv.server_id}/channels`).then(r => r.json());
                    for (const ch of channels) {
                        _channelOptions.push({ id: ch.channel_id, label: `#${ch.data.name}`, sub: srv.server_name });
                    }
                }
            } catch { _channelOptions = []; }
            try {
                const cfg = await fetch('/api/config/').then(r => r.json());
                _dmOptions = (cfg.dm_list || []).map(u => ({ id: u, label: u, sub: '' }));
            } catch { _dmOptions = []; }
        }

        function makeCombobox(inputId, dropdownId, options, initialId = '') {
            const input = document.getElementById(inputId);
            const dropdown = document.getElementById(dropdownId);

            // Set display value from id
            const found = options.find(o => o.id === initialId);
            input.value = found ? found.label : (initialId || '');
            input.dataset.value = initialId;

            function showDropdown(filter = '') {
                const q = filter.toLowerCase();
                const filtered = q
                    ? options.filter(o => o.label.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q) || o.id.includes(q))
                    : options;
                if (!filtered.length) { dropdown.classList.add('hidden'); return; }
                dropdown.innerHTML = filtered.map(o => `
                    <div class="combobox-item px-3 py-2 cursor-pointer hover:bg-gray-700 text-sm flex justify-between items-center"
                         data-id="${esc(o.id)}" data-label="${esc(o.label)}">
                        <span class="text-white">${esc(o.label)}</span>
                        <span class="text-gray-500 text-xs ml-2">${esc(o.sub)}</span>
                    </div>`).join('');
                dropdown.querySelectorAll('.combobox-item').forEach(item => {
                    item.addEventListener('mousedown', e => {
                        e.preventDefault();
                        input.value = item.dataset.label;
                        input.dataset.value = item.dataset.id;
                        dropdown.classList.add('hidden');
                    });
                });
                dropdown.classList.remove('hidden');
            }

            input.addEventListener('focus', () => showDropdown(input.value));
            input.addEventListener('input', () => { input.dataset.value = ''; showDropdown(input.value); });
            input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
        }

        function initChannelCombobox(currentId = '') {
            makeCombobox('f-channel-input', 'f-channel-dropdown', _channelOptions, currentId);
        }

        function initDmCombobox(currentId = '') {
            makeCombobox('f-dm-input', 'f-dm-dropdown', _dmOptions, currentId);
        }

        function setTargetType(type) {
            document.getElementById('f-target-type').value = type;
            const isChannel = type === 'channel';
            document.getElementById('target-channel-fields').classList.toggle('hidden', !isChannel);
            document.getElementById('target-dm-fields').classList.toggle('hidden', isChannel);
            document.getElementById('f-channel-input').required = isChannel;
            document.getElementById('f-dm-input').required = !isChannel;
            document.querySelectorAll('.ttype-btn').forEach(btn => {
                const active = btn.dataset.target === type;
                btn.classList.toggle('tab-indigo-on', active);
                btn.classList.toggle('tab-off', !active);
            });
        }

        document.querySelectorAll('.ttype-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setTargetType(btn.dataset.target);
                if (btn.dataset.target === 'channel') initChannelCombobox();
                else initDmCombobox();
            });
        });

        function getTargetId() {
            const type = document.getElementById('f-target-type').value;
            if (type === 'dm') {
                const inp = document.getElementById('f-dm-input');
                return inp.dataset.value || inp.value.trim();
            }
            const inp = document.getElementById('f-channel-input');
            return inp.dataset.value || inp.value.trim();
        }

        function isFutureLocalDatetime(value) {
            if (!value) return false;
            const dt = new Date(value);
            return !Number.isNaN(dt.getTime()) && dt.getTime() > Date.now();
        }

        function isValidTime(time) {
            return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
        }

        // --- Character cache ---
        let _charCache = {};
        async function ensureCharCache() {
            if (Object.keys(_charCache).length) return;
            try {
                const chars = await fetch('/api/characters').then(r => r.json());
                chars.forEach(c => { _charCache[c.name] = c; });
            } catch {}
        }

        // --- Fetch and render tasks ---
        let allTasks = [];
        const _sqp = new URLSearchParams(location.search);
        let PAGE_SIZE = parseInt(_sqp.get('limit')) || 25;
        let currentPage = parseInt(_sqp.get('page')) || 1;

        async function fetchTasks() {
            await ensureCharCache();
            const type = document.getElementById('filter-type').value;
            const statuses = [...document.querySelectorAll('.filter-status-cb:checked')].map(el => el.value);
            let url = API + '/?';
            if (type) url += `type=${encodeURIComponent(type)}&`;
            statuses.forEach(s => url += `status=${encodeURIComponent(s)}&`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    const errorData = await response.text();
                    console.error(`Failed to load tasks. Status: ${response.status}`, errorData);
                    showToast(`Failed to load tasks (${response.status}).`, 'error');
                    return;
                }
                allTasks = await response.json();
                renderTasks(allTasks);
            } catch (err) { 
                console.error('Error loading tasks:', err);
                showToast(`Failed to load tasks: ${err.message}`, 'error'); 
            }
        }

        function applyFilters(tasks) {
            const from = document.getElementById('filter-from').value;
            const to = document.getElementById('filter-to').value;
            const charFilter = (document.getElementById('filter-character').value || '').toLowerCase();
            return tasks.filter(t => {
                const dateStr = t.scheduled_time || t.created_at || '';
                const d = dateStr.substring(0, 10);
                if (from && d < from) return false;
                if (to && d > to) return false;
                if (charFilter && !t.character.toLowerCase().includes(charFilter)) return false;
                return true;
            });
        }

        function renderTasks(tasks) {
            const filtered = applyFilters(tasks);
            if (!filtered.length) {
                taskList.innerHTML = '<div class="text-gray-500 text-center py-12"><i class="fas fa-calendar-xmark text-3xl mb-3 block"></i>No tasks found.</div>';
                updatePagination(0);
                return;
            }
            const start = (currentPage - 1) * PAGE_SIZE;
            const pageItems = filtered.slice(start, start + PAGE_SIZE);
            taskList.innerHTML = pageItems.map(t => taskCard(t)).join('');
            taskList.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (btn.dataset.action !== 'detail') e.stopPropagation();
                    handleAction(btn.dataset.action, parseInt(btn.dataset.id));
                });
            });
            updatePagination(filtered.length);
        }

        function updatePagination(total) {
            const p = new URLSearchParams(location.search);
            p.set('page', currentPage);
            p.set('limit', PAGE_SIZE);
            history.replaceState(null, '', '?' + p.toString());
            const start = total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
            const end = Math.min(currentPage * PAGE_SIZE, total);
            document.getElementById('pagination-info').textContent = total ? `${start}–${end} of ${total}` : '';
            document.getElementById('prev-btn').disabled = currentPage <= 1;
            document.getElementById('next-btn').disabled = currentPage * PAGE_SIZE >= total;
        }

        function typeBadge(type) {
            return type === 'schedule'
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-900 text-indigo-300"><i class="fas fa-rotate mr-1"></i>Schedule</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-900 text-amber-300"><i class="fas fa-bell mr-1"></i>Reminder</span>';
        }

        function statusBadge(status) {
            const map = {
                active:    'bg-green-900 text-green-300',
                upcoming:  'bg-blue-900 text-blue-300',
                done:      'bg-gray-700 text-gray-400',
                disabled:  'bg-red-900 text-red-300',
                failed:    'bg-orange-900 text-orange-300',
            };
            return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || 'bg-gray-700 text-gray-400'}">${status}</span>`;
        }

        function modeBadge(mode) {
            const map = {
                exact:        'bg-gray-800 text-gray-300',
                instructions: 'bg-gray-800 text-gray-300',
                generate:     'bg-purple-900 text-purple-300',
            };
            const label = mode === 'instructions' ? 'Instructions' : mode === 'generate' ? 'Generate' : 'Exact';
            return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[mode] || 'bg-gray-800 text-gray-300'}">${label}</span>`;
        }

        function normalizeTaskName(name) {
            return String(name || '').replace(/—/g, '-');
        }

        function getTargetLabel(targetType, targetId) {
            if (targetType === 'channel') {
                const opt = _channelOptions.find(o => o.id === targetId);
                return opt ? opt.label : targetId;
            }
            return targetId;
        }

        function taskCard(t) {
            const when = t.scheduled_time
                ? new Date(t.scheduled_time).toLocaleString('sk-SK', { hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
                : repeatSummary(t.repeat_pattern);
            const targetLabel = getTargetLabel(t.target_type, t.target_id);
            const isDisabled = t.status === 'disabled';
            const toggleIcon = isDisabled ? 'fa-play' : 'fa-pause';
            const toggleLabel = isDisabled ? 'Enable' : 'Pause';
            const toggleColor = isDisabled ? 'text-green-400 hover:text-green-300' : 'text-yellow-400 hover:text-yellow-300';
            const char = _charCache[t.character] || {};
            const avatar = char.avatar;
            const avatarHtml = avatar
                ? `<img src="${esc(avatar)}" class="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="${esc(t.character)}">`
                : `<div class="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0"><i class="fas fa-robot text-gray-400 text-xs"></i></div>`;
            const titleHtml = t.type === 'schedule'
                ? `<div class="flex flex-wrap gap-3 mt-0.5"><span class="font-bold text-white text-sm">${esc(normalizeTaskName(t.name))}</span></div>`
                : '';
            return `
            <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer hover:border-gray-600 transition-colors" data-action="detail" data-id="${t.id}">
                ${avatarHtml}
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-3 mb-2">
                        <div class="flex flex-wrap items-center gap-2">
                            ${typeBadge(t.type)}
                            ${modeBadge(t.message_mode || 'exact')}
                            <span class="font-semibold text-white text-sm">${esc(t.character)}</span>
                        </div>
                        <div class="flex-shrink-0">
                            ${statusBadge(t.status)}
                        </div>
                    </div>
                    ${titleHtml}
                    <div class="text-xs text-gray-400 flex flex-wrap gap-3 mt-1">
                        <span><i class="fas fa-${t.target_type === 'dm' ? 'user' : 'hashtag'} mr-1"></i>${esc(targetLabel)}</span>
                        ${when ? `<span><i class="fas fa-clock mr-1"></i>${esc(when)}</span>` : ''}
                        ${t.next_run ? `<span class="text-indigo-400"><i class="fas fa-forward mr-1"></i>${esc(formatNextRun(t.next_run))}</span>` : ''}
                    </div>
                    ${t.instructions ? `<p class="text-xs text-gray-500 mt-1 truncate">${esc(t.instructions)}</p>` : ''}
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                    <button class="${toggleColor} text-sm" data-action="toggle" data-id="${t.id}" title="${toggleLabel}">
                        <i class="fas ${toggleIcon}"></i>
                    </button>
                    <button class="text-gray-400 hover:text-gray-200 text-sm" data-action="duplicate" data-id="${t.id}" title="Duplicate">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="text-indigo-400 hover:text-indigo-300 text-sm" data-action="edit" data-id="${t.id}" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="text-red-400 hover:text-red-300 text-sm" data-action="delete" data-id="${t.id}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }

        function repeatSummary(pattern) {
            if (!pattern) return '';
            const ptype = pattern.type || 'weekly';
            const time = pattern.time || '?';
            const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            if (ptype === 'daily') return `Every day at ${time}`;
            if (ptype === 'weekly') {
                const days = (pattern.days || []).map(d => DAYS[d]).join(', ');
                return `${days} at ${time}`;
            }
            if (ptype === 'monthly') return `Day ${pattern.day} of every month at ${time}`;
            if (ptype === 'yearly') return `${MONTHS[(pattern.month||1)-1]} ${pattern.day} every year at ${time}`;
            return '';
        }

        function formatNextRun(isoStr) {
            if (!isoStr) return '';
            const d = new Date(isoStr);
            return d.toLocaleString('en-GB', { hour12: false, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }

        // --- Detail Modal ---
        const detailModal = document.getElementById('detail-modal');
        document.getElementById('detail-close').addEventListener('click', () => detailModal.classList.add('hidden'));
        detailModal.addEventListener('click', (e) => { if (e.target === detailModal) detailModal.classList.add('hidden'); });

        function openDetail(task) {
            const char = _charCache[task.character] || {};
            const avatar = char.avatar;
            document.getElementById('detail-avatar').innerHTML = avatar
                ? `<img src="${esc(avatar)}" class="w-11 h-11 rounded-full object-cover">`
                : `<div class="w-11 h-11 rounded-full bg-gray-700 flex items-center justify-center"><i class="fas fa-robot text-gray-400"></i></div>`;
            document.getElementById('detail-badges').innerHTML = typeBadge(task.type) + ' ' + modeBadge(task.message_mode || 'exact');
            document.getElementById('detail-name').textContent = task.type === 'reminder' ? task.character : normalizeTaskName(task.name);
            document.getElementById('detail-character').textContent = task.character;
            document.getElementById('detail-target').textContent = getTargetLabel(task.target_type, task.target_id);
            const httpCode = task.error_message ? (task.error_message.match(/\b([1-5]\d{2})\b/) || [])[1] : null;
            document.getElementById('detail-status').innerHTML = (httpCode ? `<span class="text-xs text-orange-300">${httpCode}</span>` : '')
                + statusBadge(task.status);

            const timeRow = document.getElementById('detail-time-row');
            const repeatRow = document.getElementById('detail-repeat-row');
            if (task.scheduled_time) {
                document.getElementById('detail-time').textContent = new Date(task.scheduled_time).toLocaleString('sk-SK', { hour12: false });
                timeRow.classList.remove('hidden'); repeatRow.classList.add('hidden');
            } else if (task.repeat_pattern) {
                document.getElementById('detail-repeat').textContent = repeatSummary(task.repeat_pattern);
                repeatRow.classList.remove('hidden'); timeRow.classList.add('hidden');
            } else {
                timeRow.classList.add('hidden'); repeatRow.classList.add('hidden');
            }

            const nextRunRow = document.getElementById('detail-next-run-row');
            if (task.next_run) {
                document.getElementById('detail-next-run').textContent = formatNextRun(task.next_run);
                nextRunRow.classList.remove('hidden');
            } else {
                nextRunRow.classList.add('hidden');
            }

            const instrRow = document.getElementById('detail-instructions-row');
            if (task.instructions) {
                document.getElementById('detail-instructions').textContent = task.instructions;
                instrRow.classList.remove('hidden');
            } else { instrRow.classList.add('hidden'); }

            const toggleBtn = document.getElementById('detail-toggle');
            const isDisabled = task.status === 'disabled';
            toggleBtn.textContent = isDisabled ? 'Enable' : 'Disable';
            toggleBtn.onclick = () => { detailModal.classList.add('hidden'); handleAction('toggle', task.id); };
            document.getElementById('detail-edit').onclick = () => { detailModal.classList.add('hidden'); openModal(task); };
            document.getElementById('detail-delete').onclick = () => { detailModal.classList.add('hidden'); handleAction('delete', task.id); };
            document.getElementById('detail-logs').onclick = () => {
                window.location.href = `/logs?tab=discord&task_id=${task.id}&character=${encodeURIComponent(task.character)}&source=scheduler`;
            };

            detailModal.classList.remove('hidden');
        }

        // --- Actions ---
        async function handleAction(action, id) {
            if (action === 'delete') {
                if (!confirm('Delete this task?')) return;
                await fetch(`${API}/${id}`, { method: 'DELETE' });
                showToast('Task deleted.');
                fetchTasks();
            } else if (action === 'toggle') {
                const task = allTasks.find(t => t.id === id);
                if (!task) return;
                const newStatus = task.status === 'disabled'
                    ? (task.type === 'schedule' ? 'active' : 'upcoming')
                    : 'disabled';
                await fetch(`${API}/${id}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ status: newStatus })
                });
                showToast(`Task ${newStatus}.`);
                fetchTasks();
            } else if (action === 'duplicate') {
                const task = allTasks.find(t => t.id === id);
                if (!task) return;
                const body = {
                    type: task.type,
                    name: task.name + ' (copy)',
                    character: task.character,
                    target_type: task.target_type,
                    target_id: task.target_id,
                    instructions: task.instructions || null,
                    scheduled_time: (() => {
                        if (task.type !== 'reminder') return task.scheduled_time || null;
                        const t = new Date(); t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1);
                        const pad = n => String(n).padStart(2, '0');
                        return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
                    })(),
                    repeat_pattern: task.repeat_pattern || null,
                    message_mode: task.message_mode || 'exact',
                    history_limit: task.history_limit ?? null,
                    status: 'disabled',
                };
                const resp = await fetch(`${API}/`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
                if (resp.ok) { showToast('Task duplicated.'); fetchTasks(); }
                else showToast('Failed to duplicate.', 'error');
            } else if (action === 'detail') {
                const task = allTasks.find(t => t.id === id);
                if (task) openDetail(task);
            } else if (action === 'edit') {
                const task = allTasks.find(t => t.id === id);
                if (task) openModal(task);
            }
        }

        // --- Modal ---
        async function openModal(task = null) {
            await loadTargetOptions();
            form.reset();
            statusField.classList.add('hidden');
            taskIdInput.value = '';
            setSelectedDays([]);

            if (task) {
                modalTitle.textContent = 'Edit Task';
                taskIdInput.value = task.id;
                setType(task.type || 'reminder');
                setMessageMode(task.message_mode || 'exact');
                document.getElementById('f-name').value = task.name || '';
                document.getElementById('f-character').value = task.character || '';
                const targetType = task.target_type || 'channel';
                setTargetType(targetType);
                if (targetType === 'channel') initChannelCombobox(task.target_id || '');
                else initDmCombobox(task.target_id || '');
                document.getElementById('f-instructions').value = task.instructions || '';
                if (task.scheduled_time) {
                    // Use stored string directly — it's already in Slovak time, no conversion needed
                    document.getElementById('f-scheduled-time').value = task.scheduled_time.slice(0, 16);
                }
                if (task.repeat_pattern) {
                    const rp = task.repeat_pattern;
                    const rtype = rp.type || 'weekly';
                    document.getElementById('f-repeat-type').value = rtype;
                    document.getElementById('f-repeat-time').value = rp.time || '';
                    updateRepeatFields(rtype);
                    if (rtype === 'weekly') setSelectedDays(rp.days || []);
                    if (rtype === 'monthly') document.getElementById('f-repeat-month-day').value = rp.day || 1;
                    if (rtype === 'yearly') {
                        document.getElementById('f-repeat-year-month').value = rp.month || 1;
                        document.getElementById('f-repeat-year-day').value = rp.day || 1;
                    }
                }
                if (task.history_limit != null) {
                    setHistoryToggle(true);
                    document.getElementById('f-history-limit').value = task.history_limit;
                } else {
                    setHistoryToggle(false);
                }
                setStatusOptions(task.type, task.status || 'active');
                document.getElementById('f-status').value = task.status || 'active';
                // Status only editable for schedules (active/disabled) — reminders are auto-managed
                if (task.type === 'schedule') {
                    statusField.classList.remove('hidden');
                } else {
                    statusField.classList.add('hidden');
                }
            } else {
                modalTitle.textContent = 'New Task';
                setType('reminder');
                setMessageMode('exact');
                setTargetType('channel');
                initChannelCombobox();
                const now = new Date();
                now.setSeconds(0, 0);
                now.setMinutes(now.getMinutes() + 1);
                const pad = n => String(n).padStart(2, '0');
                const localDT = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                document.getElementById('f-scheduled-time').value = localDT;
            }
            modal.classList.remove('hidden');
        }

        function closeModal() { modal.classList.add('hidden'); }

        document.getElementById('create-btn').addEventListener('click', () => openModal());
        document.getElementById('modal-close').addEventListener('click', closeModal);
        document.getElementById('modal-cancel').addEventListener('click', closeModal);

        // --- Form Submit ---
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = taskIdInput.value;
            const type = document.getElementById('selected-type').value;
            const character = document.getElementById('f-character').value;
            const target_type = document.getElementById('f-target-type').value;
            const target_id = getTargetId();
            const instructions = document.getElementById('f-instructions').value.trim();
            const st = document.getElementById('f-scheduled-time').value;
            const name = type === 'reminder'
                ? `${character} - ${st ? st.slice(0, 16).replace('T', ' ') : 'reminder'}`
                : document.getElementById('f-name').value.trim();

            if (!character || !target_id || (type === 'schedule' && !name)) {
                showToast('Character and target are required.', 'error');
                return;
            }
            if (type === 'schedule' && name.length < 3) {
                showToast('Task name must be at least 3 characters.', 'error');
                return;
            }

            const message_mode = document.getElementById('f-message-mode').value;
            const historyOn = document.getElementById('history-toggle').getAttribute('aria-pressed') === 'true';
            const historyLimitVal = document.getElementById('f-history-limit').value;
            const history_limit = historyOn && historyLimitVal !== '' ? parseInt(historyLimitVal) : null;
            const body = { type, name, character, target_type, target_id, instructions: instructions || null, message_mode, history_limit };

            if (type === 'reminder') {
                const st = document.getElementById('f-scheduled-time').value;
                if (!st) { showToast('Please set a scheduled time.', 'error'); return; }
                if (!isFutureLocalDatetime(st)) { showToast('Reminder time must be in the future.', 'error'); return; }
                body.scheduled_time = st + ':00';
                // Reset to upcoming if editing a done/disabled reminder with a new time
                if (id) body.status = 'upcoming';
            } else {
                const rtype = document.getElementById('f-repeat-type').value;
                const time = document.getElementById('f-repeat-time').value;
                if (!time || !isValidTime(time)) { showToast('Time is required in HH:MM format.', 'error'); return; }
                if (rtype === 'daily') {
                    body.repeat_pattern = { type: 'daily', time };
                } else if (rtype === 'weekly') {
                    const days = getSelectedDays();
                    if (!days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
                        showToast('Weekly days must be in range 0-6.', 'error');
                        return;
                    }
                    if (!days.length) { showToast('Select at least one day.', 'error'); return; }
                    body.repeat_pattern = { type: 'weekly', days, time };
                } else if (rtype === 'monthly') {
                    const day = parseInt(document.getElementById('f-repeat-month-day').value);
                    if (!Number.isInteger(day) || day < 1 || day > 31) {
                        showToast('Monthly day must be between 1 and 31.', 'error');
                        return;
                    }
                    body.repeat_pattern = { type: 'monthly', day, time };
                } else if (rtype === 'yearly') {
                    const month = parseInt(document.getElementById('f-repeat-year-month').value);
                    const day = parseInt(document.getElementById('f-repeat-year-day').value);
                    if (!Number.isInteger(month) || month < 1 || month > 12) {
                        showToast('Yearly month must be between 1 and 12.', 'error');
                        return;
                    }
                    if (!Number.isInteger(day) || day < 1 || day > 31) {
                        showToast('Yearly day must be between 1 and 31.', 'error');
                        return;
                    }
                    body.repeat_pattern = { type: 'yearly', month, day, time };
                }
            }

            if (id && type === 'schedule') {
                body.status = document.getElementById('f-status').value;
            }

            try {
                const method = id ? 'PUT' : 'POST';
                const url = id ? `${API}/${id}` : `${API}/`;
                const resp = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
                if (!resp.ok) { const err = await resp.json(); throw new Error(err.detail || 'Failed'); }
                showToast(id ? 'Task updated.' : 'Task created.');
                closeModal();
                fetchTasks();
            } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
        });

        // --- Status checkbox dropdown ---
        function updateStatusDdLabel() {
            const checked = [...document.querySelectorAll('.filter-status-cb:checked')].map(el => el.value);
            document.getElementById('filter-status-label').textContent = checked.length === 0 ? 'All' : checked.length === 1 ? checked[0] : checked.length + ' selected';
        }
        const statusBtn = document.getElementById('filter-status-btn');
        const statusDd = document.getElementById('filter-status-dd');
        statusBtn.addEventListener('click', () => statusDd.classList.toggle('hidden'));
        document.addEventListener('click', e => {
            if (!statusBtn.contains(e.target) && !statusDd.contains(e.target))
                statusDd.classList.add('hidden');
        });
        document.querySelectorAll('.filter-status-cb').forEach(cb => {
            cb.addEventListener('change', () => { updateStatusDdLabel(); currentPage = 1; fetchTasks(); });
        });

        function updateStatusOptions() {
            const selectedType = document.getElementById('filter-type').value;
            const show = {
                active:   !selectedType || selectedType === 'schedule',
                upcoming: !selectedType || selectedType === 'reminder',
                done:     !selectedType || selectedType === 'reminder',
                disabled: true,
            };
            ['active','upcoming','done','disabled'].forEach(v => {
                const row = document.getElementById(`fs-${v}-row`);
                row.classList.toggle('hidden', !show[v]);
                if (!show[v]) row.querySelector('input').checked = false;
            });
            updateStatusDdLabel();
        }

        // --- Pagination controls ---
        document.getElementById('prev-btn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTasks(allTasks); } });
        document.getElementById('next-btn').addEventListener('click', () => { currentPage++; renderTasks(allTasks); });
        document.getElementById('page-size-select').addEventListener('change', function() { PAGE_SIZE = parseInt(this.value); currentPage = 1; renderTasks(allTasks); });
        document.getElementById('page-size-select').value = PAGE_SIZE;

        // --- Filters ---
        document.getElementById('filter-type').addEventListener('change', () => {
            updateStatusOptions();
            currentPage = 1;
            fetchTasks();
        });
        ['filter-from','filter-to'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => { currentPage = 1; fetchTasks(); });
        });
        document.getElementById('clear-filter-btn').addEventListener('click', () => {
            document.getElementById('filter-type').value = '';
            document.getElementById('filter-status').value = '';
            document.getElementById('filter-from').value = '';
            document.getElementById('filter-to').value = '';
            currentPage = 1;
            fetchTasks();
        });
        document.getElementById('clear-from-btn').addEventListener('click', () => {
            document.getElementById('filter-from').value = '';
            currentPage = 1;
            fetchTasks();
        });
        document.getElementById('clear-to-btn').addEventListener('click', () => {
            document.getElementById('filter-to').value = '';
            currentPage = 1;
            fetchTasks();
        });

        // --- Toast ---
        // Init
        loadCharacters();
        loadTargetOptions().then(async () => {
            await fetchTasks();
            const openId = new URLSearchParams(location.search).get('open');
            if (openId) {
                try {
                    const res = await fetch(`${API}/${openId}`);
                    if (res.ok) openDetail(await res.json());
                } catch {}
            }
        });
    })();