document.addEventListener('DOMContentLoaded', () => {
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
    const securityToggle = document.getElementById('security_toggle');
    const securityFields = document.getElementById('security-fields');
    const saveSecurityBtn = document.getElementById('save-security-btn');
    const panelPasswordInput = document.getElementById('panel_password');
    const panelPasswordHintInput = document.getElementById('panel_password_hint');

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
        'public_url'
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
            const response = await fetch('/api/auth-enabled');
            if (!response.ok) return;
            const data = await response.json();
            securityToggle.checked = data.enabled;
            toggleSecurityFields();
            if (data.enabled) {
                const hintRes = await fetch('/api/panel-hint');
                if (hintRes.ok) {
                    const hintData = await hintRes.json();
                    panelPasswordHintInput.value = hintData.hint || '';
                }
            }
        } catch (error) {
            // Silently ignore
        }
    }

    async function handleConfigSubmit(event) {
        event.preventDefault();
        const temperatureValue = parseFloat(elements['temperature'].value);
        if (!Number.isNaN(temperatureValue) && (temperatureValue < 0 || temperatureValue > 2)) {
            showToast('Temperature must be between 0 and 2.', 'error');
            return;
        }
        for (const urlField of ['ai_endpoint', 'public_url', 'multimodal_ai_endpoint']) {
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
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    function toggleSecurityFields() {
        if (securityToggle.checked) {
            securityFields.classList.remove('hidden');
        } else {
            securityFields.classList.add('hidden');
            panelPasswordInput.value = '';
            panelPasswordHintInput.value = '';
        }
    }

    async function handleSecuritySave() {
        const isEnabled = securityToggle.checked;
        if (isEnabled) {
            if (!panelPasswordInput.value) {
                showToast('Password is required when protection is enabled.', 'error');
                return;
            }
            if (panelPasswordInput.value.length < MIN_PANEL_PASSWORD_LENGTH) {
                showToast(`Panel password must be at least ${MIN_PANEL_PASSWORD_LENGTH} characters.`, 'error');
                return;
            }
        }
        const configData = {
            panel_password: isEnabled ? panelPasswordInput.value : '',
            panel_password_hint: isEnabled ? panelPasswordHintInput.value : ''
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
            if (isEnabled) {
                showToast('Password saved. Redirecting to login...');
                setTimeout(() => { window.location.href = '/logout'; }, 1200);
            } else {
                showToast('Panel password disabled!');
                panelPasswordInput.value = '';
            }
        } catch (error) {
            showToast(error.message, 'error');
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
    securityToggle.addEventListener('change', toggleSecurityFields);
    saveSecurityBtn.addEventListener('click', handleSecuritySave);
    dmToggle.addEventListener('change', toggleDmFields);

    // --- Initial Load ---
    loadConfig();
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
