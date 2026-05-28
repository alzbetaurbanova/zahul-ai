document.addEventListener('DOMContentLoaded', () => {
    const messagesEl = document.getElementById('sim-messages');
    const emptyEl = document.getElementById('sim-chat-empty');
    const composeForm = document.getElementById('sim-compose');
    const inputEl = document.getElementById('sim-input');
    const sendBtn = document.getElementById('sim-send-btn');
    const characterInput = document.getElementById('sim-character');
    const serverInput = document.getElementById('sim-server');
    const serverIdInput = document.getElementById('sim-server-id');
    const serverField = document.getElementById('sim-server-field');
    const serverHintEl = document.getElementById('sim-server-hint');
    const userNameInput = document.getElementById('sim-user-name');
    const modelInput = document.getElementById('sim-model');
    const modelSourceInput = document.getElementById('sim-model-source');
    const temperatureInput = document.getElementById('sim-temperature');
    const maxTokensInput = document.getElementById('sim-max-tokens');
    const historyLimitInput = document.getElementById('sim-history-limit');
    const SIM_MAX_TOKENS = 2000;
    const subtitleEl = document.getElementById('sim-chat-subtitle');
    const metaEl = document.getElementById('sim-meta');
    const resetOverridesBtn = document.getElementById('sim-reset-overrides-btn');
    const clearChatBtn = document.getElementById('sim-clear-chat-btn');
    const userAvatarEl = document.getElementById('sim-user-avatar');

    const DEFAULT_USER_AVATAR = '/static/avatars/default_user_avatar.png';

    let characters = [];
    let characterMap = {};
    let allowedModels = [];
    let defaults = {};
    let conversation = [];
    let selectedCharacter = null;
    let availableServers = [];
    let userServers = [];
    let selectedServerId = '';
    let sending = false;
    let currentUserAvatar = DEFAULT_USER_AVATAR;
    let serverTokenLimit = null;
    let serverTokensUsed = 0;
    let readOnlyMode = false;

    const readonlyBannerEl = document.getElementById('sim-readonly-banner');

    function parseOptionalFloat(input) {
        const v = input.value.trim();
        if (v === '') return null;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    function parseOptionalInt(input) {
        const v = input.value.trim();
        if (v === '') return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    }

    function effectiveOverridesForCharacter(char) {
        const data = char?.data || {};
        const temp = data.temperature ?? defaults.temperature ?? 0.7;
        const rawTokens = data.max_tokens ?? defaults.max_tokens ?? 256;
        const tokens = Math.min(Math.max(1, Number(rawTokens) || 256), SIM_MAX_TOKENS);
        const historyLimit = data.history_limit ?? defaults.history_limit ?? null;
        return { temperature: temp, max_tokens: tokens, history_limit: historyLimit };
    }

    function applySimOverrideFields(char) {
        const { temperature, max_tokens, history_limit } = effectiveOverridesForCharacter(char);
        temperatureInput.value = String(temperature);
        maxTokensInput.value = String(max_tokens);
        historyLimitInput.value = history_limit != null ? String(history_limit) : '';
    }

    function parseSimMaxTokens() {
        const n = parseOptionalInt(maxTokensInput);
        if (n === null) return SIM_MAX_TOKENS;
        return Math.min(Math.max(1, n), SIM_MAX_TOKENS);
    }

    function parseSimTemperature() {
        const n = parseOptionalFloat(temperatureInput);
        if (n === null) return effectiveOverridesForCharacter(selectedCharacter).temperature;
        return Math.min(Math.max(0, n), 2);
    }

    function clampSimMaxTokensInput() {
        const n = parseOptionalInt(maxTokensInput);
        if (n === null) return;
        if (n > SIM_MAX_TOKENS) maxTokensInput.value = String(SIM_MAX_TOKENS);
        else if (n < 1) maxTokensInput.value = '1';
    }

    function avatarUrl(name, avatar) {
        if (avatar) return avatar;
        return `/static/avatars/${encodeURIComponent(name)}.png`;
    }

    function updateUserAvatarPreview() {
        if (!userAvatarEl) return;
        userAvatarEl.src = currentUserAvatar || DEFAULT_USER_AVATAR;
        userAvatarEl.onerror = () => { userAvatarEl.src = DEFAULT_USER_AVATAR; };
    }

    async function loadCurrentUser() {
        const cachedName = localStorage.getItem('user-name') || '';
        const cachedAvatar = localStorage.getItem('user-avatar') || '';
        if (cachedName) userNameInput.value = cachedName;
        if (cachedAvatar) currentUserAvatar = cachedAvatar;
        updateUserAvatarPreview();

        try {
            const auth = await (window.__authStatus || fetch('/api/me').then(r => r.ok ? r.json() : null));
            const username = auth?.current_user?.username;
            if (username && !userNameInput.value.trim()) {
                userNameInput.value = username;
            }
        } catch (_) {}

        try {
            const res = await fetch('/api/users/me');
            if (!res.ok) return;
            const me = await res.json();
            if (me.username) userNameInput.value = me.username;
            if (me.avatar_url) currentUserAvatar = me.avatar_url;
            updateUserAvatarPreview();
        } catch (_) {}
    }

    function userDisplayName() {
        return userNameInput.value.trim() || 'User';
    }

    function updateQuotaHint() {
        if (serverTokenLimit == null) {
            if (!selectedServerId) metaEl.classList.add('hidden');
            return;
        }
        metaEl.classList.remove('hidden');
        metaEl.textContent = `Server quota today: ${serverTokensUsed.toLocaleString()} / ${serverTokenLimit.toLocaleString()} tokens (chat + simulator)`;
    }

    function updateComposeState() {
        const ready = !readOnlyMode && !!selectedCharacter && !!selectedServerId && !sending;
        inputEl.disabled = !ready;
        sendBtn.disabled = !ready;
    }

    function applyReadOnlyMode(canRun) {
        readOnlyMode = !canRun;
        if (readonlyBannerEl) {
            readonlyBannerEl.classList.toggle('hidden', !readOnlyMode);
        }
        document.querySelector('.sim-page')?.classList.toggle('sim-readonly', readOnlyMode);

        const disable = readOnlyMode;
        characterInput.readOnly = disable;
        serverInput.readOnly = disable;
        userNameInput.readOnly = disable;
        modelInput.readOnly = disable;
        temperatureInput.readOnly = disable;
        maxTokensInput.readOnly = disable;
        characterInput.disabled = disable;
        userNameInput.disabled = disable;
        modelInput.disabled = disable;
        temperatureInput.disabled = disable;
        maxTokensInput.disabled = disable;
        resetOverridesBtn.disabled = disable;
        clearChatBtn.disabled = disable;

        document.querySelectorAll('[data-clear="sim-character"], [data-clear="sim-server"], [data-clear="sim-model"]')
            .forEach(btn => { btn.disabled = disable; });

        if (readOnlyMode) {
            inputEl.placeholder = 'Guests cannot send messages';
        } else {
            inputEl.placeholder = 'Message #simulation';
        }
        updateServerFieldState();
        updateComposeState();
    }

    async function logSimulatorVisit() {
        try {
            const res = await fetch('/api/simulate/visit', { method: 'POST' });
            if (!res.ok) return;
            const data = await res.json();
            applyReadOnlyMode(data.can_run !== false);
        } catch (_) {}
    }

    function updateSubtitle() {
        if (!selectedCharacter) {
            subtitleEl.textContent = 'Pick a character to start';
            return;
        }
        const srv = availableServers.find(s => s.server_id === selectedServerId);
        const srvLabel = srv ? srv.server_name : '';
        subtitleEl.textContent = srvLabel
            ? `Testing as ${selectedCharacter.name} · ${srvLabel}`
            : `Testing as ${selectedCharacter.name}`;
    }

    function hideEmptyState() {
        if (emptyEl) emptyEl.classList.add('hidden');
    }

    function showEmptyState() {
        if (emptyEl) emptyEl.classList.remove('hidden');
    }

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function formatDiscordContent(text) {
        return escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="sim-inline-code">$1</code>')
            .replace(/\n/g, '<br>');
    }

    function appendMessage({ role, author, content, avatar, meta }) {
        hideEmptyState();
        const isBot = role === 'assistant';
        const row = document.createElement('div');
        row.className = `sim-msg${isBot ? ' sim-msg--bot' : ' sim-msg--user'}`;

        const img = document.createElement('img');
        img.className = 'sim-msg-avatar';
        img.src = avatar || '/static/avatars/default.png';
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { img.src = '/static/avatars/default.png'; };

        const body = document.createElement('div');
        body.className = 'sim-msg-body';

        const head = document.createElement('div');
        head.className = 'sim-msg-head';
        head.innerHTML = `<span class="sim-msg-author">${escapeHtml(author)}</span><span class="sim-msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

        const text = document.createElement('div');
        text.className = 'sim-msg-content';
        text.innerHTML = formatDiscordContent(content);

        body.appendChild(head);
        body.appendChild(text);

        if (meta) {
            const metaLine = document.createElement('div');
            metaLine.className = 'sim-msg-meta';
            metaLine.textContent = meta;
            body.appendChild(metaLine);
        }

        row.appendChild(img);
        row.appendChild(body);
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function appendTypingIndicator() {
        hideEmptyState();
        const row = document.createElement('div');
        row.id = 'sim-typing';
        row.className = 'sim-msg sim-msg--bot sim-msg--typing';
        row.innerHTML = `
            <img class="sim-msg-avatar" src="${charAvatar(selectedCharacter)}" alt="">
            <div class="sim-msg-body">
                <div class="sim-msg-head"><span class="sim-msg-author">${escapeHtml(selectedCharacter?.name || '…')}</span></div>
                <div class="sim-typing-dots"><span></span><span></span><span></span></div>
            </div>`;
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        document.getElementById('sim-typing')?.remove();
    }

    function charAvatar(char) {
        if (!char) return '/static/avatars/default.png';
        return char.data?.avatar || char.avatar || avatarUrl(char.name);
    }

    async function loadServerQuota(serverId) {
        if (!serverId) {
            serverTokenLimit = null;
            serverTokensUsed = 0;
            updateQuotaHint();
            return;
        }
        try {
            const res = await fetch(`/api/simulate/defaults?server_id=${encodeURIComponent(serverId)}`);
            if (!res.ok) return;
            const data = await res.json();
            serverTokenLimit = data.token_limit ?? null;
            serverTokensUsed = data.tokens_used_today ?? 0;
            updateQuotaHint();
        } catch (_) {}
    }

    function updateServerHint() {
        if (!serverHintEl) return;
        if (!selectedCharacter) {
            serverHintEl.classList.add('hidden');
            serverHintEl.textContent = '';
            return;
        }
        if (!availableServers.length) {
            serverHintEl.classList.remove('hidden');
            serverHintEl.textContent = 'No server assigned to your account for billing.';
            return;
        }
        if (availableServers.length === 1) {
            serverHintEl.classList.add('hidden');
            serverHintEl.textContent = '';
            return;
        }
        serverHintEl.classList.remove('hidden');
        serverHintEl.textContent = selectedServerId
            ? `${availableServers.length} servers available`
            : `Pick a server (${availableServers.length} available)`;
    }

    function updateServerFieldState() {
        const hasCharacter = !!selectedCharacter;
        const hasOptions = availableServers.length > 0;
        serverInput.disabled = readOnlyMode || !hasCharacter || !hasOptions;
        serverInput.placeholder = !hasCharacter
            ? 'Select character first…'
            : hasOptions
                ? (availableServers.length === 1 ? availableServers[0].server_name : 'Select server…')
                : 'No server available';
        serverField.classList.toggle('hidden', userServers.length === 0);
        updateServerHint();
    }

    function applyServerOptions(servers, { keepSelection = true } = {}) {
        availableServers = servers || [];
        const prevId = keepSelection ? selectedServerId : '';
        if (prevId && availableServers.some(s => s.server_id === prevId)) {
            selectServer(availableServers.find(s => s.server_id === prevId));
            return;
        }
        if (availableServers.length === 1) {
            selectServer(availableServers[0]);
            return;
        }
        selectServer(null);
    }

    function selectServer(server) {
        if (!server) {
            selectedServerId = '';
            serverIdInput.value = '';
            serverInput.value = '';
            serverTokenLimit = null;
            serverTokensUsed = 0;
            updateQuotaHint();
            updateSubtitle();
            updateServerFieldState();
            updateComposeState();
            return;
        }
        selectedServerId = server.server_id;
        serverIdInput.value = server.server_id;
        serverInput.value = server.server_name;
        serverTokenLimit = server.token_limit ?? null;
        serverTokensUsed = server.tokens_used_today ?? 0;
        if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch('sim-server');
        updateQuotaHint();
        updateSubtitle();
        updateServerFieldState();
        updateComposeState();
        loadServerQuota(server.server_id);
        loadEffectiveSettings();
    }

    async function loadUserServers() {
        try {
            const res = await fetch('/api/simulate/servers');
            if (!res.ok) return;
            userServers = await res.json();
        } catch (_) {
            userServers = [];
        }
        updateServerFieldState();
    }

    async function loadServersForCharacter(name) {
        if (!name) {
            applyServerOptions([], { keepSelection: false });
            updateServerFieldState();
            return;
        }
        // Billing is always on the user's own server - use the full user server list
        // and keep the current selection when switching characters.
        applyServerOptions(userServers, { keepSelection: true });
        updateServerFieldState();
        if (!userServers.length) {
            showToast('No server available to bill this test against', 'error');
        }
    }

    async function loadEffectiveSettings() {
        if (!selectedCharacter || !selectedServerId) return;
        try {
            const res = await fetch(
                `/api/simulate/defaults?server_id=${encodeURIComponent(selectedServerId)}&character=${encodeURIComponent(selectedCharacter.name)}`
            );
            if (!res.ok) return;
            const d = await res.json();
            temperatureInput.value = d.temperature ?? '';
            maxTokensInput.value = d.max_tokens ?? '';
            historyLimitInput.value = d.history_limit ?? '';
        } catch (_) {}
    }

    function applyCharacterDefaults(char) {
        selectedCharacter = char;
        const data = char.data || {};
        temperatureInput.value = '';
        maxTokensInput.value = '';
        historyLimitInput.value = '';
        if (data.provider_model) {
            modelInput.value = displayForModel(data.provider_model, data.provider_override || 'primary', allowedModels);
            modelSourceInput.value = data.provider_override || 'primary';
        } else {
            modelInput.value = '';
            modelSourceInput.value = '';
        }
        updateSubtitle();
        updateComposeState();
    }

    async function resetOverrides() {
        await loadEffectiveSettings();
        modelInput.value = '';
        modelSourceInput.value = '';
        if (selectedCharacter) {
            const data = selectedCharacter.data || {};
            if (data.provider_model) {
                modelInput.value = displayForModel(data.provider_model, data.provider_override || 'primary', allowedModels);
                modelSourceInput.value = data.provider_override || 'primary';
            }
            showToast('Simulation settings restored');
        }
    }

    function clearChat() {
        conversation = [];
        messagesEl.querySelectorAll('.sim-msg').forEach(el => el.remove());
        if (serverTokenLimit == null) metaEl.classList.add('hidden');
        metaEl.textContent = serverTokenLimit != null
            ? `Server quota today: ${serverTokensUsed.toLocaleString()} / ${serverTokenLimit.toLocaleString()} tokens (chat + simulator)`
            : '';
        showEmptyState();
    }

    function resolveModelSelection() {
        const display = modelInput.value.trim();
        if (!display) return { model: null, source: null };
        const entry = allowedModels.find(m => m.display === display);
        if (entry) return { model: entry.model, source: entry.source };
        const stripped = display.match(/^(.+?)\s+\([^)]+\)$/);
        return { model: stripped ? stripped[1].trim() : display, source: modelSourceInput.value || 'primary' };
    }

    function clearCharacterSelection() {
        selectedCharacter = null;
        temperatureInput.value = '';
        maxTokensInput.value = '';
        historyLimitInput.value = '';
        applyServerOptions([], { keepSelection: false });
        updateServerFieldState();
        updateSubtitle();
        updateComposeState();
    }

    async function loadInitialData() {
        try {
            const [charsRes, modelsRes, defaultsRes] = await Promise.all([
                fetch('/api/simulate/characters'),
                fetch('/api/simulate/models'),
                fetch('/api/simulate/defaults'),
            ]);
            if (charsRes.ok) {
                characters = await charsRes.json();
                characterMap = Object.fromEntries(characters.map(c => [c.name, c]));
            } else {
                characters = [];
                characterMap = {};
                showToast('Could not load allowed characters', 'error');
            }
            if (modelsRes.ok) {
                allowedModels = normalizeAllowedModels(await modelsRes.json());
            }
            if (defaultsRes.ok) {
                defaults = await defaultsRes.json();
                if (defaults.history_limit != null) {
                    historyLimitInput.placeholder = String(defaults.history_limit);
                }
            }
        } catch (e) {
            showToast('Failed to load simulator data', 'error');
        }
    }

    async function loadCharacterDetail(listItem) {
        if (!listItem) {
            clearCharacterSelection();
            return null;
        }
        try {
            const res = await fetch(`/api/characters/${listItem.id}`);
            if (!res.ok) throw new Error('Character not found');
            const char = await res.json();
            applyCharacterDefaults(char);
            await loadServersForCharacter(char.name);
            return char;
        } catch {
            clearCharacterSelection();
            showToast('Could not load character details', 'error');
            return null;
        }
    }

    function wireComboboxes() {
        setupFilterCombobox(
            'sim-character', 'sim-character-dd',
            () => characters.map(c => c.name).sort((a, b) => a.localeCompare(b)),
            async (name) => {
                characterInput.value = name;
                const listItem = characterMap[name];
                if (listItem) await loadCharacterDetail(listItem);
                else clearCharacterSelection();
            },
            () => {
                const name = characterInput.value.trim();
                if (!name || !characterMap[name]) clearCharacterSelection();
            },
            'hover:bg-gray-700'
        );

        setupFilterCombobox(
            'sim-server', 'sim-server-dd',
            () => availableServers.map(s => s.server_name),
            (serverName) => {
                const server = availableServers.find(s => s.server_name === serverName);
                if (server) selectServer(server);
            },
            () => {},
            'hover:bg-gray-700'
        );

        setupFilterCombobox(
            'sim-model', 'sim-model-dd',
            () => allowedModels.map(m => m.display),
            (display) => {
                modelInput.value = display;
                const entry = allowedModels.find(m => m.display === display);
                modelSourceInput.value = entry ? entry.source : 'primary';
            },
            () => {},
            'hover:bg-gray-700'
        );
    }

    composeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (readOnlyMode || !selectedCharacter || !selectedServerId || sending) return;

        const text = inputEl.value.trim();
        if (!text) return;

        const userName = userDisplayName();

        conversation.push({ role: 'user', content: text, author: userName });
        appendMessage({ role: 'user', author: userName, content: text, avatar: currentUserAvatar });

        inputEl.value = '';
        sending = true;
        updateComposeState();
        appendTypingIndicator();

        const { model, source } = resolveModelSelection();
        const payload = {
            character: selectedCharacter.name,
            server_id: selectedServerId,
            message: text,
            user_name: userName,
            model: model || null,
            model_source: source || null,
            temperature: parseSimTemperature(),
            max_tokens: parseSimMaxTokens(),
            history_limit: parseOptionalInt(historyLimitInput),
            conversation: conversation.slice(0, -1),
        };

        try {
            const res = await fetch('/api/simulate/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            removeTypingIndicator();

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const reply = data.response || '//[OOC: Empty response]';
            conversation.push({ role: 'assistant', content: reply });

            const metaParts = [];
            if (data.model) metaParts.push(data.model);
            if (data.endpoint) metaParts.push(data.endpoint);
            if (data.input_tokens != null) metaParts.push(`${data.input_tokens}+${data.output_tokens} tok`);

            appendMessage({
                role: 'assistant',
                author: data.character || selectedCharacter.name,
                content: reply,
                avatar: data.avatar || charAvatar(selectedCharacter),
                meta: metaParts.length ? metaParts.join(' · ') : null,
            });

            if (data.error) {
                showToast('Character returned an error response', 'error');
            }

            if (data.tokens_used_today != null) serverTokensUsed = data.tokens_used_today;
            if (data.token_limit != null) serverTokenLimit = data.token_limit;
            updateQuotaHint();

            metaEl.classList.remove('hidden');
            metaEl.textContent = serverTokenLimit != null
                ? `Last: ${data.model || '—'} · temp ${data.temperature ?? '—'} · history ${data.history_count ?? 0} msgs · server quota ${serverTokensUsed.toLocaleString()}/${serverTokenLimit.toLocaleString()} tok`
                : `Last: ${data.model || '—'} · temp ${data.temperature ?? '—'} · history ${data.history_count ?? 0} msgs in prompt`;
        } catch (err) {
            removeTypingIndicator();
            conversation.pop();
            showToast(err.message || 'Request failed', 'error');
        } finally {
            sending = false;
            updateComposeState();
            inputEl.focus();
        }
    });

    resetOverridesBtn.addEventListener('click', resetOverrides);
    clearChatBtn.addEventListener('click', () => {
        if (conversation.length && !confirm('Clear all messages in this simulation?')) return;
        clearChat();
    });

    maxTokensInput.addEventListener('change', clampSimMaxTokensInput);
    maxTokensInput.addEventListener('blur', clampSimMaxTokensInput);

    (async () => {
        await logSimulatorVisit();
        await Promise.all([loadInitialData(), loadCurrentUser(), loadUserServers()]);
        wireComboboxes();
        updateServerFieldState();
        updateComposeState();
    })();
});
