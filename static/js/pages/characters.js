document.addEventListener('DOMContentLoaded', function() {
    const API_BASE = '/api/characters';
    let currentUserRole = 'guest';
    let currentUsername = '';
    let currentUserServerIds = [];
    let currentCharacterName = null;
    let currentCharacterId = null;
    let currentCharCreatedBy = null;

    // --- DOM Elements ---
    const characterGrid = document.getElementById('character-grid');
    const modal = document.getElementById('character-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const importFileInput = document.getElementById('import-file-input');
    const form = document.getElementById('character-form');
    const formTitle = document.getElementById('form-title');
    const nameInput = document.getElementById('name');
    const personaInput = document.getElementById('persona');
    const instructionsInput = document.getElementById('instructions');
    const avatarUrlInput = document.getElementById('avatar-url');
    const avatarUploadInput = document.getElementById('avatar-upload');
    const avatarPreview = document.getElementById('avatar-preview');
    const avatarPreviewLoader = document.getElementById('avatar-preview-loader');
    const infoInput = document.getElementById('about');
    const temperatureInput = document.getElementById('temperature');
    const charHistoryLimitInput = document.getElementById('char-history-limit');
    const charMaxTokensInput = document.getElementById('char-max-tokens');
    const triggersInput = document.getElementById('triggers');
    const saveBtn = document.getElementById('save-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const exportBtn = document.getElementById('export-btn');
    const toastContainer = document.getElementById('toast-container');
    const newCharBtn = document.getElementById('new-char-btn');
    const importCardBtn = document.getElementById('import-card-btn');

    function canCreateCharacter() {
        return currentUserRole === 'mod' || currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    function canEditCurrentCharacter() {
        if (currentUserRole === 'admin' || currentUserRole === 'super_admin') return true;
        if (currentUserRole === 'mod') {
            if (currentCharCreatedBy === currentUsername) return true;
            // Allow if character is whitelisted exclusively on mod's servers
            if (!currentCharacterName || !currentUserServerIds.length) return false;
            let onOwnServer = false;
            for (const [sid, names] of Object.entries(serverWhitelists)) {
                if (names.has(currentCharacterName)) {
                    if (currentUserServerIds.includes(sid)) onOwnServer = true;
                    else return false; // also on a server the mod doesn't own
                }
            }
            return onOwnServer;
        }
        return false;
    }
    // --- Modal Management ---
    const openModal = () => modal.classList.remove('opacity-0', 'pointer-events-none');
    const closeModal = () => modal.classList.add('opacity-0', 'pointer-events-none');

    // --- Filters ---
    const serverFilterInput = document.getElementById('server-filter');
    const filterNameInput = document.getElementById('filter-name');
    let allCharacters = [];
    let characterNameOptions = [];
    let serverWhitelists = {}; // server_id -> Set of character names
    let serverNameMap = {};    // display name -> server_id
    let availableServers = []; // {server_id, server_name}[] for model rules
    let modelRuleCounter = 0;
    let _mrSrvMeasureRoot = null;
    let serversReadyPromise = Promise.resolve();
    let allowedModels = [];
    let allowedModelsPromise = Promise.resolve();

    async function loadAllowedModels() {
        try {
            const res = await fetch('/api/config/models');
            if (res.ok) allowedModels = normalizeAllowedModels(await res.json());
        } catch (_) {}
    }

    function allowedModelDisplays() {
        return allowedModels.map(m => m.display);
    }

    function wireServerFilterCombobox() {
        if (typeof setupFilterCombobox !== 'function') return;
        setupFilterCombobox(
            'server-filter', 'server-filter-dd',
            () => Object.keys(serverNameMap).sort((a, b) => a.localeCompare(b)),
            applyFilter, applyFilter,
            'hover:bg-gray-700'
        );
    }

    function wireCharacterFilterCombobox() {
        if (typeof setupFilterCombobox !== 'function') return;
        setupFilterCombobox(
            'filter-name', 'filter-name-dd',
            () => characterNameOptions,
            applyFilter, applyFilter,
            'hover:bg-gray-700'
        );
    }

    async function loadServerFilter() {
        try {
            const res = await fetch('/api/servers/');
            if (!res.ok) return;
            const servers = await res.json();
            const filtered = servers.filter(s => !s.server_name.toLowerCase().includes('direct message'));
            filtered.forEach(s => { serverNameMap[s.server_name] = s.server_id; });
            try {
                const wlRes = await fetch('/api/servers/bulk/whitelists');
                if (wlRes.ok) {
                    const whitelists = await wlRes.json();
                    for (const s of filtered) {
                        serverWhitelists[s.server_id] = new Set(whitelists[s.server_id] || []);
                    }
                }
            } catch (_) {}
            availableServers = filtered.map(s => ({ server_id: s.server_id, server_name: s.server_name }));
            wireServerFilterCombobox();
            syncModelRuleWidths();
        } catch (e) {
            showToast('Failed to load server filter.', 'error');
        }
    }


    function applyFilter() {
        const search = filterNameInput.value.trim().toLowerCase();
        const serverName = serverFilterInput.value.trim();
        const selectedId = serverNameMap[serverName];
        const cards = characterGrid.querySelectorAll('[data-char-name]');
        cards.forEach(card => {
            const nameMatch = !search || card.dataset.charName.toLowerCase().includes(search);
            const serverMatch = !selectedId || (serverWhitelists[selectedId] || new Set()).has(card.dataset.charName);
            card.style.display = nameMatch && serverMatch ? '' : 'none';
        });
    }

    serverFilterInput.addEventListener('input', applyFilter);
    filterNameInput.addEventListener('input', applyFilter);
    if (typeof initFilterClear === 'function') initFilterClear(() => applyFilter(), document.getElementById('characters-filters'));

    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        filterNameInput.value = '';
        if ('dataset' in filterNameInput) filterNameInput.dataset.comboboxClearTouched = '';
        filterNameInput.dispatchEvent(new Event('input', { bubbles: true }));
        serverFilterInput.value = '';
        if ('dataset' in serverFilterInput) serverFilterInput.dataset.comboboxClearTouched = '';
        serverFilterInput.dispatchEvent(new Event('input', { bubbles: true }));
        applyFilter();
    });

    // --- Model Rules ---
    function isMod() { return currentUserRole === 'mod'; }
    function isAdmin() { return currentUserRole === 'admin' || currentUserRole === 'super_admin'; }
    function allServersLabel() { return isAdmin() ? 'All servers' : 'All my servers'; }

    function buildServerCheckboxes(selectedIds = []) {
        const servers = modelRulePickerServers();
        if (!servers.length) return '<p class="text-dim text-xs px-3 py-2">No servers loaded</p>';
        return servers.map(s => `
            <label class="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-sm">
                <input type="checkbox" class="custom-cb" value="${escapeHtml(s.server_id)}" ${selectedIds.includes(s.server_id) ? 'checked' : ''}>
                <span class="text-gray-200 whitespace-nowrap">${escapeHtml(s.server_name)}</span>
            </label>`).join('');
    }

    function getUsedServerIds(excludeDd) {
        return new Set(
            [...document.querySelectorAll('.model-rule')]
                .flatMap(rule => {
                    const ruleDd = rule.querySelector('[id^="mr-dd-"]');
                    if (!ruleDd || ruleDd === excludeDd) return [];
                    return [...ruleDd.querySelectorAll('input:checked')].map(cb => cb.value);
                })
        );
    }

    function refreshDropdownOptions(dd) {
        const used = getUsedServerIds(dd);
        dd.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const label = cb.closest('label');
            const disable = used.has(cb.value);
            cb.disabled = disable;
            if (label) {
                label.style.opacity = disable ? '0.4' : '';
                label.style.cursor = disable ? 'not-allowed' : '';
            }
        });
    }

    function modelRulePickerServers() {
        return isMod()
            ? availableServers.filter(s => currentUserServerIds.includes(s.server_id))
            : availableServers;
    }

    function modelRuleServerLabelTexts() {
        const servers = modelRulePickerServers();
        const texts = new Set([allServersLabel(), 'None', ...servers.map(s => s.server_name)]);
        for (let n = 2; n <= servers.length; n++) texts.add(`${n} servers`);
        return [...texts];
    }

    function measureModelRuleServerColumnWidth() {
        const texts = modelRuleServerLabelTexts();
        if (!texts.length) return 0;

        if (!_mrSrvMeasureRoot) {
            _mrSrvMeasureRoot = document.createElement('div');
            _mrSrvMeasureRoot.setAttribute('aria-hidden', 'true');
            _mrSrvMeasureRoot.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;z-index:-1';
            document.body.appendChild(_mrSrvMeasureRoot);
        }

        let maxRow = 0;
        for (const text of texts) {
            _mrSrvMeasureRoot.innerHTML = `
                <label class="flex items-center gap-2 px-3 py-1.5 rounded text-sm">
                    <input type="checkbox" class="custom-cb" disabled tabindex="-1">
                    <span class="text-gray-200 whitespace-nowrap">${escapeHtml(text)}</span>
                </label>`;
            maxRow = Math.max(maxRow, _mrSrvMeasureRoot.firstElementChild.offsetWidth);
        }

        let maxBtn = 0;
        for (const text of texts) {
            _mrSrvMeasureRoot.innerHTML = `
                <button type="button" class="mr-srv-btn" style="width:max-content">
                    <span class="mr-srv-label shrink-0 text-gray-300 text-left whitespace-nowrap">${escapeHtml(text)}</span>
                    <i class="fas fa-chevron-down text-xs text-gray-500 shrink-0" aria-hidden="true"></i>
                </button>`;
            maxBtn = Math.max(maxBtn, _mrSrvMeasureRoot.firstElementChild.offsetWidth);
        }

        return Math.max(maxRow, maxBtn);
    }

    function syncModelRuleWidths() {
        requestAnimationFrame(() => {
            if (document.getElementById('model-rules-body')?.classList.contains('hidden')) return;
            const w = measureModelRuleServerColumnWidth();
            if (w <= 0) return;
            document.querySelectorAll('#model-rules-list .mr-srv-wrap').forEach(wrap => {
                wrap.style.width = `${w}px`;
            });
        });
    }

    function addModelRule(rule = { servers: [], model: '', source: 'primary', triggers: [], temperature: null, max_tokens: null, history_limit: null, auto_cap: null }) {
        const id = modelRuleCounter++;
        const ddId = `mr-dd-${id}`;
        const allRuleServers = rule.servers || [];
        const existingEntry = allowedModels.find(m => m.model === rule.model && m.source === (rule.source || 'primary'));
        const displayValue = existingEntry
            ? existingEntry.display
            : formatModelDisplay(rule.model, rule.source);
        const triggersValue = Array.isArray(rule.triggers) ? rule.triggers.join(', ') : (rule.triggers || '');
        const div = document.createElement('div');
        div.className = 'model-rule';
        div.innerHTML = `
            <div class="flex items-end gap-2">
                <div class="mr-srv-wrap relative shrink-0">
                    <label for="mr-srv-btn-${id}" class="label-xs block mb-1">Server <span aria-hidden="true">*</span></label>
                    <button type="button" id="mr-srv-btn-${id}" class="mr-srv-btn w-full flex items-center justify-between gap-1.5 text-sm" data-dd="${ddId}">
                        <span class="mr-srv-label shrink-0 text-gray-300 text-left whitespace-nowrap">${escapeHtml(allServersLabel())}</span>
                        <i class="fas fa-chevron-down text-xs text-gray-500 shrink-0"></i>
                    </button>
                    <div id="${ddId}" class="mr-srv-dd hidden absolute z-50 left-0 top-full mt-1 min-w-full w-max max-h-48 overflow-y-auto">
                        <div class="p-1 whitespace-nowrap">${buildServerCheckboxes(rule.servers || [])}</div>
                    </div>
                </div>
                <div class="relative flex-1 min-w-0">
                    <label for="mr-model-input-${id}" class="label-xs block mb-1">Model name (source) <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body" style="left:0;transform:none;">Leave empty to inherit the server or global default model.</span></span></label>
                    <div class="relative">
                        <input type="text" id="mr-model-input-${id}" class="input-field w-full mr-model-display text-sm pr-8" autocomplete="off" placeholder="e.g. gpt-4o (default)" value="${escapeHtml(displayValue)}">
                        <input type="hidden" class="mr-model" value="${escapeHtml(rule.model || '')}">
                        <input type="hidden" class="mr-source" value="${escapeHtml(rule.source || 'primary')}">
                        <div id="mr-model-dd-${id}" class="autocomplete-dd hidden"></div>
                    </div>
                </div>
                <button type="button" class="model-rule-remove-btn mr-remove shrink-0" title="Remove rule" aria-label="Remove rule"><i class="fas fa-trash"></i></button>
            </div>
            <div class="flex gap-2 mt-3">
                <div class="flex-1">
                    <label for="mr-triggers-${id}" class="label-xs">Triggers <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body" style="left:0;transform:none;">Comma-separated words that trigger this character on the selected servers. Leave empty to use the character's default triggers.</span></span></label>
                    <input type="text" id="mr-triggers-${id}" class="mr-triggers input-field text-sm" placeholder="word1, word2" value="${escapeHtml(triggersValue)}">
                </div>
                <div class="shrink-0 w-36">
                    <label for="mr-auto-cap-${id}" class="label-xs">Auto Cap <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body">Max bot-to-bot chain length for this character on these servers. Leave empty to use the global or server cap.</span></span></label>
                    <input type="number" id="mr-auto-cap-${id}" class="mr-auto-cap input-field text-sm" min="0" placeholder="e.g. 2" value="${rule.auto_cap != null ? rule.auto_cap : ''}">
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2 mt-3">
                <div>
                    <label for="mr-temperature-${id}" class="label-xs">Temperature <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body">Response randomness for this rule. 0 = predictable, 2 = chaotic. Leave empty to inherit.</span></span></label>
                    <input type="number" id="mr-temperature-${id}" class="mr-temperature input-field text-sm" min="0" max="2" step="0.1" placeholder="e.g. 0.7" value="${rule.temperature != null ? rule.temperature : ''}">
                </div>
                <div>
                    <label for="mr-max-tokens-${id}" class="label-xs">Max Tokens <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body">Maximum response length for this rule. Leave empty to inherit.</span></span></label>
                    <input type="number" id="mr-max-tokens-${id}" class="mr-max-tokens input-field text-sm" min="64" max="4096" placeholder="e.g. 256" value="${rule.max_tokens != null ? rule.max_tokens : ''}">
                </div>
                <div>
                    <label for="mr-history-limit-${id}" class="label-xs">Message History <span class="tt"><i class="fas fa-circle-info icon-info-indigo"></i><span class="tt-body">How many past messages the AI sees as context for this rule. Leave empty to inherit.</span></span></label>
                    <input type="number" id="mr-history-limit-${id}" class="mr-history-limit input-field text-sm" min="1" max="50" placeholder="e.g. 10" value="${rule.history_limit != null ? rule.history_limit : ''}">
                </div>
            </div>`;

        const btn = div.querySelector('.mr-srv-btn');
        const dd = div.querySelector(`#${ddId}`);

        const updateLabel = () => {
            const visibleTotal = dd.querySelectorAll('input[type="checkbox"]').length;
            const checkedIds = [...dd.querySelectorAll('input:checked')].map(cb => cb.value);
            const hiddenCount = allRuleServers.filter(sid => !dd.querySelector(`input[value="${sid}"]`)).length;
            const totalSelected = checkedIds.length + hiddenCount;
            const totalAll = visibleTotal + hiddenCount;
            const checkedNames = checkedIds.map(sid => {
                const s = availableServers.find(x => x.server_id === sid);
                return s ? s.server_name : sid;
            });
            let label;
            if (totalSelected === 0) {
                label = 'None';
            } else if (hiddenCount === 0 && checkedIds.length > 0 && checkedIds.length === visibleTotal) {
                label = allServersLabel();
            } else if (totalSelected === 1) {
                label = checkedNames[0] || 'Unknown server';
            } else {
                label = `${totalSelected} servers`;
            }
            btn.querySelector('.mr-srv-label').textContent = label;
            syncModelRuleWidths();
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasHidden = dd.classList.contains('hidden');
            document.querySelectorAll('[id^="mr-dd-"]').forEach(d => d.classList.add('hidden'));
            if (wasHidden) {
                refreshDropdownOptions(dd);
                dd.classList.remove('hidden');
            }
        });
        dd.addEventListener('change', updateLabel);
        updateLabel();
        div.querySelector('.mr-remove').addEventListener('click', () => {
            document.querySelectorAll('[id^="mr-dd-"]').forEach(d => d.classList.add('hidden'));
            div.remove();
        });
        document.getElementById('model-rules-list').appendChild(div);
        setupFilterCombobox(`mr-model-input-${id}`, `mr-model-dd-${id}`, allowedModelDisplays, (selected) => {
            const entry = allowedModels.find(m => m.display === selected);
            if (entry) {
                const displayInput = div.querySelector('.mr-model-display');
                if (displayInput) displayInput.value = entry.display;
                div.querySelector('.mr-model').value = entry.model;
                div.querySelector('.mr-source').value = entry.source;
            }
        }, (value) => {
            if (!value.trim()) {
                div.querySelector('.mr-model').value = '';
                div.querySelector('.mr-source').value = 'primary';
            }
        }, 'hover:bg-gray-700');
        syncModelRuleWidths();
    }

    function resolveRuleModel(div) {
        const display = (div.querySelector('.mr-model-display')?.value || '').trim();
        let model = (div.querySelector('.mr-model')?.value || '').trim();
        let source = (div.querySelector('.mr-source')?.value || '').trim() || 'primary';
        if (!model && display) {
            const entry = allowedModels.find(m => m.display === display);
            if (entry) {
                model = entry.model;
                source = entry.source;
                div.querySelector('.mr-model').value = model;
                div.querySelector('.mr-source').value = source;
            }
        }
        return model ? { model, source } : null;
    }

    function ruleElementHasOverride(div) {
        if (resolveRuleModel(div)) return true;
        const triggers = (div.querySelector('.mr-triggers')?.value || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (triggers.length) return true;
        if (div.querySelector('.mr-temperature')?.value !== '') return true;
        if (div.querySelector('.mr-max-tokens')?.value !== '') return true;
        if (div.querySelector('.mr-history-limit')?.value !== '') return true;
        if (div.querySelector('.mr-auto-cap')?.value !== '') return true;
        return false;
    }

    function validateModelRules() {
        if (isMod()) return null;
        const enabled = document.getElementById('model-rules-enabled').checked;
        if (!enabled) return null;

        const ruleEls = [...document.querySelectorAll('#model-rules-list .model-rule')];
        if (ruleEls.length === 0) {
            return 'Per-server override is on - add at least one rule or turn it off.';
        }

        for (const div of ruleEls) {
            const servers = [...div.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
            if (servers.length === 0) {
                return 'Select at least one server.';
            }
            if (!ruleElementHasOverride(div)) {
                return 'Set at least one override (model, triggers, temperature, etc.) for each rule.';
            }
        }
        return null;
    }

    function getModelRules() {
        return [...document.querySelectorAll('.model-rule')].map(div => {
            const resolved = resolveRuleModel(div);
            const model = resolved?.model || '';
            const source = resolved?.source || 'primary';
            const triggers = (div.querySelector('.mr-triggers').value || '').split(',').map(s => s.trim()).filter(Boolean);
            const tempVal = div.querySelector('.mr-temperature').value;
            const tokVal = div.querySelector('.mr-max-tokens').value;
            const histVal = div.querySelector('.mr-history-limit').value;
            const capVal = div.querySelector('.mr-auto-cap').value;
            const temperature = tempVal !== '' ? parseFloat(tempVal) : null;
            const max_tokens = tokVal !== '' ? parseInt(tokVal) : null;
            const history_limit = histVal !== '' ? parseInt(histVal) : null;
            const auto_cap = capVal !== '' ? parseInt(capVal) : null;
            return {
                servers: [...div.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value),
                model, source, triggers, temperature, max_tokens, history_limit, auto_cap,
            };
        }).filter(r => {
            if (!r.servers.length) return false;
            return Boolean(
                r.model
                || (r.triggers && r.triggers.length)
                || r.temperature != null
                || r.max_tokens != null
                || r.history_limit != null
                || r.auto_cap != null
            );
        });
    }

    function updateModelRulesHint() {
        const hint = document.getElementById('model-rules-toggle-hint');
        if (!hint) return;
        const enabled = document.getElementById('model-rules-enabled').checked;
        if (enabled) {
            hint.textContent = 'toggle off = server/global default';
            hint.classList.remove('text-indigo-400');
            return;
        }
        const count = document.querySelectorAll('#model-rules-list .model-rule').length;
        if (count > 0) {
            hint.textContent = `toggle off = server/global default · ${count} rule${count === 1 ? '' : 's'} saved (inactive)`;
            hint.classList.add('text-indigo-400');
        } else {
            hint.textContent = 'toggle off = server/global default';
            hint.classList.remove('text-indigo-400');
        }
    }

    function loadModelRules(enabled, rules) {
        document.getElementById('model-rules-enabled').checked = enabled;
        document.getElementById('model-rules-body').classList.toggle('hidden', !enabled);
        document.getElementById('model-rules-list').innerHTML = '';
        modelRuleCounter = 0;
        const list = rules || [];
        list.forEach(r => addModelRule(r));
        if (enabled && list.length === 0) addModelRule();
        syncModelRuleWidths();
        applyModelRulesModRestrictions();
        updateModelRulesHint();
    }

    function applyModelRulesModRestrictions() {
        const mod = isMod();
        const toggle = document.getElementById('model-rules-enabled');
        const toggleLabel = toggle.closest('label');
        toggle.disabled = mod;
        if (toggleLabel) {
            toggleLabel.title = mod ? 'Ask an admin to enable/edit overrides' : '';
            toggleLabel.style.opacity = mod ? '0.5' : '';
            toggleLabel.style.cursor = mod ? 'not-allowed' : '';
        }
        const body = document.getElementById('model-rules-body');
        const addBtn = document.getElementById('add-model-rule-btn');
        if (mod) {
            addBtn.classList.add('hidden');
            body.querySelectorAll('.mr-remove').forEach(btn => btn.classList.add('hidden'));
            body.querySelectorAll('.mr-model-display, .mr-triggers, .mr-temperature, .mr-max-tokens, .mr-history-limit').forEach(inp => {
                inp.disabled = true;
                inp.classList.add('input-readonly');
            });
            body.querySelectorAll('.mr-srv-btn').forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
                btn.style.pointerEvents = 'none';
            });
        } else {
            addBtn.classList.remove('hidden');
            body.querySelectorAll('.mr-remove').forEach(btn => btn.classList.remove('hidden'));
            body.querySelectorAll('.mr-model-display, .mr-triggers, .mr-temperature, .mr-max-tokens, .mr-history-limit').forEach(inp => {
                inp.disabled = false;
                inp.classList.remove('input-readonly');
            });
            body.querySelectorAll('.mr-srv-btn').forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.cursor = '';
                btn.style.pointerEvents = '';
            });
        }
    }

    document.getElementById('model-rules-enabled').addEventListener('change', e => {
        document.getElementById('model-rules-body').classList.toggle('hidden', !e.target.checked);
        if (e.target.checked) {
            if (document.querySelectorAll('.model-rule').length === 0) addModelRule();
            syncModelRuleWidths();
        }
        updateModelRulesHint();
    });
    document.getElementById('add-model-rule-btn').addEventListener('click', () => addModelRule());
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.mr-srv-btn') && !e.target.closest('[id^="mr-dd-"]'))
            document.querySelectorAll('[id^="mr-dd-"]').forEach(d => d.classList.add('hidden'));
    });


    // --- Core Functions ---

    const DEFAULT_CHARACTER_AVATAR = '/static/avatars/default_character_avatar.png';

    /** Matches api/routers/characters.py _safe_avatar_filename (Unicode isalnum). */
    function safeAvatarFileName(name) {
        const out = [...(name || '')].filter(c => c === '-' || c === '_' || /\p{L}|\p{N}/u.test(c)).join('');
        return out || 'avatar';
    }

    function staticAvatarPathForName(name) {
        return `/static/avatars/${safeAvatarFileName(name)}.png`;
    }

    /** Encode filename for HTTP (Miloš.png -> Milo%C5%A1.png). Idempotent if already encoded. */
    function encodeStaticAvatarUrl(path) {
        if (!path || !path.startsWith('/static/avatars/')) return path;
        const rel = path.slice('/static/avatars/'.length).split('?')[0];
        let decoded = rel;
        try {
            decoded = decodeURIComponent(rel);
        } catch {
            /* keep rel as-is */
        }
        return `/static/avatars/${encodeURIComponent(decoded)}`;
    }

    function isHttpAvatarUrl(value) {
        return /^https?:\/\//i.test((value || '').trim());
    }

    /** Display avatar as stored: static path or external URL (no silent static override). */
    function resolveAvatarDisplay(avatar) {
        const trimmed = (avatar || '').trim();
        const fallback = DEFAULT_CHARACTER_AVATAR;
        if (!trimmed) {
            return { primary: fallback, external: '', fallback };
        }
        if (trimmed.startsWith('/static/')) {
            return { primary: encodeStaticAvatarUrl(trimmed), external: '', fallback };
        }
        if (isHttpAvatarUrl(trimmed)) {
            return { primary: trimmed, external: '', fallback };
        }
        return { primary: trimmed, external: '', fallback };
    }

    function setAvatarPreviewLoading(loading) {
        if (!avatarPreviewLoader) return;
        avatarPreviewLoader.classList.toggle('hidden', !loading);
        avatarPreview.classList.toggle('is-loading', loading);
    }

    function finishAvatarPreviewLoad() {
        setAvatarPreviewLoading(false);
    }

    function applyAvatarDisplayToImg(img, avatar) {
        const isPreview = img === avatarPreview;
        const { primary, external, fallback } = resolveAvatarDisplay(avatar);
        const fallbackSrc = encodeStaticAvatarUrl(fallback);

        const done = () => {
            if (isPreview) finishAvatarPreviewLoad();
        };

        if (isPreview) {
            setAvatarPreviewLoading(true);
            img.onload = null;
            img.onerror = null;
            img.removeAttribute('src');
        }

        img.onerror = function onAvatarImgError() {
            if (external && img.src !== external) {
                img.src = external;
                return;
            }
            if (img.src !== fallbackSrc && img.src !== fallback) {
                img.src = fallbackSrc;
                return;
            }
            img.onerror = null;
            done();
        };
        img.onload = () => {
            img.onload = null;
            done();
        };
        img.src = primary;
        if (img.complete && img.naturalWidth > 0) {
            img.onload = null;
            done();
        }
    }

    /** Character grid only: try local static/avatars/{name}.png first, then DB URL, then default. */
    function resolveListCardAvatar(char) {
        const avatar = (char.avatar || '').trim();
        const fallback = DEFAULT_CHARACTER_AVATAR;
        if (avatar.startsWith('/static/')) {
            return {
                primary: encodeStaticAvatarUrl(avatar),
                external: '',
                fallback,
            };
        }
        const staticPath = encodeStaticAvatarUrl(staticAvatarPathForName(char.name));
        const external = isHttpAvatarUrl(avatar) ? avatar : '';
        return { primary: staticPath, external, fallback };
    }

    function wireAvatarImgSrc(img, { primary, external, fallback }) {
        const fallbackSrc = encodeStaticAvatarUrl(fallback);
        img.onerror = function onAvatarImgError() {
            if (external && img.src !== external) {
                img.src = external;
                return;
            }
            if (img.src !== fallbackSrc && img.src !== fallback) {
                img.src = fallbackSrc;
                return;
            }
            img.onerror = null;
        };
        img.src = primary;
    }

    function applyCharacterCardAvatar(img, char) {
        img.alt = char.name;
        wireAvatarImgSrc(img, resolveListCardAvatar(char));
    }

    async function fetchAndDisplayCharacters() {
        showPanelLoader(characterGrid, 'Loading characters...', 'full-width');
        try {
            const response = await fetch(API_BASE);
            if (!response.ok) throw new Error('Failed to fetch character list');
            const characters = await response.json(); // Gets List[CharacterListItem]
            allCharacters = characters;
            characterNameOptions = characters.map(c => c.name).sort((a, b) => a.localeCompare(b));
            wireCharacterFilterCombobox();

            characterGrid.innerHTML = ''; // Clear loading message

            characters.sort((a, b) => a.name.localeCompare(b.name));

            // Add cards for each character from the list
            characters.forEach(char => {
                const card = document.createElement('div');
                card.className = 'character-card group';
                card.dataset.charName = char.name;
                card.dataset.charId = char.id;
                card.innerHTML = `
                    <img alt="" class="character-card-img">
                    <div class="character-card-overlay" aria-hidden="true"></div>
                    <h3 class="character-card-title">${escapeHtml(char.name)}</h3>
                `;
                applyCharacterCardAvatar(card.querySelector('img'), char);
                card.addEventListener('click', () => loadCharacterForEdit(char.id));
                characterGrid.appendChild(card);
            });
            applyFilter();

        } catch (error) {
            console.error(error);
            characterGrid.innerHTML = '<p class="grid-full-width list-load-error">Failed to load characters.</p>';
            showToast('Failed to load characters.', 'error');
        }
    }

    async function loadCharacterForEdit(id) {
        setAvatarPreviewLoading(true);
        avatarPreview.removeAttribute('src');
        try {
            const response = await fetch(`${API_BASE}/${id}`);
            const char = await response.json();

            resetForm({ skipAvatar: true });
            currentCharacterId = char.id;
            currentCharacterName = char.name;
            currentCharCreatedBy = char.created_by || null;

            formTitle.textContent = `Editing: ${char.name}`;
            nameInput.value = char.name;

            personaInput.value = char.data.persona;
            instructionsInput.value = char.data.instructions;
            const avatar = (char.data.avatar || '').trim();
            const isStaticAvatar = avatar.startsWith('/static/');
            _savedStaticUrl = isStaticAvatar ? avatar : '';
            _savedExternalUrl = char.data.avatar_source || (!isStaticAvatar && isHttpAvatarUrl(avatar) ? avatar : '') || '';
            if (isStaticAvatar) {
                setAvatarMode('upload');
            } else {
                setAvatarMode('url');
            }
            infoInput.value = char.data.about || '';
            temperatureInput.value = char.data.temperature != null ? char.data.temperature : '';
            charHistoryLimitInput.value = char.data.history_limit != null ? char.data.history_limit : '';
            charMaxTokensInput.value = char.data.max_tokens != null ? char.data.max_tokens : '';
            triggersInput.value = char.triggers.join(', ');
            await Promise.all([serversReadyPromise, allowedModelsPromise]);
            loadModelRules(char.data.model_rules_enabled || false, char.data.model_rules || []);

            updateAvatarPreview(avatarUrlInput.value);

            const canEdit = canEditCurrentCharacter();
            saveBtn.textContent = 'Save Changes';
            saveBtn.classList.toggle('hidden', !canEdit);
            deleteBtn.classList.toggle('hidden', !canEdit);
            exportBtn.classList.remove('hidden');
            openModal();
        } catch (error) {
            updateAvatarPreview(DEFAULT_CHARACTER_AVATAR);
            showToast('Failed to load character.', 'error');
        }
    }

    const resetForm = (opts = {}) => {
        currentCharacterName = null;
        currentCharacterId = null;
        currentCharCreatedBy = null;
        form.reset();
        nameInput.readOnly = false;
        nameInput.classList.remove('input-readonly');
        formTitle.textContent = 'Create New Character';
        saveBtn.textContent = 'Create Character';
        saveBtn.classList.remove('hidden');
        deleteBtn.classList.add('hidden');
        exportBtn.classList.add('hidden');
        if (!opts.skipAvatar) {
            updateAvatarPreview(DEFAULT_CHARACTER_AVATAR);
        }
        _savedExternalUrl = '';
        _savedStaticUrl = '';
        currentAvatarMode = 'url';
        avatarModeUrl.classList.replace('mode-tab-off', 'mode-tab-on');
        avatarModeUpload.classList.replace('mode-tab-on', 'mode-tab-off');
        avatarUploadInput.classList.add('invisible');
        avatarUploadInput.classList.remove('visible');
        loadModelRules(false, []);

    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        if (currentCharacterId) {
            if (!canEditCurrentCharacter()) {
                showToast('You do not have permission to edit this character.', 'error');
                return;
            }
        } else {
            if (!canCreateCharacter()) {
                showToast('You need at least mod role to create characters.', 'error');
                return;
            }
        }
        
        const name = nameInput.value.trim();
        if (!name) {
            showToast('Character name is required.', 'error'); return;
        }
        if (personaInput.value.trim().length < 3 || instructionsInput.value.trim().length < 3) {
            showToast('Persona and instructions must be at least 3 characters.', 'error');
            return;
        }
        const avatarUrl = avatarUrlInput.value.trim();
        if (currentAvatarMode === 'url') {
            if (avatarUrl && !isValidHttpUrl(avatarUrl)) {
                showToast('Avatar URL must be a valid http/https URL.', 'error');
                return;
            }
        } else if (avatarUrl && !avatarUrl.startsWith('/static/')) {
            showToast('Upload mode expects a static avatar path.', 'error');
            return;
        }

        const modelRulesError = validateModelRules();
        if (modelRulesError) {
            showToast(modelRulesError, 'error');
            return;
        }

        // Gather all data from the form
        const avatarForDb = currentAvatarMode === 'url'
            ? (isHttpAvatarUrl(avatarUrl) ? avatarUrl : (_savedExternalUrl && isHttpAvatarUrl(_savedExternalUrl) ? _savedExternalUrl : null))
            : (avatarUrl || null);
        const characterData = {
            persona: personaInput.value,
            instructions: instructionsInput.value,
            avatar: avatarForDb,
            avatar_source: (currentAvatarMode === 'upload' && _savedExternalUrl) ? _savedExternalUrl : null,
            about: infoInput.value.trim() || null,
            temperature: temperatureInput.value !== '' ? parseFloat(temperatureInput.value) : null,
            history_limit: charHistoryLimitInput.value !== '' ? parseInt(charHistoryLimitInput.value) : null,
            max_tokens: charMaxTokensInput.value !== '' ? parseInt(charMaxTokensInput.value) : null,
            model_rules_enabled: isMod() ? undefined : document.getElementById('model-rules-enabled').checked,
            model_rules: isMod() ? undefined : getModelRules(),
        };
        const triggers = triggersInput.value.split(',').map(s => s.trim()).filter(Boolean);

        try {
            let response;
            let url;
            let method;
            let body;

            if (currentCharacterId) {
                // --- UPDATE existing character ---
                url = `${API_BASE}/${currentCharacterId}`;
                method = 'PUT';
                body = JSON.stringify({
                    name: name,
                    data: characterData,
                    triggers: triggers
                });
            } else {
                // --- CREATE new character ---
                url = `${API_BASE}/`; // Use the root POST endpoint
                method = 'POST';
                body = JSON.stringify({
                    name: name,
                    data: characterData,
                    triggers: triggers
                });
            }

            response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: body
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'An unknown error occurred.');
            }

            const result = await response.json();
            if (result.triggers) {
                triggersInput.value = result.triggers.join(', ');
            }
            if (result.data?.model_rules) {
                await serversReadyPromise;
                loadModelRules(result.data.model_rules_enabled || false, result.data.model_rules || []);
            }
            showToast(`Character '${result.name}' saved successfully!`);
            await fetchAndDisplayCharacters();
            closeModal();

        } catch (error) {
            showToast(`Error saving character: ${error.message}`, 'error');
        }
    }

    function handleExport() {
        if (!currentCharacterId) return;
        const characterData = {
            name: nameInput.value,
            data: {
                persona: personaInput.value,
                about: infoInput.value.trim() || null,
                instructions: instructionsInput.value,
                avatar: avatarUrlInput.value.trim() || null,
                temperature: temperatureInput.value !== '' ? parseFloat(temperatureInput.value) : null,
                history_limit: charHistoryLimitInput.value !== '' ? parseInt(charHistoryLimitInput.value) : null,
                max_tokens: charMaxTokensInput.value !== '' ? parseInt(charMaxTokensInput.value) : null,
            },
            triggers: triggersInput.value.split(',').map(s => s.trim()).filter(Boolean)
        };
        const blob = new Blob([JSON.stringify(characterData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentCharacterName}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function handleDelete() {
        if (!canEditCurrentCharacter()) {
            showToast('You do not have permission to delete this character.', 'error');
            return;
        }
        if (!currentCharacterId || !confirm(`Are you sure you want to delete '${nameInput.value}'? This cannot be undone.`)) {
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/${currentCharacterId}`, { method: 'DELETE' });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'An unknown error occurred.');
            }
            showToast(`Character '${nameInput.value}' deleted.`);
            closeModal();
            await fetchAndDisplayCharacters();
        } catch (error) {
            showToast(`Error deleting character: ${error.message}`, 'error');
        }
    }

    // Avatar mode toggle
    const avatarModeUrl = document.getElementById('avatar-mode-url');
    const avatarModeUpload = document.getElementById('avatar-mode-upload');
    let currentAvatarMode = 'url';
    let _savedExternalUrl = '';
    let _savedStaticUrl = '';

    function setAvatarMode(mode) {
        currentAvatarMode = mode;
        const cur = avatarUrlInput.value.trim();

        if (mode === 'url') {
            avatarModeUrl.classList.replace('mode-tab-off', 'mode-tab-on');
            avatarModeUpload.classList.replace('mode-tab-on', 'mode-tab-off');
            avatarUploadInput.classList.add('invisible');
            avatarUploadInput.classList.remove('visible');
            avatarUrlInput.placeholder = 'Paste image URL (https://...)';
            if (cur.startsWith('/static/') && !_savedStaticUrl) {
                _savedStaticUrl = cur;
            }
            avatarUrlInput.value = isHttpAvatarUrl(_savedExternalUrl) ? _savedExternalUrl : '';
            updateAvatarPreview(avatarUrlInput.value);
            return;
        }

        avatarModeUpload.classList.replace('mode-tab-off', 'mode-tab-on');
        avatarModeUrl.classList.replace('mode-tab-on', 'mode-tab-off');
        avatarUploadInput.classList.remove('invisible');
        avatarUploadInput.classList.add('visible');
        avatarUrlInput.placeholder = 'Paste URL to auto-download, or pick a file below';
        if (isHttpAvatarUrl(cur)) {
            _savedExternalUrl = cur;
        }
        if (_savedStaticUrl) {
            avatarUrlInput.value = _savedStaticUrl;
            updateAvatarPreview(_savedStaticUrl);
        } else if (isHttpAvatarUrl(cur)) {
            mirrorUrl(cur);
        } else {
            avatarUrlInput.value = '';
            updateAvatarPreview('');
        }
    }
    avatarModeUrl.addEventListener('click', () => setAvatarMode('url'));
    avatarModeUpload.addEventListener('click', () => setAvatarMode('upload'));

    // Auto-mirror URL to static when in upload mode
    async function mirrorUrl(url) {
        _savedExternalUrl = url;
        const charName = nameInput.value.trim() || 'avatar';
        const originalUrl = avatarUrlInput.value;
        avatarUrlInput.value = 'Downloading...';
        saveBtn.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/mirror_avatar?name=${encodeURIComponent(charName)}&url=${encodeURIComponent(url)}`, { method: 'POST' });
            if (!response.ok) { const e = await response.json(); throw new Error(e.detail || 'Download failed.'); }
            const result = await response.json();
            _savedStaticUrl = result.url;
            avatarUrlInput.value = result.url;
            updateAvatarPreview(result.url);
            showToast('Avatar saved to static!');
        } catch (error) {
            showToast(`Auto-download failed: ${error.message}`, 'error');
            avatarUrlInput.value = originalUrl;
        } finally {
            saveBtn.disabled = false;
        }
    }

    let _mirrorTimer = null;
    avatarUrlInput.addEventListener('input', (e) => {
        const v = e.target.value.trim();
        if (currentAvatarMode === 'url') {
            if (isHttpAvatarUrl(v)) _savedExternalUrl = v;
            updateAvatarPreview(e.target.value);
            return;
        }
        updateAvatarPreview(e.target.value);
        if (!v.startsWith('http')) return;
        clearTimeout(_mirrorTimer);
        _mirrorTimer = setTimeout(() => mirrorUrl(v), 800);
    });

    // Avatar upload logic
    async function uploadFile(file) {
        if (!file) return;
        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            showToast('Unsupported file type. Allowed: PNG, JPG, WEBP, GIF.', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('File is too large. Maximum size is 5 MB.', 'error');
            return;
        }
        const formData = new FormData();
        formData.append('image', file);
        const originalUrl = avatarUrlInput.value;
        avatarUrlInput.value = 'Uploading...';
        saveBtn.disabled = true;
        try {
            const charName = nameInput.value.trim() || 'avatar';
            const response = await fetch(`${API_BASE}/save_avatar?name=${encodeURIComponent(charName)}`, { method: 'POST', body: formData });
            if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.detail || 'Upload failed.'); }
            const result = await response.json();
            avatarUrlInput.value = result.url;
            updateAvatarPreview(result.url);
            showToast('Avatar uploaded successfully!');
        } catch (error) {
            showToast(`Avatar upload failed: ${error.message}`, 'error');
            avatarUrlInput.value = originalUrl; updateAvatarPreview(originalUrl);
        } finally {
            saveBtn.disabled = false; avatarUploadInput.value = '';
        }
    }

    const updateAvatarPreview = (url) => {
        if (url && url.startsWith('blob:')) {
            setAvatarPreviewLoading(true);
            avatarPreview.removeAttribute('src');
            avatarPreview.onload = () => {
                avatarPreview.onload = null;
                finishAvatarPreviewLoad();
            };
            avatarPreview.onerror = () => {
                avatarPreview.onerror = null;
                finishAvatarPreviewLoad();
            };
            avatarPreview.src = url;
            if (avatarPreview.complete && avatarPreview.naturalWidth > 0) {
                avatarPreview.onload = null;
                finishAvatarPreviewLoad();
            }
            return;
        }
        applyAvatarDisplayToImg(avatarPreview, url);
    };

    // --- Import Info Modal ---
    const importInfoModal = document.getElementById('import-info-modal');
    const importInfoClose = document.getElementById('import-info-close');
    const importInfoProceed = document.getElementById('import-info-proceed');
    const importTemplateDownload = document.getElementById('import-template-download');

    function openImportInfoModal() {
        importInfoModal.classList.remove('opacity-0', 'pointer-events-none');
    }
    function closeImportInfoModal() {
        importInfoModal.classList.add('opacity-0', 'pointer-events-none');
    }
    importInfoClose.addEventListener('click', closeImportInfoModal);
    importInfoProceed.addEventListener('click', () => {
        closeImportInfoModal();
        importFileInput.click();
    });
    importTemplateDownload.addEventListener('click', () => {
        const template = `// This is a character template. Lines starting with // are comments — notes for you.
    // The AI never sees them, and they are automatically ignored when you import this file.
    {
    // The character's name. Also used as a trigger — when someone types it in a channel,
    // this character will respond.
    "name": "CharacterName",

    "data": {
    // The main character description — who they are, how they speak, their personality,
    // background, habits. You can use {{char}} as a shorthand for the character's name
    // and {{user}} for the name of the person they're talking to.
    "persona": "{{char}} is a 28-year-old sarcastic librarian with a sharp wit and a love for mystery novels. She speaks in short sentences, rarely shows emotion, but would do anything for the people she trusts.",

    // Behavioral rules — what the character must or must not do, how to format responses.
    // This is added after the persona in the system prompt sent to the AI.
    "instructions": "Always respond as {{char}} only. Keep responses concise — 1 to 3 sentences unless asked for more. Never break character.",

    // A short note for yourself — the AI never sees this. Useful for identifying
    // the character in a list.
    "about": "Sarcastic librarian for general chat.",

    // Response creativity: 0.0 = predictable and consistent, 2.0 = very random.
    // Leave as null to use the global value from AI Config.
    "temperature": null,

    // How many recent messages the character can see as conversation context.
    // Leave as null to use the global value from AI Config.
    "history_limit": null,

    // Maximum response length in tokens (roughly 1 token = 0.75 words).
    // Leave as null to use the global value from AI Config.
    "max_tokens": null
    },

    // Additional words that trigger this character (besides its name, which is always automatic).
    // Case-insensitive, matches whole words only.
    "triggers": ["CharacterName", "nickname", "alias"]
    }`;
        const blob = new Blob([template], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'character_template.jsonc';
        a.click();
    });

    function handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.name.endsWith('.json') || file.name.endsWith('.jsonc')) { processJsonFile(file); }
        else if (file.name.endsWith('.png')) { processPngFile(file); }
        else { showToast('Unsupported file type. Please select a .json, .jsonc or .png card.', 'error'); }
        event.target.value = '';
    }
    function stripJsonComments(str) {
        return str.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    }
    function processJsonFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(stripJsonComments(e.target.result));
                resetForm();
                populateFormWithCardData(data);
                openModal();
            } catch (error) { showToast('Failed to parse JSON file.', 'error'); }
        };
        reader.readAsText(file);
    }
    async function processPngFile(file) {
        showToast('Processing PNG card...', 'success');
        try {
            const data = await getCharacterDataFromPng(file);
            if (!data) { throw new Error('No character data found in the PNG file.'); }
            resetForm();
            populateFormWithCardData(data);
            updateAvatarPreview(URL.createObjectURL(file));
            openModal();
            await uploadFile(file);
        } catch (error) { showToast(error.message, 'error'); }
    }
    function populateFormWithCardData(data) {
        const charData = data.data || data; // Handle different card formats
        nameInput.value = charData.name || '';
        // Attempt to parse Pygmalion/Tavern fields
        const description = charData.description || '';
        const personality = charData.personality || '';
        if (description || personality) {
            personaInput.value = `<description>\n${description}\n</description>\n<personality>\n${personality}\n</personality>`;
        } else {
            personaInput.value = charData.persona || ''; // Fallback for our format
        }
        const systemPrompt = charData.system_prompt ||  '';
        const postHistory = charData.post_history_instructions || '';
        if(systemPrompt || postHistory) {
            instructionsInput.value = `[System Note: ${systemPrompt}]\n[System Note: ${postHistory}]`;
        } else {
            instructionsInput.value = charData.instructions || '';
        }
        infoInput.value = charData.about || charData.character_version || charData.creator_notes || '';
    }
    async function getCharacterDataFromPng(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const dataView = new DataView(arrayBuffer);
                    if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
                        return reject(new Error("Not a valid PNG file."));
                    }
                    let offset = 8;
                    while (offset < dataView.byteLength) {
                        const length = dataView.getUint32(offset);
                        const type = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, offset + 4, 4));
                        if (type === 'tEXt') {
                            const chunkData = new Uint8Array(arrayBuffer, offset + 8, length);
                            const decoder = new TextDecoder('iso-8859-1');
                            const text = decoder.decode(chunkData);
                            const nullIndex = text.indexOf('\0');
                            if (nullIndex > 0) {
                                const key = text.substring(0, nullIndex);
                                const value = text.substring(nullIndex + 1);
                                if (key === 'chara') {
                                    const decodedJson = atob(value);
                                    const parsedData = JSON.parse(decodedJson);
                                    return resolve(parsedData);
                                }
                            }
                        }
                        if (type === 'IEND') break;
                        offset += 12 + length;
                    }
                    resolve(null);
                } catch (err) { reject(new Error("Could not parse character data from PNG.")); }
            };
            reader.onerror = () => reject(new Error("Failed to read the file."));
            reader.readAsArrayBuffer(file);
        });
    }

    // --- Event Listeners ---
    form.addEventListener('submit', handleFormSubmit);
    newCharBtn.addEventListener('click', () => {
        resetForm();
        openModal();
    });
    importCardBtn.addEventListener('click', () => {
        if (!canCreateCharacter()) {
            showToast('You need at least mod role to import characters.', 'error');
            return;
        }
        openImportInfoModal();
    });
    deleteBtn.addEventListener('click', handleDelete);
    exportBtn.addEventListener('click', handleExport);
    avatarUploadInput.addEventListener('change', (e) => uploadFile(e.target.files[0]));
    importFileInput.addEventListener('change', handleFileImport);
    modalCloseBtn.addEventListener('click', closeModal);

    // --- Initial Load ---
    (window.__authStatus || fetch('/api/me').then(r => r.json()))
        .then(d => {
            currentUserRole = d?.current_user?.role || (d?.panel_auth_enabled ? 'guest' : 'super_admin');
            currentUsername = d?.current_user?.username || '';
            currentUserServerIds = d?.current_user?.server_ids || [];
        })
        .catch(() => {})
        .finally(() => {
            serversReadyPromise = loadServerFilter();
            allowedModelsPromise = loadAllowedModels();
            fetchAndDisplayCharacters();
        });
    });