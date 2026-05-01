document.addEventListener('DOMContentLoaded', function() {
    const API_BASE = '/api/characters';
    let currentCharacterName = null;

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
    const infoInput = document.getElementById('about');
    const temperatureInput = document.getElementById('temperature');
    const charHistoryLimitInput = document.getElementById('char-history-limit');
    const charMaxTokensInput = document.getElementById('char-max-tokens');
    const triggersInput = document.getElementById('triggers');
    const saveBtn = document.getElementById('save-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const exportBtn = document.getElementById('export-btn');
    const toastContainer = document.getElementById('toast-container');

    // --- Modal Management ---
    const openModal = () => modal.classList.remove('opacity-0', 'pointer-events-none');
    const closeModal = () => modal.classList.add('opacity-0', 'pointer-events-none');

    // --- Server Filter ---
    const serverFilter = document.getElementById('server-filter');
    let allCharacters = [];
    let serverWhitelists = {}; // server_id -> Set of character names

    async function loadServerFilter() {
        try {
            const res = await fetch('/api/servers/');
            if (!res.ok) return;
            const servers = await res.json();
            servers.filter(s => !s.server_name.toLowerCase().includes('direct message')).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.server_id;
                opt.textContent = s.server_name;
                serverFilter.appendChild(opt);
            });
            // Load whitelists for all servers
            await Promise.all(servers.map(async s => {
                const r = await fetch(`/api/servers/${s.server_id}/channels`);
                if (!r.ok) return;
                const channels = await r.json();
                const names = new Set();
                channels.forEach(ch => (ch.data.whitelist || []).forEach(n => names.add(n)));
                serverWhitelists[s.server_id] = names;
            }));
        } catch (e) {}
    }

    function applyFilter() {
        const selected = serverFilter.value;
        const cards = characterGrid.querySelectorAll('[data-char-name]');
        cards.forEach(card => {
            if (selected === 'all') {
                card.style.display = '';
            } else {
                const whitelist = serverWhitelists[selected] || new Set();
                card.style.display = whitelist.has(card.dataset.charName) ? '' : 'none';
            }
        });
    }

    serverFilter.addEventListener('change', applyFilter);

    // --- Core Functions ---

    // REWORKED: Fetch and display all characters efficiently
    async function fetchAndDisplayCharacters() {
        characterGrid.innerHTML = '<p class="text-gray-400 col-span-full">Loading characters...</p>';
        try {
            const response = await fetch(API_BASE); // Single API call!
            if (!response.ok) throw new Error('Failed to fetch character list');
            const characters = await response.json(); // Gets List[CharacterListItem]

            characterGrid.innerHTML = ''; // Clear loading message

            characters.sort((a, b) => a.name.localeCompare(b.name));

            // Add cards for each character from the list
            characters.forEach(char => {
                const card = document.createElement('div');
                card.className = 'group relative aspect-square bg-gray-900 rounded-lg cursor-pointer overflow-hidden shadow-lg transition-transform transform hover:scale-105 border border-gray-800';
                card.dataset.charName = char.name;
                card.innerHTML = `
                    <img src="${char.avatar || 'https://via.placeholder.com/200'}" alt="${char.name}" class="w-full h-full object-cover transition-transform group-hover:scale-110">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                    <h3 class="absolute bottom-0 left-0 p-3 font-bold text-white text-lg">${char.name}</h3>
                `;
                card.addEventListener('click', () => loadCharacterForEdit(char.name));
                characterGrid.appendChild(card);
            });
            applyFilter();

        } catch (error) {
            console.error(error);
            characterGrid.innerHTML = '<p class="text-red-500 col-span-full">Failed to load characters.</p>';
            showToast('Failed to load characters.', 'error');
        }
    }

    // Load a specific character's data into the modal for editing
    async function loadCharacterForEdit(name) {
        try {
            const response = await fetch(`${API_BASE}/${name}`);
            const char = await response.json();

            resetForm();
            currentCharacterName = name;

            formTitle.textContent = `Editing: ${char.name}`;
            nameInput.value = char.name;
            nameInput.readOnly = true;

            personaInput.value = char.data.persona;
            instructionsInput.value = char.data.instructions;
            avatarUrlInput.value = char.data.avatar || '';
            infoInput.value = char.data.about || '';
            temperatureInput.value = char.data.temperature != null ? char.data.temperature : '';
            charHistoryLimitInput.value = char.data.history_limit != null ? char.data.history_limit : '';
            charMaxTokensInput.value = char.data.max_tokens != null ? char.data.max_tokens : '';
            triggersInput.value = char.triggers.join(', ');

            updateAvatarPreview(char.data.avatar);
            saveBtn.textContent = 'Save Changes';
            deleteBtn.classList.remove('hidden');
            exportBtn.classList.remove('hidden');
            openModal();
        } catch (error) {
            showToast(`Failed to load character: ${name}`, 'error');
        }
    }

    // Reset the form to its default "create" state
    function resetForm() {
        currentCharacterName = null;
        form.reset();
        nameInput.readOnly = false;
        formTitle.textContent = 'Create New Character';
        saveBtn.textContent = 'Create Character';
        deleteBtn.classList.add('hidden');
        exportBtn.classList.add('hidden');
        updateAvatarPreview('https://via.placeholder.com/96');
    }

    // REWORKED: Handle form submission (both create and update)
    async function handleFormSubmit(event) {
        event.preventDefault();

        const name = nameInput.value.trim();
        if (!name) {
            showToast('Character name is required.', 'error');
            return;
        }

        // Gather all data from the form
        const characterData = {
            persona: personaInput.value,
            instructions: instructionsInput.value,
            avatar: avatarUrlInput.value.trim() || null,
            about: infoInput.value.trim() || null,
            temperature: temperatureInput.value !== '' ? parseFloat(temperatureInput.value) : null,
            history_limit: charHistoryLimitInput.value !== '' ? parseInt(charHistoryLimitInput.value) : null,
            max_tokens: charMaxTokensInput.value !== '' ? parseInt(charMaxTokensInput.value) : null
        };
        const triggers = triggersInput.value.split(',').map(s => s.trim()).filter(Boolean);

        try {
            let response;
            let url;
            let method;
            let body;

            if (currentCharacterName) {
                // --- UPDATE existing character ---
                url = `${API_BASE}/${currentCharacterName}`;
                method = 'PUT';
                body = JSON.stringify({
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
            showToast(`Character '${result.name}' saved successfully!`);
            closeModal();
            await fetchAndDisplayCharacters();

        } catch (error) {
            showToast(`Error saving character: ${error.message}`, 'error');
        }
    }

    function handleExport() {
        if (!currentCharacterName) return;
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

    // Handle character deletion (Unchanged)
    async function handleDelete() {
        if (!currentCharacterName || !confirm(`Are you sure you want to delete '${currentCharacterName}'? This cannot be undone.`)) {
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/${currentCharacterName}`, { method: 'DELETE' });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'An unknown error occurred.');
            }
            showToast(`Character '${currentCharacterName}' deleted.`);
            closeModal();
            await fetchAndDisplayCharacters();
        } catch (error) {
            showToast(`Error deleting character: ${error.message}`, 'error');
        }
    }

    // Avatar upload logic
    async function uploadFile(file) {
        if (!file) return;
        const formData = new FormData();
        formData.append('image', file);
        const originalUrl = avatarUrlInput.value;
        avatarUrlInput.value = 'Uploading...';
        saveBtn.disabled = true;
        try {
            const charName = nameInput.value.trim() || 'avatar';
            const response = await fetch(`${API_BASE}/save_avatar?name=${encodeURIComponent(charName)}`, { method: 'POST', body: formData });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upload failed.');
            }
            const result = await response.json();
            avatarUrlInput.value = result.url;
            updateAvatarPreview(result.url);
            showToast('Avatar uploaded successfully!');
        } catch (error) {
            showToast(`Avatar upload failed: ${error.message}`, 'error');
            avatarUrlInput.value = originalUrl;
            updateAvatarPreview(originalUrl);
        } finally {
            saveBtn.disabled = false;
            avatarUploadInput.value = '';
        }
    }

    const updateAvatarPreview = (url) => { avatarPreview.src = url || 'https://via.placeholder.com/96'; };

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

    // Import Functions (Largely Unchanged)
    // Note: When importing, triggers will be empty. Users can add them before saving.
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
        const systemPrompt = charData.system_prompt || '';
        const postHistory = charData.post_history_instructions || '';
        if (systemPrompt || postHistory) {
            instructionsInput.value = `[System Note: ${systemPrompt}]\n[System Note: ${postHistory}]`;
        } else {
            instructionsInput.value = charData.instructions || '';
        }
        infoInput.value = charData.about || charData.character_version || charData.creator_notes || '';
    }
    // getCharacterDataFromPng function (Unchanged from original)
    async function getCharacterDataFromPng(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const dataView = new DataView(arrayBuffer);
                    if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
                        return reject(new Error('Not a valid PNG file.'));
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
                } catch (err) { reject(new Error('Could not parse character data from PNG.')); }
            };
            reader.onerror = () => reject(new Error('Failed to read the file.'));
            reader.readAsArrayBuffer(file);
        });
    }

    // Utility Functions (Unchanged)
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        const icon = type === 'success' ? '<i class="fas fa-check-circle mr-2"></i>' : '<i class="fas fa-exclamation-circle mr-2"></i>';
        const bgColor = type === 'success' ? 'bg-green-600' : 'bg-red-600';
        toast.className = `${bgColor} text-white py-2 px-4 rounded-lg shadow-lg flex items-center animate-pulse`;
        toast.innerHTML = `${icon} ${message}`;
        toastContainer.innerHTML = '';
        toastContainer.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 4000);
    }

    // --- Event Listeners ---
    form.addEventListener('submit', handleFormSubmit);
    document.getElementById('new-char-btn').addEventListener('click', () => { resetForm(); openModal(); });
    document.getElementById('import-card-btn').addEventListener('click', () => openImportInfoModal());
    deleteBtn.addEventListener('click', handleDelete);
    exportBtn.addEventListener('click', handleExport);
    avatarUploadInput.addEventListener('change', (e) => uploadFile(e.target.files[0]));
    avatarUrlInput.addEventListener('input', (e) => updateAvatarPreview(e.target.value));
    importFileInput.addEventListener('change', handleFileImport);
    modalCloseBtn.addEventListener('click', closeModal);

    // --- Initial Load ---
    loadServerFilter();
    fetchAndDisplayCharacters();
});
