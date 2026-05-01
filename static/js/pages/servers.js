document.addEventListener('DOMContentLoaded', function() {
    const API_BASE = '/api/servers';
    let currentServer = null;
    let currentChannel = null;

    // DOM Elements
    const serverList = document.getElementById('server-list');
    const channelPanel = document.getElementById('channel-panel');
    const channelListTitle = document.getElementById('channel-list-title');
    const channelList = document.getElementById('channel-list');
    const configPanel = document.getElementById('config-panel');
    const form = document.getElementById('channel-form');
    const formTitle = document.getElementById('form-title');
    const addChannelBtn = document.getElementById('add-channel-btn');
    const addServerBtn = document.getElementById('add-server-btn');
    const addChannelModal = document.getElementById('add-channel-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const toastContainer = document.getElementById('toast-container');

    // Form fields
    const nameInput = document.getElementById('name');
    const instructionInput = document.getElementById('instruction');
    const whitelistInput = document.getElementById('whitelist');
    const isSystemChannelInput = document.getElementById('is_system_channel');
    const serverConfigPanel = document.getElementById('server-config-panel');

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
        return Object.values(cfg).some(v => v !== null && v !== undefined);
    }

    async function loadServerConfig(serverId) {
        serverConfigPanel.classList.remove('hidden');
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
                li.className = 'list-item px-4 py-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700';
                li.textContent = server.server_name;
                li.dataset.serverId = server.server_id;
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
        currentServer = { id: serverId, name: serverName };
        configPanel.classList.add('hidden');
        channelListTitle.textContent = serverName;
        channelPanel.classList.remove('hidden');
        loadServerConfig(serverId);

        try {
            const response = await fetch(`${API_BASE}/${serverId}/channels`);
            const channels = await response.json();
            channelList.innerHTML = '';
            if (channels.length === 0) {
                channelList.innerHTML = `<li class="text-gray-500">No channels registered.</li>`;
            }
            channels.forEach(channel => {
                const li = document.createElement('li');
                li.className = 'list-item px-4 py-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700';
                li.textContent = channel.data.name;
                li.dataset.channelId = channel.channel_id;
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
        configPanel.classList.remove('hidden');
        formTitle.textContent = `Editing #${channel.data.name}`;

        const isDM = currentServer.id === 'DM_VIRTUAL_SERVER';
        document.getElementById('whitelist-field').classList.toggle('hidden', isDM);
        document.getElementById('system-channel-field').classList.toggle('hidden', isDM);

        nameInput.value = channel.data.name || '';
        instructionInput.value = channel.data.instruction || '';
        whitelistInput.value = (channel.data.whitelist || []).join(', ');
        isSystemChannelInput.checked = channel.data.is_system_channel || false;
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        if (!currentChannel || !currentServer) return;

        const isDM = currentServer.id === 'DM_VIRTUAL_SERVER';
        const updatedData = {
            name: nameInput.value,
            instruction: instructionInput.value,
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
            showToast(`Channel #${updatedData.name} saved successfully!`);
            await fetchChannels(currentServer.id, currentServer.name); // Refresh list
        } catch (error) { showToast(`Error: ${error.message}`, 'error'); }
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
        toast.className = `toast ${bgColor} text-white py-2 px-4 rounded-lg shadow-lg animate-pulse`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 3000);
    }

    // Channel modal
    addChannelBtn.addEventListener('click', () => addChannelModal.classList.remove('hidden'));
    closeModalBtn.addEventListener('click', () => addChannelModal.classList.add('hidden'));

    // Invite modal
    const inviteModal = document.getElementById('invite-modal');
    const inviteLinkContainer = document.getElementById('invite-link-container');
    addServerBtn.addEventListener('click', async () => {
        inviteLinkContainer.innerHTML = '<p class="text-gray-500 text-sm">Loading invite link...</p>';
        inviteModal.classList.remove('hidden');
        try {
            const data = await fetch('/api/discord/invite').then(r => r.json());
            if (data.invite) {
                inviteLinkContainer.innerHTML = `
                    <a href="${data.invite}" target="_blank" rel="noopener noreferrer"
                       class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-5 rounded-lg">
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

    // Form listener
    form.addEventListener('submit', handleFormSubmit);

    // Initial Load
    fetchServers();
});
