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

/** Combobox clear (X) only after user types or picks from list — not on programmatic value. */
function resetFilterComboboxTouch(inputId) {
    const input = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
    if (input) input.dataset.comboboxClearTouched = '';
}

function setupFilterCombobox(inputId, dropdownId, options, onSelect, onInput, optionHoverClass = 'hover:bg-gray-800') {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;
    if (input.dataset.filterComboboxWired === '1') return;
    const wrapper = input.parentElement;
    let clearBtn = wrapper ? wrapper.querySelector(`button[data-clear="${inputId}"]`) : null;
    if (!clearBtn && wrapper) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'icon-clear-btn hidden';
        clearBtn.dataset.clear = inputId;
        clearBtn.title = 'Clear';
        clearBtn.innerHTML = '<i class="fas fa-times"></i>';
        const dd = wrapper.querySelector(`#${dropdownId}`);
        if (dd) wrapper.insertBefore(clearBtn, dd);
        else wrapper.appendChild(clearBtn);
    }
    if (clearBtn) {
        clearBtn.dataset.comboboxManaged = '1';
    }

    function listOptions() {
        return typeof options === 'function' ? options() : options;
    }

    function showDropdown() {
        const opts = listOptions();
        const q = input.value.toLowerCase();
        const filtered = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
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
                input.dataset.comboboxClearTouched = '1';
                input.value = selected;
                dropdown.classList.add('hidden');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                if (onSelect) onSelect(selected);
            });
        });
        dropdown.classList.remove('hidden');
    }

    function syncClearBtn() {
        if (!clearBtn) return;
        const hasText = input.value.trim() !== '';
        const hasData = String(input.dataset.value || '').trim() !== '';
        const hasValue = hasText || hasData;
        const touched = input.dataset.comboboxClearTouched === '1';
        clearBtn.classList.toggle('hidden', !hasValue || !touched);
    }

    input.addEventListener('focus', showDropdown);
    input.addEventListener('input', (e) => {
        if (e.isTrusted) input.dataset.comboboxClearTouched = '1';
        if (onInput) onInput(input.value);
        syncClearBtn();
        showDropdown();
    });
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
    input.addEventListener('change', syncClearBtn);
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            input.value = '';
            if ('dataset' in input && 'value' in input.dataset) input.dataset.value = '';
            input.dataset.comboboxClearTouched = '';
            dropdown.classList.add('hidden');
            syncClearBtn();
            if (onInput) onInput('');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    syncClearBtn();
    input.dataset.filterComboboxWired = '1';
}

function initFilterClear(onChangeFn, root = document) {
    root.querySelectorAll('button[data-clear]').forEach(btn => {
        if (btn.dataset.comboboxManaged === '1') return;
        const target = document.getElementById(btn.dataset.clear);
        if (!target) return;
        const isSelect = target.tagName === 'SELECT';
        const emptyVal = btn.dataset.clearValue ?? '';
        const wrap = btn.closest('.select-wrap');

        function syncBtn() {
            const hasValue = isSelect ? target.value !== emptyVal : target.value.trim() !== '';
            btn.classList.toggle('hidden', !hasValue);
            if (wrap) wrap.classList.toggle('has-value', hasValue);
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            target.value = emptyVal;
            btn.classList.add('hidden');
            if (wrap) wrap.classList.remove('has-value');
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof onChangeFn === 'function') onChangeFn(btn.dataset.clear);
        });

        target.addEventListener('input', syncBtn);
        target.addEventListener('change', syncBtn);
        syncBtn();
    });
}

/** When true, checkbox change handlers skip onCheckboxChange (bulk clear / reset). */
let _cbDdBatchSuppress = false;

/** Checkbox dropdown button: label + optional X reflect checked boxes inside `#${btn.dataset.dd}` */
function updateCbDdLabel(btn) {
    const ddId = btn?.dataset?.dd;
    if (!ddId) return;
    const checked = [...document.querySelectorAll(`#${ddId} input:checked`)].map(el => el.value);
    const label = btn.querySelector('.cb-dd-label');
    if (label) {
        label.textContent = checked.length === 0 ? 'All' : checked.length === 1 ? checked[0] : `${checked.length} selected`;
    }
    const clearIc = btn.querySelector('.cb-dd-clear');
    if (clearIc) clearIc.classList.toggle('hidden', checked.length === 0);
}

/** Uncheck `.${prefix}-cb`, optional afterReset(prefix), refresh all cb-dd labels */
function clearCheckboxDropdownPrefix(prefix, options = {}) {
    _cbDdBatchSuppress = true;
    try {
        document.querySelectorAll(`.${prefix}-cb`).forEach(cb => { cb.checked = false; });
        if (typeof options.afterReset === 'function') options.afterReset(prefix);
        document.querySelectorAll('.cb-dd-btn').forEach(btn => updateCbDdLabel(btn));
    } finally {
        _cbDdBatchSuppress = false;
    }
}

function wireCbDdClear(iconId, ddElementId, onAfter) {
    const icon = document.getElementById(iconId);
    if (!icon) return;
    icon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _cbDdBatchSuppress = true;
        try {
            document.querySelectorAll(`#${ddElementId} input[type="checkbox"]`).forEach(cb => { cb.checked = false; });
            const btn = icon.closest('.cb-dd-btn');
            if (btn) updateCbDdLabel(btn);
        } finally {
            _cbDdBatchSuppress = false;
        }
        document.getElementById(ddElementId)?.classList.add('hidden');
        if (typeof onAfter === 'function') onAfter();
    });
}

let _cbDdOutsideCloseBound = false;

/**
 * Wire .cb-dd-btn toggle + outside-click close + checkbox sync.
 * Pass container roots so checkbox change runs your onCheckboxChange (e.g. refetch).
 */
function initCbDdInteractions(options = {}) {
    const { onCheckboxChange, containers = [] } = options;
    const roots = containers.filter(Boolean);

    roots.forEach(container => {
        container.querySelectorAll('.cb-dd-btn').forEach(btn => {
            const ddId = btn.dataset.dd;
            if (!ddId) return;
            const dd = document.getElementById(ddId);
            if (!dd) return;
            btn.addEventListener('click', (e) => {
                if (e.target.closest('.cb-dd-clear')) return;
                document.querySelectorAll('.cb-dd').forEach(d => { if (d !== dd) d.classList.add('hidden'); });
                dd.classList.toggle('hidden');
            });
        });

        container.addEventListener('change', (e) => {
            if (_cbDdBatchSuppress) return;
            const t = e.target;
            if (t.type !== 'checkbox') return;
            const dd = t.closest('.cb-dd');
            if (!dd || !container.contains(dd)) return;
            const btn = dd.previousElementSibling;
            if (!btn?.classList.contains('cb-dd-btn')) return;
            updateCbDdLabel(btn);
            if (dd.dataset.closeOnSelect === '1') {
                dd.classList.add('hidden');
            }
            if (typeof onCheckboxChange === 'function') onCheckboxChange(e, btn, dd);
        });
    });

    if (!_cbDdOutsideCloseBound) {
        _cbDdOutsideCloseBound = true;
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.cb-dd-btn').forEach(btn => {
                const ddId = btn.dataset.dd;
                if (!ddId) return;
                const dd = document.getElementById(ddId);
                if (!dd) return;
                if (btn.contains(e.target) || dd.contains(e.target)) return;
                const anchorId = dd.dataset.cbDdAnchor;
                const anchor = anchorId ? document.getElementById(anchorId) : null;
                if (anchor?.contains(e.target)) return;
                dd.classList.add('hidden');
            });
        });
    }
}

/**
 * Search box filters visible rows in a searchable checkbox dropdown (admin logs action, etc.).
 * Returns { reset } to clear search + show all rows.
 */
function initSearchableCheckboxDropdown(options) {
    const {
        searchInputId,
        dropdownId,
        itemSelector = '.cb-dd-search-list .cb-dd-item',
        focusOnOpen = true,
    } = options;
    const inp = document.getElementById(searchInputId);
    const dd = document.getElementById(dropdownId);
    if (!inp || !dd) return null;

    function filterRows() {
        const q = inp.value.trim().toLowerCase();
        dd.querySelectorAll(itemSelector).forEach(row => {
            const text = row.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            row.classList.toggle('hidden', !!q && !text.includes(q));
        });
    }

    inp.addEventListener('input', filterRows);

    function openDd() {
        document.querySelectorAll('.cb-dd').forEach(d => { if (d !== dd) d.classList.add('hidden'); });
        dd.classList.remove('hidden');
    }

    inp.addEventListener('focus', openDd);

    function reset() {
        inp.value = '';
        dd.querySelectorAll(itemSelector).forEach(row => row.classList.remove('hidden'));
    }

    if (focusOnOpen) {
        const openBtn = document.querySelector(`.cb-dd-btn[data-dd="${dropdownId}"]`);
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                if (e.target.closest('.cb-dd-clear')) return;
                requestAnimationFrame(() => {
                    if (!dd.classList.contains('hidden')) inp.focus();
                });
            });
        }
    }

    return { reset, filterRows };
}

const ROLE_LEVELS = { super_admin: 4, admin: 3, mod: 2, guest: 1, pending: 0, rejected: 0, user: 0 };

function roleAtLeast(role, minRole) {
    return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

function canMutate(role) {
    return roleAtLeast(role, 'admin');
}

window.roleAtLeast = roleAtLeast;
window.canMutate = canMutate;
