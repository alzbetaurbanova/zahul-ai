document.addEventListener('DOMContentLoaded', () => {
    // Resolved with the role string once auth-status is known; used to gate loadConfig.
    const _authReady = (window.__authStatus || fetch('/api/auth-status').then(r => r.json()))
        .then(d => {
            const role = d?.current_user?.role;
            const allowed = role === 'super_admin' || role === 'admin' || role === 'mod';
            if (d?.panel_auth_enabled && !allowed) {
                window.location.href = '/';
            }
            if (role === 'admin' || role === 'mod') {
                currentUserRole = role;
                document.querySelectorAll('.ai-superadmin-tab').forEach(t => {
                    t.disabled = true;
                    t.classList.add('opacity-40', 'cursor-not-allowed');
                    t.title = 'Super admin access only';
                });
                switchTab('providers');
            }
            return role;
        })
        .catch(() => null);

    const CONFIG_API_BASE = '/api/config';

    // --- DOM Elements ---
    const form = document.getElementById('config-form');
    const toastContainer = document.getElementById('toast-container');
    const multiModelToggle = document.getElementById('multi_model_enable');
    const multiModelOptions = document.getElementById('multi-model-options');

    // Security Elements
    const panelAuthToggle = document.getElementById('panel_auth_enabled');
    const discordLoginToggle = document.getElementById('discord_login_enabled');
    const localLoginToggle = document.getElementById('local_login_enabled');
    const panelAuthMasterWrap = document.getElementById('panel-auth-master-wrap');
    const panelAuthMasterNote = document.getElementById('panel-auth-master-note');
    const currentSuperAdminUsername = document.getElementById('current-super-admin-username');
    const discordOauthWarning = document.getElementById('discord-oauth-warning');
    const discordOauthFields = document.getElementById('discord-oauth-fields');
    const superAdminAccountSection = document.getElementById('super-admin-account-section');
    const saveSecurityBtn = document.getElementById('save-security-btn');
    const saveAdminBtn = document.getElementById('save-admin-btn');
    const loginAccessSection = document.getElementById('login-access-section');
    const panelPasswordInput = document.getElementById('panel_password');
    const superAdminUsernameInput = document.getElementById('super_admin_username');
    let hasLocalSuperAdmin = false;
    let authStatus = null;
    let currentUserRole = 'guest';
    let discordOauthConfiguredOnServer = false;

    function isSuperAdmin() {
        return currentUserRole === 'super_admin';
    }

    // DM Access Control Elements
    const dmToggle = document.getElementById('dm_toggle');
    const dmFields = document.getElementById('dm-fields');

    // Map keys to element IDs for easy access
    const fieldIds = [
        'default_character', 'ai_endpoint', 'base_llm', 'primary_allowed_models', 'temperature', 'auto_cap',
        'history_limit', 'max_tokens',
        'fallback_llm', 'fallback_duration', 'token_limit_tpm', 'token_limit_tpd',
        'ai_key', 'discord_key', 'use_prefill', 'dm_list',
        'multi_model_enable', 'multi_model_ai_model', 'multi_model_ai_provider',
        'public_url', 'discord_oauth_client_id', 'discord_oauth_client_secret', 'discord_oauth_redirect_uri',
        'panel_auth_enabled', 'discord_login_enabled', 'local_login_enabled',
        'notify_contacts', 'notify_channel_id',
    ];
    const ARRAY_TEXTAREA_FIELDS = new Set(['dm_list', 'primary_allowed_models', 'notify_contacts']);
    const elements = Object.fromEntries(fieldIds.map(id => [id, document.getElementById(id)]));
    const MIN_PANEL_PASSWORD_LENGTH = 8;

    // --- Config Functions ---
    async function loadConfig() {
        try {
            const response = await fetch(CONFIG_API_BASE);
            if (response.status === 403) {
                // non-super_admin: load providers from the open endpoint so existing cards render read-only
                try {
                    const provRes = await fetch(`${CONFIG_API_BASE}/providers`);
                    if (provRes.ok) {
                        const providers = await provRes.json();
                        renderProviders(providers);
                    }
                } catch (_) {}
                document.getElementById('setup-loader')?.classList.add('hidden');
                // Ensure providers form shows even if the fetch above failed
                document.getElementById('providers-tab-loader')?.classList.add('hidden');
                document.getElementById('providers-form')?.classList.remove('hidden');
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch config.');
            const config = await response.json();

            for (const key in config) {
                if (key === 'base_llm' || key === 'fallback_llm' || key === 'fallback_llm_source') continue;
                if (elements[key]) {
                    if (elements[key].type === 'checkbox') {
                        elements[key].checked = config[key];
                    } else if (ARRAY_TEXTAREA_FIELDS.has(key) && Array.isArray(config[key])) {
                        elements[key].value = config[key].join('\n');
                    } else if (elements[key].type !== 'password') {
                        elements[key].value = config[key];
                    }
                }
            }
            renderProviders(Array.isArray(config.multi_model_providers) ? config.multi_model_providers : []);
            const fbSource = config.fallback_llm_source || inferFallbackSource(config.fallback_llm);
            setAiModelField('base_llm', config.base_llm, 'primary');
            setAiModelField('fallback_llm', config.fallback_llm, fbSource);
            toggleMultiModelOptions();
            const dmVal = elements['dm_list'] ? elements['dm_list'].value.trim() : '';
            dmToggle.checked = dmVal.length > 0;
            toggleDmFields();
            updateRedirectUriHint();
            document.getElementById('setup-loader')?.classList.add('hidden');
            document.getElementById('setup-content')?.classList.remove('hidden');
        } catch (error) {
            showToast(error.message, 'error');
            document.getElementById('setup-loader')?.classList.add('hidden');
            document.getElementById('setup-content')?.classList.remove('hidden');
        }
    }

    async function loadSecurityStatus() {
        try {
            const response = await fetch('/api/auth-status');
            if (!response.ok) return;
            authStatus = await response.json();
            currentUserRole = authStatus?.current_user?.role || (authStatus?.panel_auth_enabled ? 'guest' : 'super_admin');
            discordOauthConfiguredOnServer = !!authStatus.discord_oauth_configured;
            panelAuthToggle.checked = !!authStatus.panel_auth_enabled;
            discordLoginToggle.checked = !!authStatus.discord_login_enabled;
            localLoginToggle.checked = !!authStatus.local_login_enabled;
            const allowedTextarea = document.getElementById('discord_allowed_usernames');
            if (allowedTextarea && Array.isArray(authStatus.discord_allowed_usernames)) {
                allowedTextarea.value = authStatus.discord_allowed_usernames.join('\n');
            }
            await loadSuperAdmin();
            updateMethodVisibility();
        } catch (error) {
            // Silently ignore
        }
    }

    async function loadSuperAdmin() {
        const superAdminRes = await fetch('/api/auth-super-admin');
        if (!superAdminRes.ok) return;
        const superAdminData = await superAdminRes.json();
        const username = (superAdminData.username || '').trim();
        hasLocalSuperAdmin =
            !!superAdminData.has_local_super_admin || !!superAdminData.has_super_admin_password;
        currentSuperAdminUsername.textContent = username || 'Not set';
        if (username) {
            superAdminUsernameInput.value = username;
        }
    }

    async function handleConfigSubmit(event) {
        event.preventDefault();
        const temperatureValue = parseFloat(elements['temperature'].value);
        if (!Number.isNaN(temperatureValue) && (temperatureValue < 0 || temperatureValue > 2)) {
            switchToTabForField('temperature');
            showToast('Temperature must be between 0 and 2.', 'error');
            return;
        }
        for (const urlField of ['ai_endpoint', 'public_url', 'discord_oauth_redirect_uri']) {
            const raw = elements[urlField]?.value?.trim() || '';
            if (raw && !isValidHttpUrl(raw)) {
                switchToTabForField(urlField);
                showToast(`${urlField.replaceAll('_', ' ')} must be a valid http/https URL.`, 'error');
                return;
            }
        }
        for (const card of document.querySelectorAll('.provider-card')) {
            const ep = card.querySelector('.provider-endpoint')?.value?.trim() || '';
            if (ep && !isValidHttpUrl(ep)) {
                showToast('Each provider endpoint must be a valid http/https URL.', 'error');
                return;
            }
        }

        const configData = {};
        for (const key of fieldIds) {
            if (elements[key]) {
                if (elements[key].type === 'checkbox') {
                    configData[key] = elements[key].checked;
                } else if (ARRAY_TEXTAREA_FIELDS.has(key)) {
                    configData[key] = elements[key].value
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line !== '');
                } else if (elements[key].type === 'number') {
                    configData[key] = parseFloat(elements[key].value);
                } else {
                    configData[key] = elements[key].value;
                }
            }
        }
        configData['multi_model_providers'] = getProvidersFromDOM();
        configData['base_llm'] = getAiConfigModelValue('base_llm', 'primary');
        configData['fallback_llm'] = getAiConfigModelValue('fallback_llm', 'primary');
        configData['fallback_llm_source'] = (
            document.getElementById('fallback_llm-source')?.value || ''
        ).trim() || 'primary';
        configData['fallback_use_different_endpoint'] = false;
        configData['fallback_ai_endpoint'] = '';
        configData['fallback_ai_key'] = '';
        configData['fallback_allowed_models'] = [];

        try {
            const response = await fetch(CONFIG_API_BASE, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to save config.');
            }

            showToast('Configuration saved successfully!');
            checkEncryptionStatus();

            // Clear password fields after save for security
            elements['ai_key'].value = '';
            elements['discord_key'].value = '';
            elements['discord_oauth_client_secret'].value = '';
            document.querySelectorAll('.provider-apikey').forEach(el => { el.value = ''; });
            await loadSecurityStatus();
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    function updateMasterToggleState() {
        const anyMethodEnabled = discordLoginToggle.checked || localLoginToggle.checked;
        panelAuthToggle.disabled = !anyMethodEnabled;
        panelAuthMasterWrap.classList.toggle('opacity-60', !anyMethodEnabled);
        panelAuthMasterNote.classList.toggle('hidden', anyMethodEnabled);
        if (!anyMethodEnabled) panelAuthToggle.checked = false;
    }

    function updateRedirectUriHint() {
        const base = (elements.public_url?.value || '').trim().replace(/\/$/, '');
        const hintEl = document.getElementById('redirect-uri-hint');
        const valueEl = document.getElementById('redirect-uri-value');
        if (!base || !hintEl || !valueEl) { hintEl?.classList.add('hidden'); return; }
        const full = `${base}/auth/discord/callback`;
        valueEl.textContent = full;
        valueEl.onclick = () => navigator.clipboard.writeText(full).then(() => {
            const orig = valueEl.textContent;
            valueEl.textContent = 'Copied!';
            setTimeout(() => { valueEl.textContent = orig; }, 1200);
        });
        hintEl.classList.remove('hidden');
    }

    function updateDiscordOauthWarning() {
        const configuredInForm = !!(elements.discord_oauth_client_id.value.trim()
            && elements.discord_oauth_redirect_uri.value.trim());
        const configured = discordOauthConfiguredOnServer || configuredInForm;
        discordOauthWarning.classList.toggle('hidden', configured || !discordLoginToggle.checked);
    }

    function updateMethodVisibility(autoEnablePanel = false) {
        discordOauthFields.classList.toggle('hidden', !discordLoginToggle.checked);
        superAdminAccountSection.classList.toggle('hidden', !localLoginToggle.checked);
        updateDiscordOauthWarning();
        updateMasterToggleState();
        if (autoEnablePanel && (discordLoginToggle.checked || localLoginToggle.checked)) {
            panelAuthToggle.checked = true;
        }
    }

    async function handleAdminSave() {
        if (panelPasswordInput.value && panelPasswordInput.value.length < MIN_PANEL_PASSWORD_LENGTH) {
            showToast(`Panel password must be at least ${MIN_PANEL_PASSWORD_LENGTH} characters.`, 'error');
            return;
        }
        if (!superAdminUsernameInput.value.trim()) {
            showToast('Super admin username is required.', 'error');
            return;
        }
        if (!panelPasswordInput.value) {
            showToast('Super admin password is required.', 'error');
            return;
        }
        const configData = {
            username: superAdminUsernameInput.value.trim(),
            panel_password: panelPasswordInput.value
        };
        try {
            const response = await fetch('/api/config/security', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configData)
            });
            if (!response.ok) {
                const error = await response.json();
                const msg = typeof error.detail === 'string'
                    ? error.detail
                    : 'Failed to save security config.';
                throw new Error(msg);
            }
            const isAuthOn = panelAuthToggle.checked;
            panelPasswordInput.value = '';
            if (isAuthOn) {
                showToast('Credentials updated. Redirecting to login…');
                setTimeout(() => { window.location.href = '/logout'; }, 1200);
            } else {
                showToast('Super admin account saved.');
                await loadSuperAdmin();
                updateMasterToggleState();
            }
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    async function handleSecuritySave() {
        const redirectUri = elements.discord_oauth_redirect_uri?.value?.trim() || '';
        const isLocalhostHttp = redirectUri.startsWith('http://localhost') || redirectUri.startsWith('http://127.0.0.1');
        if (redirectUri && !redirectUri.startsWith('https://') && !isLocalhostHttp) {
            showToast('Redirect URI must start with https:// (or http:// for localhost)', 'error');
            return;
        }
        if (panelAuthToggle.checked && !discordLoginToggle.checked && !localLoginToggle.checked) {
            showToast('At least one login method must be enabled.', 'error');
            return;
        }
        const allowedRaw = document.getElementById('discord_allowed_usernames')?.value || "";
        const allowedList = allowedRaw.split('\n').map(s => s.trim()).filter(s => s);
        if (discordLoginToggle.checked && allowedList.length < 1) {
            showToast('Discord login requires at least one trusted username.', 'error');
            return;
        }
        const payload = {
            panel_auth_enabled: panelAuthToggle.checked,
            discord_login_enabled: discordLoginToggle.checked,
            local_login_enabled: localLoginToggle.checked,
            discord_oauth_client_id: elements.discord_oauth_client_id?.value?.trim() || "",
            discord_oauth_client_secret: elements.discord_oauth_client_secret?.value?.trim() || "",
            discord_oauth_redirect_uri: elements.discord_oauth_redirect_uri?.value?.trim() || "",
            discord_allowed_usernames: allowedList,
        };
        try {
            const response = await fetch('/api/config/security/methods', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to save security settings.');
            }
            if (payload.panel_auth_enabled) {
                showToast('Security enabled. Redirecting to login…');
                setTimeout(() => { window.location.href = '/logout'; }, 1200);
            } else {
                showToast('Security settings saved.');
            }
        } catch (error) {
            showToast(error.message, 'error');
            await loadSecurityStatus();
        }
    }

    function toggleDmFields() {
        if (dmToggle.checked) {
            dmFields.classList.remove('hidden');
        } else {
            dmFields.classList.add('hidden');
        }
    }

    function toggleMultiModelOptions() {
        multiModelOptions.classList.toggle('hidden', !multiModelToggle.checked);
    }

    // --- Tabs ---
    const TABS = ['setup', 'providers', 'discord', 'security'];
    const FIELD_TAB = {
        ai_endpoint: 'setup', base_llm: 'setup', primary_allowed_models: 'setup',
        ai_key: 'setup', history_limit: 'setup', max_tokens: 'setup',
        temperature: 'setup', auto_cap: 'setup',
        fallback_llm: 'setup', fallback_duration: 'setup', token_limit_tpm: 'setup',
        token_limit_tpd: 'setup', use_prefill: 'setup', multi_model_enable: 'setup',
        multi_model_ai_model: 'setup',
        discord_key: 'discord', public_url: 'discord', default_character: 'discord', dm_list: 'discord',
    };
    let activeTab = 'setup';

    function switchTab(tabId) {
        if (!TABS.includes(tabId)) return;
        const btn = document.querySelector(`[data-tab="${tabId}"]`);
        if (btn && btn.disabled) return;
        activeTab = tabId;
        TABS.forEach(t => {
            document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== tabId);
            document.querySelector(`[data-tab="${t}"]`)?.classList.toggle('tab-active', t === tabId);
        });
        if (history.replaceState) history.replaceState(null, '', `#${tabId}`);
    }

    function switchToTabForField(fieldId) {
        const tab = FIELD_TAB[fieldId];
        if (tab && tab !== activeTab) switchTab(tab);
    }

    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const hash = location.hash.replace('#', '');
    if (TABS.includes(hash)) switchTab(hash);

    // --- Event Listeners ---
    form.addEventListener('submit', handleConfigSubmit);
    multiModelToggle.addEventListener('change', toggleMultiModelOptions);
    saveSecurityBtn.addEventListener('click', handleSecuritySave);
    saveAdminBtn.addEventListener('click', handleAdminSave);
    discordLoginToggle.addEventListener('change', () => {
        if (!discordLoginToggle.checked) {
            const modal = document.getElementById('confirm-disable-discord-modal');
            const msg = document.getElementById('confirm-disable-discord-msg');
            msg.textContent = localLoginToggle.checked
                ? hasLocalSuperAdmin
                    ? 'Discord OAuth login will be disabled. You can still log in with your username and password.'
                    : 'Discord OAuth login will be disabled. Save a super admin username and password (Unique account login) first, or you may be locked out.'
                : 'Discord OAuth login will be disabled. You have no other login method enabled - panel protection will be turned off.';
            modal.classList.remove('hidden');
            document.getElementById('confirm-disable-discord-cancel').onclick = () => {
                discordLoginToggle.checked = true;
                modal.classList.add('hidden');
            };
            document.getElementById('confirm-disable-discord-confirm').onclick = () => {
                if (localLoginToggle.checked && !hasLocalSuperAdmin) {
                    showToast(
                        'Save a super admin username and password first, then disable Discord login.',
                        'error',
                    );
                    discordLoginToggle.checked = true;
                    modal.classList.add('hidden');
                    return;
                }
                modal.classList.add('hidden');
                updateMethodVisibility(true);
            };
            return;
        }
        updateMethodVisibility(true);
    });
    localLoginToggle.addEventListener('change', () => {
        if (localLoginToggle.checked && !hasLocalSuperAdmin) {
            showToast(
                'Turn on unique account login only after saving a super admin username and password (below).',
                'error',
            );
            superAdminAccountSection.classList.remove('hidden');
            superAdminUsernameInput.focus();
        }
        if (!localLoginToggle.checked) {
            const modal = document.getElementById('confirm-disable-local-modal');
            modal.classList.remove('hidden');
            document.getElementById('confirm-disable-local-cancel').onclick = () => {
                localLoginToggle.checked = true;
                modal.classList.add('hidden');
            };
            document.getElementById('confirm-disable-local-confirm').onclick = () => {
                modal.classList.add('hidden');
                updateMethodVisibility(true);
            };
            return;
        }
        updateMethodVisibility(true);
    });
    elements.discord_oauth_client_id.addEventListener('input', updateDiscordOauthWarning);
    elements.discord_oauth_redirect_uri.addEventListener('input', () => {
        updateDiscordOauthWarning();
        const val = elements.discord_oauth_redirect_uri.value.trim();
        const warn = document.getElementById('redirect-uri-https-warn');
        const isLocalHttp = val.startsWith('http://localhost') || val.startsWith('http://127.0.0.1');
        if (warn) warn.classList.toggle('hidden', !val || val.startsWith('https://') || isLocalHttp);
    });
    elements.public_url.addEventListener('input', updateRedirectUriHint);
    dmToggle.addEventListener('change', toggleDmFields);
    document.getElementById('add-provider-btn').addEventListener('click', () => {
        addProviderCard();
        updateProvidersVisibility();
        applyProviderReadonly();
    });
    document.getElementById('providers-form').addEventListener('submit', handleProvidersSave);

    async function handleProvidersSave(event) {
        event.preventDefault();
        for (const card of document.querySelectorAll('.provider-card')) {
            const ep = card.querySelector('.provider-endpoint')?.value?.trim() || '';
            if (ep && !isValidHttpUrl(ep)) {
                showToast('Each provider endpoint must be a valid http/https URL.', 'error');
                return;
            }
        }
        try {
            const saveRes = await fetch(`${CONFIG_API_BASE}/providers`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providers: getProvidersFromDOM() })
            });
            if (!saveRes.ok) {
                const error = await saveRes.json();
                throw new Error(error.detail || 'Failed to save providers.');
            }
            showToast('Providers saved successfully!');
            // Reload provider list so newly added cards get data-existing=true and proper readonly state
            if (currentUserRole === 'mod' || currentUserRole === 'admin') {
                const provRes = await fetch(`${CONFIG_API_BASE}/providers`);
                if (provRes.ok) {
                    const providers = await provRes.json();
                    renderProviders(providers);
                }
            } else {
                document.querySelectorAll('.provider-apikey').forEach(el => { el.value = ''; });
            }
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    // --- Multi Providers ---
    function applyProviderReadonly() {
        const isMod = currentUserRole === 'mod';
        const isAdmin = currentUserRole === 'admin';
        if (!isMod && !isAdmin) return;

        document.querySelectorAll('.provider-card').forEach(card => {
            const isExisting = card.dataset.existing === 'true';

            // No one below super_admin can delete
            const removeBtn = card.querySelector('.provider-remove');
            if (removeBtn && isExisting) {
                removeBtn.disabled = true;
                removeBtn.classList.add('opacity-40', 'cursor-not-allowed');
                removeBtn.title = 'Only super admins can remove providers';
            }

            // Mod can't edit existing cards at all
            if (isMod && isExisting) {
                card.querySelectorAll('input, textarea').forEach(el => { el.disabled = true; });
                card.querySelectorAll('.cb-dd-btn, .provider-key-toggle').forEach(el => {
                    el.disabled = true;
                    el.classList.add('opacity-40', 'cursor-not-allowed');
                });
            }
        });
    }

    function updateProvidersVisibility() {
        const hasCards = document.querySelectorAll('.provider-card').length > 0;
        document.getElementById('providers-fieldset').classList.toggle('hidden', !hasCards);
        document.getElementById('providers-save-row').classList.toggle('hidden', !hasCards);
    }

    function renderProviders(providers) {
        document.getElementById('providers-tab-loader')?.classList.add('hidden');
        document.getElementById('providers-form')?.classList.remove('hidden');
        document.getElementById('providers-list').innerHTML = '';
        (providers || []).forEach(p => addProviderCard(p, true));
        updateProvidersVisibility();
        applyProviderReadonly();
    }

    let _serverOptions = [];
    let _providerCardCounter = 0;

    async function loadServerOptions() {
        try {
            const res = await fetch('/api/servers');
            if (!res.ok) return;
            const servers = await res.json();
            _serverOptions = (servers || [])
                .filter(s => s.server_id && s.server_name)
                .map(s => ({ id: s.server_id, name: s.server_name }));
        } catch (_) {}
    }

    function _updateProviderSrvDdLabel(card, ddId) {
        const btn = card.querySelector(`.cb-dd-btn[data-dd="${ddId}"]`);
        if (!btn) return;
        const checked = [...card.querySelectorAll(`#${ddId} .provider-server-cb:checked`)];
        const label = btn.querySelector('.cb-dd-label');
        const clearIc = btn.querySelector('.cb-dd-clear');
        if (label) {
            if (checked.length === 0) {
                label.textContent = 'None';
            } else if (checked.length === 1) {
                const srv = _serverOptions.find(s => s.id === checked[0].dataset.serverId);
                label.textContent = srv ? srv.name : checked[0].dataset.serverId;
            } else {
                label.textContent = `${checked.length} servers`;
            }
        }
        if (clearIc) clearIc.classList.toggle('hidden', checked.length === 0);
    }

    function addProviderCard(provider = {}, isExisting = false) {
        const list = document.getElementById('providers-list');
        const models = Array.isArray(provider.allowed_models) ? provider.allowed_models.join('\n') : '';
        const reservedIds = Array.isArray(provider.reserved_server_ids) ? provider.reserved_server_ids : [];
        const isReserved = reservedIds.length > 0;
        const cardId = ++_providerCardCounter;
        const ddId = `provider-srv-dd-${cardId}`;
        const card = document.createElement('div');
        card.className = 'provider-card space-y-3';
        if (isExisting) card.dataset.existing = 'true';
        const headerName = provider.name ? escapeHtml(provider.name) : 'New Provider';
        card.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="provider-header text-sm font-semibold text-gray-300">${headerName}</span>
                <button type="button" class="provider-remove text-xs text-red-400 hover:text-red-300 transition-colors">
                    <i class="fas fa-trash mr-1"></i>Remove
                </button>
            </div>
            <div class="form-grid">
                <div>
                    <label class="label-tt">Name</label>
                    <input type="text" class="provider-name input-field" placeholder="e.g. openrouter-vision" autocomplete="off" value="${escapeHtml(provider.name || '')}">
                </div>
                <div>
                    <label class="label-tt">Endpoint URL</label>
                    <input type="url" class="provider-endpoint input-field" placeholder="e.g. https://openrouter.ai/api/v1" autocomplete="off" value="${escapeHtml(provider.endpoint || '')}">
                </div>
            </div>
            <div>
                <label class="label-tt">API Key <span class="text-hint font-normal">(leave blank to keep existing)</span></label>
                <div class="relative">
                    <input type="password" class="provider-apikey input-field pr-10" autocomplete="new-password" placeholder="Leave blank to keep existing key">
                    <button type="button" class="btn-eye provider-key-toggle"><i class="fas fa-eye"></i></button>
                </div>
            </div>
            <div>
                <label class="label-tt">Allowed Models <span class="text-hint font-normal">(one per line - first is default)</span></label>
                <textarea class="provider-models input-field allowed-models-textarea" rows="3" placeholder="e.g. google/gemini-2.0-flash">${escapeHtml(models)}</textarea>
            </div>
            <div class="border-t border-gray-700 pt-3">
                <div class="flex-between">
                    <div>
                        <p class="text-sm font-medium text-gray-300">Reserved for server</p>
                        <p class="text-hint">When enabled, only selected servers can use this provider. Super admins can override.</p>
                    </div>
                    <label class="toggle-wrap">
                        <input type="checkbox" class="provider-reserved sr-only peer" ${isReserved ? 'checked' : ''}>
                        <div class="toggle-track"></div>
                    </label>
                </div>
                <div class="provider-reserved-server mt-3 ${isReserved ? '' : 'hidden'}">
                    <label class="text-xs font-medium text-gray-400 mb-1 block">Servers</label>
                    <div class="relative">
                        <button type="button" class="cb-dd-btn w-full" data-dd="${ddId}">
                            <span class="cb-dd-label flex-1 min-w-0 text-left truncate">None</span>
                            <span class="flex items-center gap-1.5 shrink-0 ml-auto">
                                <i class="fas fa-times cb-dd-clear hidden" title="Clear"></i>
                                <i class="fas fa-chevron-down cb-dd-chevron cb-dd-chevron--btn"></i>
                            </span>
                        </button>
                        <div id="${ddId}" class="cb-dd cb-dd-scrollable hidden w-full"></div>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.provider-remove').addEventListener('click', () => {
            card.remove();
            updateProvidersVisibility();
        });
        card.querySelector('.provider-name').addEventListener('input', function () {
            card.querySelector('.provider-header').textContent = this.value.trim() || 'New Provider';
        });
        card.querySelector('.provider-key-toggle').addEventListener('click', function () {
            const input = this.closest('.relative').querySelector('.provider-apikey');
            const icon = this.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });

        // Reserved toggle shows/hides the server dropdown
        const reservedToggle = card.querySelector('.provider-reserved');
        const reservedServerDiv = card.querySelector('.provider-reserved-server');
        reservedToggle.addEventListener('change', function () {
            reservedServerDiv.classList.toggle('hidden', !this.checked);
            if (!this.checked) {
                card.querySelectorAll(`#${ddId} .provider-server-cb`).forEach(cb => { cb.checked = false; });
                _updateProviderSrvDdLabel(card, ddId);
            }
        });

        // Populate checkbox dropdown with server options
        const dd = card.querySelector(`#${ddId}`);
        if (_serverOptions.length) {
            dd.innerHTML = _serverOptions.map(s => `
                <label class="cb-dd-item">
                    <input type="checkbox" class="custom-cb provider-server-cb" data-server-id="${escapeHtml(s.id)}" value="${escapeHtml(s.name)}"${reservedIds.includes(s.id) ? ' checked' : ''}>
                    ${escapeHtml(s.name)}
                </label>`).join('');
        } else {
            dd.innerHTML = '<span class="cb-dd-item text-dim">No servers available</span>';
        }

        // Wire checkbox change → update label
        dd.addEventListener('change', () => _updateProviderSrvDdLabel(card, ddId));

        list.appendChild(card);

        // Wire the cb-dd toggle button manually (avoids label conflict with initCbDdInteractions)
        const srvBtn = card.querySelector(`.cb-dd-btn[data-dd="${ddId}"]`);
        if (srvBtn) {
            srvBtn.addEventListener('click', (e) => {
                if (e.target.closest('.cb-dd-clear')) return;
                document.querySelectorAll('.cb-dd').forEach(d => { if (d !== dd) d.classList.add('hidden'); });
                dd.classList.toggle('hidden');
            });
            const clearIc = srvBtn.querySelector('.cb-dd-clear');
            if (clearIc) {
                clearIc.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    card.querySelectorAll(`#${ddId} .provider-server-cb`).forEach(cb => { cb.checked = false; });
                    dd.classList.add('hidden');
                    _updateProviderSrvDdLabel(card, ddId);
                });
            }
        }
        // Ensure document outside-click close is registered (once only via initCbDdInteractions flag)
        initCbDdInteractions({ containers: [] });
        // Set initial label
        _updateProviderSrvDdLabel(card, ddId);
    }

    function getProvidersFromDOM() {
        return [...document.querySelectorAll('.provider-card')].map(card => {
            const reservedToggle = card.querySelector('.provider-reserved');
            const checkedServers = reservedToggle?.checked
                ? [...card.querySelectorAll('.provider-server-cb:checked')].map(cb => cb.dataset.serverId).filter(Boolean)
                : [];
            return {
                name: card.querySelector('.provider-name').value.trim(),
                endpoint: card.querySelector('.provider-endpoint').value.trim(),
                api_key: card.querySelector('.provider-apikey').value,
                allowed_models: card.querySelector('.provider-models').value
                    .split('\n').map(s => s.trim()).filter(Boolean),
                reserved_server_ids: checkedServers,
            };
        }).filter(p => p.name || p.endpoint);
    }

    function getModelsFromTextarea(id) {
        const el = document.getElementById(id);
        if (!el) return [];
        return el.value.split('\n').map(s => s.trim()).filter(Boolean);
    }

    function getPrimaryModelOptions() {
        const seen = new Set();
        const out = [];
        getModelsFromTextarea('primary_allowed_models').forEach(m => {
            const key = `${m}|primary`;
            if (!m || seen.has(key)) return;
            seen.add(key);
            out.push({ display: formatModelDisplay(m, 'primary'), model: m, source: 'primary' });
        });
        return out;
    }

    function getFallbackModelOptions() {
        const seen = new Set();
        const out = [];
        const add = (models, source) => {
            (models || []).forEach(m => {
                const key = `${m}|${source}`;
                if (!m || seen.has(key)) return;
                seen.add(key);
                out.push({ display: formatModelDisplay(m, source), model: m, source });
            });
        };
        add(getModelsFromTextarea('primary_allowed_models'), 'primary');
        getProvidersFromDOM().forEach(p => {
            if (p.name) add(p.allowed_models, p.name);
        });
        return out;
    }

    function inferFallbackSource(model) {
        const m = (model || '').trim();
        if (!m) return 'primary';
        for (const p of getProvidersFromDOM()) {
            if (p.name && (p.allowed_models || []).includes(m)) return p.name;
        }
        return 'primary';
    }

    function setAiModelField(displayId, model, source) {
        const displayEl = elements[displayId] || document.getElementById(displayId);
        const modelEl = document.getElementById(`${displayId}-model`);
        const sourceEl = document.getElementById(`${displayId}-source`);
        const m = (model || '').trim();
        const src = source || 'primary';
        if (modelEl) modelEl.value = m;
        if (sourceEl) sourceEl.value = m ? src : 'primary';
        if (!displayEl) return;
        const opts = displayId === 'fallback_llm' ? getFallbackModelOptions() : getPrimaryModelOptions();
        const entry = opts.find(e => e.model === m && e.source === src);
        displayEl.value = entry ? entry.display : (m ? formatModelDisplay(m, src) : '');
        if (typeof resetFilterComboboxTouch === 'function') resetFilterComboboxTouch(displayEl);
    }

    function getAiConfigModelValue(displayId, preferredSource) {
        const modelEl = document.getElementById(`${displayId}-model`);
        const fromHidden = (modelEl?.value || '').trim();
        if (fromHidden) return fromHidden;
        const display = (elements[displayId]?.value || '').trim();
        const opts = displayId === 'fallback_llm' ? getFallbackModelOptions() : getPrimaryModelOptions();
        return resolveModelFromDisplay(display, opts, preferredSource) || display;
    }

    function getVisionAllowedModelDisplays() {
        // Vision Model combobox should offer allowed models from all config sources:
        // - primary_allowed_models
        // - fallback_allowed_models
        // - multimodal provider cards (their allowed_models)
    function getVisionAllowedModelDisplays() {
        // Vision Model combobox should offer allowed models from all config sources:
        // - primary_allowed_models
        // - fallback_allowed_models
        // - multimodal provider cards (their allowed_models)
        const out = [];
        const seen = new Set();

        const add = (models, source) => {
            (models || []).forEach(m => {
                if (!m) return;
                const key = `${m}|${source}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ display: `${m} (${source})`, model: m, source });
            });
        };

        add(getModelsFromTextarea('primary_allowed_models'), 'primary');
        add(getModelsFromTextarea('fallback_allowed_models'), 'fallback');

        // Provider-card models
        document.querySelectorAll('.provider-card').forEach(card => {
            const name = card.querySelector('.provider-name').value.trim();
            if (!name) return;
            const models = card.querySelector('.provider-models').value
                .split('\n').map(s => s.trim()).filter(Boolean);
            add(models, name);
        });

        return out;
    }

    function wireAiModelCombobox(displayId, ddId, optionsFn, defaultSource) {
        setupFilterCombobox(
            displayId,
            ddId,
            () => optionsFn().map(e => e.display),
            (selected) => {
                const entry = optionsFn().find(e => e.display === selected);
                if (!entry) return;
                const displayEl = elements[displayId] || document.getElementById(displayId);
                const modelEl = document.getElementById(`${displayId}-model`);
                const sourceEl = document.getElementById(`${displayId}-source`);
                if (displayEl) displayEl.value = entry.display;
                if (modelEl) modelEl.value = entry.model;
                if (sourceEl) sourceEl.value = entry.source;
            },
            (value) => {
                if (!value.trim()) {
                    const modelEl = document.getElementById(`${displayId}-model`);
                    const sourceEl = document.getElementById(`${displayId}-source`);
                    if (modelEl) modelEl.value = '';
                    if (sourceEl) sourceEl.value = defaultSource;
                }
            },
            'hover:bg-gray-700'
        );
    }

    function setupModelComboboxes() {
        wireAiModelCombobox('base_llm', 'base-llm-dd', getPrimaryModelOptions, 'primary');
        wireAiModelCombobox('fallback_llm', 'fallback-llm-dd', getFallbackModelOptions, 'primary');
        setupFilterCombobox(
            'fallback_llm',
            'fallback-llm-dd',
            () => getFallbackModels(),
            null,
            null,
            'hover:bg-gray-700'
        );
        setupFilterCombobox(
            'multimodal_ai_model',
            'multimodal-ai-model-dd',
            () => getVisionAllowedModelDisplays().map(e => e.display),
            (selected) => {
                const entry = getVisionAllowedModelDisplays().find(e => e.display === selected);
                if (entry) {
                    elements['multi_model_ai_model'].value = entry.model;
                    // Only provider-card models have a provider name we can resolve.
                    // For primary/fallback models we clear provider so legacy multimodal endpoint/api is used.
                    elements['multi_model_ai_provider'].value = (entry.source === 'primary' || entry.source === 'fallback')
                        ? ''
                        : entry.source;
                }
            },
            () => { elements['multi_model_ai_provider'].value = ''; },
            'hover:bg-gray-700'
        );
    }

    async function loadDefaultCharacterCombobox() {
        try {
            const res = await fetch('/api/characters');
            if (!res.ok) return;
            const chars = await res.json();
            const names = chars.map(c => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
            setupFilterCombobox(
                'default_character',
                'default-character-dd',
                names,
                null,
                null,
                'hover:bg-gray-700'
            );
        } catch (_) {}
    }

    // --- Initial Load ---
    // Both auth-status AND server options must be known before loadConfig so that
    // applyProviderReadonly has the correct role when renderProviders runs.
    Promise.all([_authReady, loadServerOptions()]).then(() => loadConfig()).then(() => {
        loadDefaultCharacterCombobox();
        setupModelComboboxes();
    });
    loadSecurityStatus();
    checkEncryptionStatus();
});

async function checkEncryptionStatus() {
    try {
        const r = await fetch('/api/config/encryption-status');
        if (!r.ok) return;
        const d = await r.json();
        if (!d.encrypted) {
            showToast('TOKEN_KEY is not set — tokens and API keys are stored unencrypted. Set TOKEN_KEY in your .env file.', 'error');
        }
    } catch {}
}

function toggleVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}
