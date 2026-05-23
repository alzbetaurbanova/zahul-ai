document.addEventListener('DOMContentLoaded', () => {
    (window.__authStatus || fetch('/api/auth-status').then(r => r.json())).then(d => {
        const role = d.current_user?.role;
        const allowed = role === 'super_admin';
        if (d.panel_auth_enabled && !allowed) {
            window.location.href = '/';
        }
    }).catch(() => {});

    const CONFIG_API_BASE = '/api/config';
    const PRESET_API_BASE = '/api/presets';

    // --- DOM Elements ---
    const form = document.getElementById('config-form');
    const toastContainer = document.getElementById('toast-container');
    const multimodalToggle = document.getElementById('multimodal_enable');
    const multimodalOptions = document.getElementById('multimodal-options');

    // Prompt Editor Elements
    const promptTemplateInput = document.getElementById('prompt_template');
    const savePromptBtn = document.getElementById('save-prompt-btn');
    let currentPresetDescription = null;

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
        'fallback_use_different_endpoint', 'fallback_ai_endpoint', 'fallback_ai_key', 'fallback_allowed_models',
        'ai_key', 'discord_key', 'use_prefill', 'dm_list',
        'multimodal_enable', 'multimodal_ai_model', 'multimodal_ai_provider',
        'public_url', 'discord_oauth_client_id', 'discord_oauth_client_secret', 'discord_oauth_redirect_uri',
        'panel_auth_enabled', 'discord_login_enabled', 'local_login_enabled'
    ];
    const ARRAY_TEXTAREA_FIELDS = new Set(['dm_list', 'primary_allowed_models', 'fallback_allowed_models']);
    const elements = Object.fromEntries(fieldIds.map(id => [id, document.getElementById(id)]));
    const MIN_PANEL_PASSWORD_LENGTH = 8;

    // --- Config Functions ---
    async function loadConfig() {
        try {
            const response = await fetch(CONFIG_API_BASE);
            if (!response.ok) throw new Error('Failed to fetch config.');
            const config = await response.json();

            for (const key in config) {
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
            renderProviders(Array.isArray(config.multimodal_providers) ? config.multimodal_providers : []);
            toggleMultimodalOptions();
            toggleFallbackEndpointFields();
            const dmVal = elements['dm_list'] ? elements['dm_list'].value.trim() : '';
            dmToggle.checked = dmVal.length > 0;
            toggleDmFields();
            updateRedirectUriHint();
        } catch (error) {
            showToast(error.message, 'error');
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
            showToast('Temperature must be between 0 and 2.', 'error');
            return;
        }
        for (const urlField of ['ai_endpoint', 'public_url', 'fallback_ai_endpoint', 'discord_oauth_redirect_uri']) {
            const raw = elements[urlField]?.value?.trim() || '';
            if (raw && !isValidHttpUrl(raw)) {
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
        configData['multimodal_providers'] = getProvidersFromDOM();

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

            // Clear password fields after save for security
            elements['ai_key'].value = '';
            elements['discord_key'].value = '';
            elements['fallback_ai_key'].value = '';
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

    function toggleMultimodalOptions() {
        multimodalOptions.classList.toggle('hidden', !multimodalToggle.checked);
    }

    function toggleFallbackEndpointFields() {
        const on = elements['fallback_use_different_endpoint']?.checked;
        document.getElementById('fallback-endpoint-fields').classList.toggle('hidden', !on);
    }

    // --- Prompt Preset Functions ---
    async function loadPrompt() {
        try {
            const response = await fetch(`${PRESET_API_BASE}/Default`);
            if (!response.ok) throw new Error('Failed to load default prompt template.');
            const preset = await response.json();

            promptTemplateInput.value = preset.prompt_template || '';
            currentPresetDescription = preset.description;
        } catch (error) {
            showToast(error.message, 'error');
            promptTemplateInput.disabled = true;
            promptTemplateInput.value = "Error: Could not load the 'Default' prompt preset.";
        }
    }

    async function savePrompt() {
        const presetData = {
            name: 'Default',
            description: currentPresetDescription,
            prompt_template: promptTemplateInput.value
        };

        try {
            const response = await fetch(`${PRESET_API_BASE}/Default`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(presetData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to save prompt.');
            }
            showToast('Default prompt template saved successfully!');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    // --- Event Listeners ---
    form.addEventListener('submit', handleConfigSubmit);
    multimodalToggle.addEventListener('change', toggleMultimodalOptions);
    savePromptBtn.addEventListener('click', savePrompt);
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
    elements['fallback_use_different_endpoint']?.addEventListener('change', toggleFallbackEndpointFields);
    document.getElementById('add-provider-btn').addEventListener('click', () => addProviderCard());

    // --- Multimodal Providers ---
    function renderProviders(providers) {
        document.getElementById('providers-list').innerHTML = '';
        (providers || []).forEach(p => addProviderCard(p));
    }

    function addProviderCard(provider = {}) {
        const list = document.getElementById('providers-list');
        const models = Array.isArray(provider.allowed_models) ? provider.allowed_models.join('\n') : '';
        const card = document.createElement('div');
        card.className = 'provider-card border border-gray-700 rounded-lg p-4 space-y-3 bg-gray-900';
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
                    <input type="text" class="provider-name input-field" placeholder="e.g. openrouter-vision" value="${escapeHtml(provider.name || '')}">
                </div>
                <div>
                    <label class="label-tt">Endpoint URL</label>
                    <input type="url" class="provider-endpoint input-field" placeholder="e.g. https://openrouter.ai/api/v1" value="${escapeHtml(provider.endpoint || '')}">
                </div>
            </div>
            <div>
                <label class="label-tt">API Key <span class="text-hint font-normal">(leave blank to keep existing)</span></label>
                <div class="relative">
                    <input type="password" class="provider-apikey input-field pr-10" autocomplete="off" placeholder="Leave blank to keep existing key">
                    <button type="button" class="btn-eye provider-key-toggle"><i class="fas fa-eye"></i></button>
                </div>
            </div>
            <div>
                <label class="label-tt">Allowed Models <span class="text-hint font-normal">(one per line - first is default)</span></label>
                <textarea class="provider-models input-field font-mono" rows="3" placeholder="e.g. google/gemini-2.0-flash">${escapeHtml(models)}</textarea>
            </div>
        `;
        card.querySelector('.provider-remove').addEventListener('click', () => card.remove());
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
        list.appendChild(card);
    }

    function getProvidersFromDOM() {
        return [...document.querySelectorAll('.provider-card')].map(card => ({
            name: card.querySelector('.provider-name').value.trim(),
            endpoint: card.querySelector('.provider-endpoint').value.trim(),
            api_key: card.querySelector('.provider-apikey').value,
            allowed_models: card.querySelector('.provider-models').value
                .split('\n').map(s => s.trim()).filter(Boolean),
        })).filter(p => p.name || p.endpoint);
    }

    function getModelsFromTextarea(id) {
        const el = document.getElementById(id);
        if (!el) return [];
        return el.value.split('\n').map(s => s.trim()).filter(Boolean);
    }

    function getFallbackModels() {
        const diffEndpoint = elements['fallback_use_different_endpoint']?.checked;
        return diffEndpoint
            ? getModelsFromTextarea('fallback_allowed_models')
            : getModelsFromTextarea('primary_allowed_models');
    }

    function getProviderModelDisplays() {
        const out = [];
        const seen = new Set();
        document.querySelectorAll('.provider-card').forEach(card => {
            const name = card.querySelector('.provider-name').value.trim();
            if (!name) return;
            card.querySelector('.provider-models').value
                .split('\n').map(s => s.trim()).filter(Boolean)
                .forEach(m => {
                    const key = `${m}|${name}`;
                    if (!seen.has(key)) { seen.add(key); out.push({ display: `${m} (${name})`, model: m, source: name }); }
                });
        });
        return out;
    }

    function setupModelComboboxes() {
        setupFilterCombobox(
            'base_llm',
            'base-llm-dd',
            () => getModelsFromTextarea('primary_allowed_models'),
            null,
            null,
            'hover:bg-gray-700'
        );
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
            () => getProviderModelDisplays().map(e => e.display),
            (selected) => {
                const entry = getProviderModelDisplays().find(e => e.display === selected);
                if (entry) {
                    elements['multimodal_ai_model'].value = entry.model;
                    elements['multimodal_ai_provider'].value = entry.source;
                }
            },
            () => { elements['multimodal_ai_provider'].value = ''; },
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
    loadConfig().then(() => {
        loadDefaultCharacterCombobox();
        setupModelComboboxes();
    });
    loadPrompt();
    loadSecurityStatus();
});

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
