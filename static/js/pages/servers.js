document.addEventListener('DOMContentLoaded', function() {
    const API_BASE = '/api/servers';
    let currentUserRole = 'guest';
    let currentServer = null;
    let currentChannel = null;
    let availableCharacters = [];
    let globalDefaultCharacter = '';
    // DOM Elements
    const serverList = document.getElementById('server-list');
    const channelPanel = document.getElementById('channel-panel');
    const channelListTitle = document.getElementById('channel-list-title');
    const channelList = document.getElementById('channel-list');
    const channelEditModal = document.getElementById('channel-edit-modal');
    const closeChannelEditModalBtn = document.getElementById('close-channel-edit-modal-btn');
    const form = document.getElementById('channel-form');
    const formTitle = document.getElementById('form-title');
    const addChannelBtn = document.getElementById('add-channel-btn');
    const addServerBtn = document.getElementById('add-server-btn');
    const addChannelModal = document.getElementById('add-channel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const toastContainer = document.getElementById('toast-container');
    const serverEditModal = document.getElementById('server-edit-modal');
    const serverEditTitle = document.getElementById('server-edit-title');
    const srvDefaultCharacterInput = document.getElementById('srv-default-character');
    const srvDefaultCharacterStatus = document.getElementById('srv-default-character-status');

    function canEditServers() {
        return typeof window.canMutate === 'function'
            ? window.canMutate(currentUserRole)
            : currentUserRole === 'admin' || currentUserRole === 'super_admin';
    }

    // Form fields
    const nameInput = document.getElementById('name');
    const defaultCharacterInput = document.getElementById('default-character');
    const defaultCharacterStatus = document.getElementById('default-character-status');
    const whitelistInput = document.getElementById('whitelist');
    const isSystemChannelInput = document.getElementById('is_system_channel');

    // --- Server Config ---
    const scToggle = document.getElementById('sc-toggle');
    const scFields = document.getElementById('sc-fields');

    function setScEnabled(enabled) {
        scToggle.checked = enabled;
        scFields.classList.toggle('hidden', !enabled);
    }

    function fillScFields(cfg) {
        document.getElementById('sc-ai-endpoint').value = cfg.ai_endpoint ?? '';
        document.getElementById('sc-base-llm').value = cfg.base_llm ?? '';
        document.getElementById('sc-fallback-llm').value = cfg.fallback_llm ?? '';
        document.getElementById('sc-temperature').value = cfg.temperature ?? '';
        document.getElementById('sc-max-tokens').value = cfg.max_tokens ?? '';
        document.getElementById('sc-history-limit').value = cfg.history_limit ?? '';
        document.getElementById('sc-auto-cap').value = cfg.auto_cap ?? '';
        document.getElementById('sc-token-limit-tpm').value = cfg.token_limit_tpm ?? '';
        document.getElementById('sc-token-limit-tpd').value = cfg.token_limit_tpd ?? '';
        document.getElementById('sc-use-prefill').value = cfg.use_prefill != null ? String(cfg.use_prefill) : '';
    }

    function clearScFields() {
        ['sc-ai-endpoint','sc-base-llm','sc-fallback-llm','sc-temperature',
            'sc-max-tokens','sc-history-limit','sc-auto-cap',
            'sc-token-limit-tpm','sc-token-limit-tpd'].forEach(id => {
            document.getElementById(id).value = '';
        });
        document.getElementById('sc-use-prefill').value = '';
    }

    function hasAnyOverride(cfg) {
        const aiFields = ['ai_endpoint','base_llm','fallback_llm','temperature','max_tokens',
                          'history_limit','auto_cap','use_prefill','token_limit_tpm','token_limit_tpd'];
        return aiFields.some(f => cfg[f] !== null && cfg[f] !== undefined);
    }

    function populateDefaultCharacterSelector(selectedCharacter = '') {
        const sel = (selectedCharacter || '').trim();
        const use = sel && availableCharacters.includes(sel) ? sel : '';
        defaultCharacterInput.value = use;
        if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(defaultCharacterInput);
    }

    function updateDefaultCharacterStatus() {
        const selected = defaultCharacterInput.value;
        if (selected) {
            defaultCharacterStatus.textContent = `Channel override: ${selected} (channel > server > global).`;
            defaultCharacterStatus.className = 'mt-2 text-xs text-indigo-300';
            return;
        }
        const serverDefault = currentServer?.defaultCharacter;
        if (serverDefault) {
            defaultCharacterStatus.textContent = `Inherited from server default: ${serverDefault} (channel > server > global).`;
        } else {
            const fallback = globalDefaultCharacter || 'None configured';
            defaultCharacterStatus.textContent = `Inherited from global default: ${fallback} (channel > server > global).`;
        }
        defaultCharacterStatus.className = 'mt-2 text-xs text-gray-400';
    }

    async function loadCharactersForServer() {
        try {
            const response = await fetch('/api/characters');
            const characters = await response.json();
            availableCharacters = characters.map(c => c.name).sort((a, b) => a.localeCompare(b));
        } catch {
            availableCharacters = [];
            showToast('Failed to load character list.', 'error');
        }
    }

    async function loadGlobalDefaultCharacter() {
        try {
            const globalCfg = await fetch('/api/config/').then(r => r.json());
            globalDefaultCharacter = globalCfg.default_character || '';
        } catch {
            globalDefaultCharacter = '';
        }
    }

    async function loadServerDefaultCharacter(serverId) {
        try {
            const cfg = await fetch(`${API_BASE}/${serverId}/config`).then(r => r.json());
            return cfg.default_character || '';
        } catch { return ''; }
    }

    function populateSrvDefaultCharacterSelector(selectedCharacter = '') {
        const sel = (selectedCharacter || '').trim();
        const use = sel && availableCharacters.includes(sel) ? sel : '';
        srvDefaultCharacterInput.value = use;
        if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(srvDefaultCharacterInput);
    }

    function updateSrvDefaultCharacterStatus() {
        const selected = srvDefaultCharacterInput.value;
        if (selected) {
            srvDefaultCharacterStatus.textContent = `Server default: ${selected}. Channels inherit this unless they override it.`;
            srvDefaultCharacterStatus.className = 'mt-2 text-xs text-indigo-300';
        } else {
            const fallback = globalDefaultCharacter || 'None configured';
            srvDefaultCharacterStatus.textContent = `Inheriting global default: ${fallback}.`;
            srvDefaultCharacterStatus.className = 'mt-2 text-xs text-gray-400';
        }
    }

    async function openServerEditModal(server) {
        if (!canEditServers()) {
            showToast('You do not have permission to edit server settings.', 'error');
            return;
        }
        currentServer = { ...currentServer, id: server.server_id, name: server.server_name };
        serverEditTitle.textContent = server.server_name;
        serverEditModal.classList.remove('hidden');
        await Promise.all([loadGlobalDefaultCharacter(), loadCharactersForServer()]);
        const serverDefault = await loadServerDefaultCharacter(server.server_id);
        currentServer.defaultCharacter = serverDefault;
        populateSrvDefaultCharacterSelector(serverDefault);
        updateSrvDefaultCharacterStatus();
        await loadServerConfig(server.server_id);
    }

    document.getElementById('close-server-edit-modal-btn').addEventListener('click', () => serverEditModal.classList.add('hidden'));
    srvDefaultCharacterInput.addEventListener('change', updateSrvDefaultCharacterStatus);
    document.getElementById('srv-save-character-btn').addEventListener('click', async () => {
        if (!currentServer) return;
        const raw = (srvDefaultCharacterInput.value || '').trim();
        if (raw && !availableCharacters.includes(raw)) {
            showToast('Choose a character from the list or clear the field to inherit global default.', 'error');
            return;
        }
        const value = raw || null;
        try {
            const resp = await fetch(`${API_BASE}/${currentServer.id}/config`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ default_character: value })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            currentServer.defaultCharacter = value || '';
            showToast('Server default character saved.');
        } catch (e) { showToast(`Failed to save: ${e.message}`, 'error'); }
    });

    async function loadServerConfig(serverId) {
        try {
            const cfg = await fetch(`${API_BASE}/${serverId}/config`).then(r => r.json());
            if (hasAnyOverride(cfg)) {
                fillScFields(cfg);
                setScEnabled(true);
            } else {
                clearScFields();
                setScEnabled(false);
            }
        } catch { showToast('Failed to load server config.', 'error'); }
    }

    scToggle.addEventListener('change', async () => {
        if (!currentServer) { scToggle.checked = false; return; }
        if (scToggle.checked) {
            try {
                const globalCfg = await fetch('/api/config/').then(r => r.json());
                fillScFields({
                    ai_endpoint: globalCfg.ai_endpoint,
                    base_llm: globalCfg.base_llm,
                    fallback_llm: globalCfg.fallback_llm,
                    temperature: globalCfg.temperature,
                    max_tokens: globalCfg.max_tokens,
                    history_limit: globalCfg.history_limit,
                    auto_cap: globalCfg.auto_cap,
                    token_limit_tpm: globalCfg.token_limit_tpm,
                    token_limit_tpd: globalCfg.token_limit_tpd,
                    use_prefill: globalCfg.use_prefill,
                });
                setScEnabled(true);
            } catch {
                showToast('Failed to load global config.', 'error');
                scToggle.checked = false;
            }
        } else {
            if (!confirm('Remove all overrides for this server?')) {
                scToggle.checked = true;
                return;
            }
            try {
                const resp = await fetch(`${API_BASE}/${currentServer.id}/config`, { method: 'DELETE' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                clearScFields();
                setScEnabled(false);
                showToast('Server overrides removed.');
            } catch (e) {
                showToast(`Failed to remove overrides: ${e.message}`, 'error');
                scToggle.checked = true;
            }
        }
    });

    document.getElementById('server-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentServer || !scToggle.checked) return;
        const num = (id) => { const v = document.getElementById(id).value; return v !== '' ? Number(v) : null; };
        const str = (id) => document.getElementById(id).value.trim() || null;
        const payload = Object.fromEntries(Object.entries({
            ai_endpoint: str('sc-ai-endpoint'),
            base_llm: str('sc-base-llm'),
            fallback_llm: str('sc-fallback-llm'),
            temperature: num('sc-temperature'),
            max_tokens: num('sc-max-tokens'),
            history_limit: num('sc-history-limit'),
            auto_cap: num('sc-auto-cap'),
            token_limit_tpm: num('sc-token-limit-tpm'),
            token_limit_tpd: num('sc-token-limit-tpd'),
            use_prefill: (() => { const v = document.getElementById('sc-use-prefill').value; return v !== '' ? v === 'true' : null; })(),
        }).filter(([, v]) => v !== null));
        if (!isValidHttpUrl(payload.ai_endpoint || '')) {
            showToast('API Endpoint must be a valid http/https URL.', 'error');
            return;
        }
        const rangeChecks = [
            ['temperature', 0, 2],
            ['max_tokens', 64, 4096],
            ['history_limit', 1, 50],
            ['auto_cap', 0, Infinity],
            ['token_limit_tpm', 0, Infinity],
            ['token_limit_tpd', 0, Infinity],
        ];
        for (const [key, min, max] of rangeChecks) {
            const value = payload[key];
            if (value == null) continue;
            if (value < min || value > max) {
                showToast(`${key} must be between ${min} and ${max === Infinity ? 'infinity' : max}.`, 'error');
                return;
            }
        }
        try {
            const delResp = await fetch(`${API_BASE}/${currentServer.id}/config`, { method: 'DELETE' });
            if (!delResp.ok) throw new Error(`DELETE HTTP ${delResp.status}`);
            if (Object.keys(payload).length) {
                const patchResp = await fetch(`${API_BASE}/${currentServer.id}/config`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!patchResp.ok) throw new Error(`PATCH HTTP ${patchResp.status}`);
            }
            showToast('Server overrides saved.');
        } catch (e) { showToast(`Failed to save: ${e.message}`, 'error'); }
    });

    async function fetchServers() {
        try {
            const response = await fetch(API_BASE);
            const servers = await response.json();
            serverList.innerHTML = '';
            servers.forEach(server => {
                const li = document.createElement('li');
                li.className = 'list-item relative flex items-center w-full px-4 py-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 group';
                li.dataset.serverId = server.server_id;

                const nameSpan = document.createElement('span');
                nameSpan.textContent = server.server_name;
                nameSpan.className = 'truncate min-w-0 pr-8';

                const editBtn = document.createElement('button');
                editBtn.innerHTML = '<i class="fas fa-cog"></i>';
                editBtn.className = 'absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity';
                editBtn.title = 'Server settings';
                if (!canEditServers()) {
                    editBtn.classList.add('hidden');
                }
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openServerEditModal(server);
                });

                li.appendChild(nameSpan);
                li.appendChild(editBtn);
                li.addEventListener('click', () => {
                    document.querySelectorAll('#server-list .list-item').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    fetchChannels(server.server_id, server.server_name);
                });
                serverList.appendChild(li);
            });
        } catch (error) { showToast('Failed to load servers.', 'error'); }
    }

    async function fetchChannels(serverId, serverName) {
        channelEditModal.classList.add('hidden');
        channelListTitle.textContent = serverName;
        channelPanel.classList.remove('hidden');
        await Promise.all([loadGlobalDefaultCharacter(), loadCharactersForServer()]);
        const serverDefault = await loadServerDefaultCharacter(serverId);
        currentServer = { id: serverId, name: serverName, defaultCharacter: serverDefault };
        
        try {
            const response = await fetch(`${API_BASE}/${serverId}/channels`);
            const channels = await response.json();
            channelList.innerHTML = '';
            if (channels.length === 0) {
                channelList.innerHTML = `<li class="text-gray-500">No channels registered.</li>`;
            }
            channels.forEach(channel => {
                const li = document.createElement('li');
                li.className = 'list-item relative flex items-center w-full px-4 py-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 group';
                li.dataset.channelId = channel.channel_id;

                const nameSpan = document.createElement('span');
                nameSpan.textContent = channel.data.name;
                nameSpan.className = 'truncate min-w-0 pr-6';

                const removeBtn = document.createElement('button');
                removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                removeBtn.className = 'absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity';
                removeBtn.title = 'Unregister channel';
                if (!canEditServers()) {
                    removeBtn.classList.add('hidden');
                }
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!canEditServers()) {
                        showToast('You do not have permission to unregister channels.', 'error');
                        return;
                    }
                    if (!confirm(`Unregister "${channel.data.name}"?`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/${currentServer.id}/channels/${channel.channel_id}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error();
                        showToast('Channel unregistered.');
                        if (currentChannel?.channel_id === channel.channel_id) {
                            currentChannel = null;
                            channelEditModal.classList.add('hidden');
                        }
                        fetchChannels(currentServer.id, currentServer.name);
                    } catch { showToast('Failed to unregister channel.', 'error'); }
                });

                li.appendChild(nameSpan);
                li.appendChild(removeBtn);
                li.addEventListener('click', () => {
                    document.querySelectorAll('#channel-list .list-item').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    loadChannelForEdit(channel);
                });
                channelList.appendChild(li);
            });
        } catch (error) { showToast('Failed to load channels.', 'error'); }
    }

    function loadChannelForEdit(channel) {
        currentChannel = channel;
        channelEditModal.classList.remove('hidden');
        formTitle.textContent = `Editing #${channel.data.name}`;

        const isDM = currentServer.id === 'DM_VIRTUAL_SERVER';
        document.getElementById('whitelist-field').classList.toggle('hidden', isDM);
        document.getElementById('system-channel-field').classList.toggle('hidden', isDM);

        nameInput.value = channel.data.name || '';
        populateDefaultCharacterSelector(channel.data.default_character || '');
        updateDefaultCharacterStatus();
        whitelistInput.value = (channel.data.whitelist || []).join(', ');
        isSystemChannelInput.checked = channel.data.is_system_channel || false;
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        if (!canEditServers()) {
            showToast('You do not have permission to edit channels.', 'error');
            return;
        }
        if (!currentChannel || !currentServer) return;
        if (!nameInput.value.trim()) {
            showToast('Channel name cannot be empty.', 'error');
            return;
        }

        const isDM = currentServer.id === 'DM_VIRTUAL_SERVER';
        const dcRaw = (defaultCharacterInput.value || '').trim();
        if (dcRaw && !availableCharacters.includes(dcRaw)) {
            showToast('Choose a character from the list or clear the field to inherit server default.', 'error');
            return;
        }
        const updatedData = {
            name: nameInput.value,
            instruction: currentChannel?.data?.instruction || null,
            default_character: dcRaw || null,
            global: null,
            whitelist: isDM ? [] : whitelistInput.value.split(',').map(s => s.trim()).filter(Boolean),
            is_system_channel: isDM ? false : isSystemChannelInput.checked
        };
        
        try {
            const response = await fetch(`${API_BASE}/${currentServer.id}/channels/${currentChannel.channel_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to save.');
            }
            channelEditModal.classList.add('hidden');
            showToast(`Channel #${updatedData.name} saved successfully!`);
            await fetchChannels(currentServer.id, currentServer.name); // Refresh list
        } catch (error) { showToast(`Error: ${error.message}`, 'error'); }
    }
    // Channel modal
    addChannelBtn.addEventListener('click', () => {
        if (!canEditServers()) {
            showToast('You do not have permission to add channels.', 'error');
            return;
        }
        addChannelModal.classList.remove('hidden');
    });
    closeModalBtn.addEventListener('click', () => addChannelModal.classList.add('hidden'));

    // Invite modal
    const inviteModal = document.getElementById('invite-modal');
    const inviteLinkContainer = document.getElementById('invite-link-container');
    addServerBtn.addEventListener('click', async () => {
        inviteLinkContainer.innerHTML = '<p class="text-gray-500 text-sm">Loading invite link...</p>';
        inviteModal.classList.remove('hidden');
        try {
            const res = await fetch('/api/discord/invite');
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    inviteLinkContainer.innerHTML = '<p class="text-red-400 text-sm">You do not have permission to view invite link.</p>';
                    return;
                }
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            if (data.invite) {
                inviteLinkContainer.innerHTML = `
                    <a href="${data.invite}" target="_blank" rel="noopener noreferrer"
                        class="servers-invite-link">
                        <i class="fas fa-external-link-alt"></i> Open Invite Link
                    </a>
                    <p class="text-gray-600 text-xs mt-3 break-all">${data.invite}</p>`;
            } else {
                inviteLinkContainer.innerHTML = `<p class="text-red-400 text-sm">${data.message || 'Bot is not running yet.'}</p>`;
            }
        } catch {
            inviteLinkContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to fetch invite link.</p>';
        }
    });
    document.getElementById('close-invite-modal-btn').addEventListener('click', () => inviteModal.classList.add('hidden'));

    function wireDefaultCharacterCombos() {
        if (typeof setupFilterCombobox !== 'function') return;
        setupFilterCombobox(
            'default-character',
            'default-character-dd',
            () => availableCharacters,
            () => updateDefaultCharacterStatus(),
            () => updateDefaultCharacterStatus(),
            'hover:bg-gray-700'
        );
        setupFilterCombobox(
            'srv-default-character',
            'srv-default-character-dd',
            () => availableCharacters,
            () => updateSrvDefaultCharacterStatus(),
            () => updateSrvDefaultCharacterStatus(),
            'hover:bg-gray-700'
        );
    }

    // Form listener
    defaultCharacterInput.addEventListener('change', updateDefaultCharacterStatus);
    form.addEventListener('submit', handleFormSubmit);
    wireDefaultCharacterCombos();
    closeChannelEditModalBtn.addEventListener('click', () => channelEditModal.classList.add('hidden'));

    // Initial Load
    fetch('/api/auth-status')
        .then(r => r.json())
        .then(d => {
            currentUserRole = d?.current_user?.role || (d?.panel_auth_enabled ? 'guest' : 'super_admin');
        })
        .catch(() => {})
        .finally(() => fetchServers());
});