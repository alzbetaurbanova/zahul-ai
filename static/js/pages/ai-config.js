document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/auth-status').then(r => r.json()).then(d => {
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
        'default_character', 'ai_endpoint', 'base_llm', 'temperature', 'auto_cap',
        'history_limit', 'max_tokens',
        'fallback_llm', 'fallback_duration', 'token_limit_tpm', 'token_limit_tpd',
        'ai_key', 'discord_key', 'use_prefill', 'dm_list',
        'multimodal_enable', 'multimodal_ai_model', 'multimodal_ai_endpoint', 'multimodal_ai_api',
        'public_url', 'discord_oauth_client_id', 'discord_oauth_client_secret', 'discord_oauth_redirect_uri',
        'panel_auth_enabled', 'discord_login_enabled', 'local_login_enabled'
    ];
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
                    } else if (key === 'dm_list' && Array.isArray(config[key])) {
                        // Convert array (list) from DB to newline-separated string for Textarea
                        elements[key].value = config[key].join('\n');
                    } else if (elements[key].type !== 'password') {
                        elements[key].value = config[key];
                    }
                }
            }
            toggleMultimodalOptions();
            const dmVal = elements['dm_list'] ? elements['dm_list'].value.trim() : '';
            dmToggle.checked = dmVal.length > 0;
            toggleDmFields();
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
        for (const urlField of ['ai_endpoint', 'public_url', 'multimodal_ai_endpoint', 'discord_oauth_redirect_uri']) {
            const raw = elements[urlField]?.value?.trim() || '';
            if (raw && !isValidHttpUrl(raw)) {
                showToast(`${urlField.replaceAll('_', ' ')} must be a valid http/https URL.`, 'error');
                return;
            }
        }

        const configData = {};
        for (const key of fieldIds) {
            if (elements[key]) {
                if (elements[key].type === 'checkbox') {
                    configData[key] = elements[key].checked;
                } else if (key === 'dm_list') {
                    // Convert newline-separated string to Array, trimming whitespace and removing empty lines
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
            elements['multimodal_ai_api'].value = '';
            elements['discord_oauth_client_secret'].value = '';
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
        if (multimodalToggle.checked) {
            multimodalOptions.classList.remove('hidden');
        } else {
            multimodalOptions.classList.add('hidden');
        }
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
    elements.discord_oauth_redirect_uri.addEventListener('input', updateDiscordOauthWarning);
    dmToggle.addEventListener('change', toggleDmFields);

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
    loadConfig().then(() => loadDefaultCharacterCombobox());
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
