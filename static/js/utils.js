function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'bg-green-500' : 'bg-red-500'} text-white py-3 px-6 rounded-lg shadow-lg animate-pulse text-sm min-w-[260px] text-center`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function isValidHttpUrl(value) {
    if (!value) return true;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function setupFilterCombobox(inputId, dropdownId, options, onSelect, onInput, optionHoverClass = 'hover:bg-gray-800') {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    function showDropdown() {
        const q = input.value.toLowerCase();
        const filtered = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
        if (!filtered.length) {
            dropdown.classList.add('hidden');
            return;
        }
        dropdown.innerHTML = filtered.map((o, i) =>
            `<div class="combobox-item px-3 py-2 cursor-pointer ${optionHoverClass} text-sm text-white" data-index="${i}" data-val="${escapeHtml(o)}">${escapeHtml(o)}</div>`
        ).join('');
        dropdown.querySelectorAll('.combobox-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                const selected = filtered[parseInt(item.dataset.index, 10)];
                input.value = selected;
                dropdown.classList.add('hidden');
                if (onSelect) onSelect(selected);
            });
        });
        dropdown.classList.remove('hidden');
    }

    input.addEventListener('focus', showDropdown);
    input.addEventListener('input', () => {
        if (onInput) onInput(input.value);
        showDropdown();
    });
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}
