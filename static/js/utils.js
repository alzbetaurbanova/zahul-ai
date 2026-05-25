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

function panelLoaderHtml(label = 'Loading...', modifier = '') {
    const modCls = modifier ? ` is-${modifier}` : '';
    return [
        '<div class="panel-loader', modCls, '" role="status" aria-live="polite">',
        '<span class="loader-spinner" aria-hidden="true"></span>',
        '<span class="panel-loader-label">', escapeHtml(label), '</span>',
        '</div>',
    ].join('');
}

function showPanelLoader(container, label = 'Loading...', modifier = '') {
    if (!container) return;
    if (container.querySelector('.panel-loader')) return;
    container.innerHTML = panelLoaderHtml(label, modifier);
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
            `<div class="combobox-item px-3 py-2 cursor-pointer text-sm text-white" data-index="${i}" data-val="${escapeHtml(o)}">${escapeHtml(o)}</div>`
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
        if (btn.dataset.comboboxManaged === '1' || btn.dataset.datePickerManaged === '1') return;
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

function logInviteCopied() {
    fetch("/api/discord/invite/copied", { method: "POST", credentials: "same-origin" }).catch(() => {});
}

const DATE_PICKER_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const DATE_PICKER_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DATE_PICKER_PLACEHOLDER = 'dd.mm.yyyy';
/** Scheduler filter From/To: native date + classes applied before custom picker mounts. */
const FILTER_DATE_INPUT_CLASS = 'date-picker-native field';

let _datePickerOutsideCloseBound = false;

function applyFilterDateFieldInput(input) {
    if (!input || input.type !== 'date') return input;
    input.className = FILTER_DATE_INPUT_CLASS;
    input.placeholder = DATE_PICKER_PLACEHOLDER;
    if (!input.hasAttribute('data-date-picker')) input.setAttribute('data-date-picker', '');
    return input;
}

/** Mount scheduler-style filter date field (segmented input + custom calendar). */
function setupFilterDatePicker(input, options = {}) {
    if (!input) return;
    applyFilterDateFieldInput(input);
    setupDatePicker(input, options);
}

function closeAllDatePickerPopups() {
    document.querySelectorAll('.date-picker-popup').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('.date-picker-open, .date-picker-open-native').forEach((b) => {
        b.setAttribute('aria-expanded', 'false');
    });
}

function onDatePickerDocumentClick(e) {
    if (e.target.closest('.date-picker-wrap') || e.target.closest('.date-picker-popup-host')) return;
    closeAllDatePickerPopups();
}

function buildDatePickerPopupElement() {
    const popup = document.createElement('div');
    popup.className = 'date-picker-popup hidden';
    popup.setAttribute('role', 'dialog');
    popup.innerHTML = [
        '<div class="date-picker-header">',
        '<button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous month">',
        '<i class="fas fa-chevron-left"></i></button>',
        '<span class="date-picker-title"></span>',
        '<button type="button" class="date-picker-nav" data-nav="next" aria-label="Next month">',
        '<i class="fas fa-chevron-right"></i></button>',
        '</div>',
        '<div class="date-picker-weekdays"></div>',
        '<div class="date-picker-grid" role="grid"></div>',
    ].join('');
    popup.addEventListener('mousedown', (e) => e.stopPropagation());
    const weekdaysEl = popup.querySelector('.date-picker-weekdays');
    weekdaysEl.innerHTML = DATE_PICKER_WEEKDAYS.map((d) =>
        `<span class="date-picker-weekday">${d}</span>`).join('');
    return {
        popup,
        titleEl: popup.querySelector('.date-picker-title'),
        gridEl: popup.querySelector('.date-picker-grid'),
        weekdaysEl,
    };
}

function bindDatePickerPopup(popup, input, hooks) {
    const { titleEl, gridEl } = hooks;
    const { onEmitChange, onBeforeOpen } = hooks;
    let viewYear;
    let viewMonth;

    const syncViewFromValue = () => {
        const p = parseIsoDate(input.value);
        const now = new Date();
        viewYear = p ? p.y : now.getFullYear();
        viewMonth = p ? p.mo : now.getMonth() + 1;
    };

    const renderCalendar = () => {
        titleEl.textContent = `${DATE_PICKER_MONTHS[viewMonth - 1]} ${viewYear}`;
        const first = new Date(viewYear, viewMonth - 1, 1);
        let start = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
        const prevDays = new Date(viewYear, viewMonth - 1, 0).getDate();
        const selected = parseIsoDate(input.value);
        const now = new Date();
        const todayIso = toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());

        const cells = [];
        for (let i = 0; i < start; i++) {
            const d = prevDays - start + i + 1;
            const mo = viewMonth === 1 ? 12 : viewMonth - 1;
            const y = viewMonth === 1 ? viewYear - 1 : viewYear;
            cells.push({ d, mo, y, outside: true });
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push({ d, mo: viewMonth, y: viewYear, outside: false });
        }
        let tail = 42 - cells.length;
        if (tail < 0) tail += 7;
        for (let i = 1; i <= tail; i++) {
            const mo = viewMonth === 12 ? 1 : viewMonth + 1;
            const y = viewMonth === 12 ? viewYear + 1 : viewYear;
            cells.push({ d: i, mo, y, outside: true });
        }

        gridEl.innerHTML = cells.map((c) => {
            const iso = toIsoDate(c.y, c.mo, c.d);
            const isSel = selected && selected.y === c.y && selected.mo === c.mo && selected.d === c.d;
            const isToday = iso === todayIso;
            const cls = [
                'date-picker-day',
                c.outside ? 'is-outside' : '',
                isToday ? 'is-today' : '',
                isSel ? 'is-selected' : '',
            ].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-iso="${iso}" role="gridcell">${c.d}</button>`;
        }).join('');

        gridEl.querySelectorAll('.date-picker-day').forEach((cell) => {
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = cell.dataset.iso;
                closeAllDatePickerPopups();
                onEmitChange();
            });
        });
    };

    const bindNav = (sel, delta) => {
        const navBtn = popup.querySelector(sel);
        if (!navBtn || navBtn.dataset.datePickerNavBound === '1') return;
        navBtn.dataset.datePickerNavBound = '1';
        navBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (delta < 0) {
                if (viewMonth === 1) {
                    viewMonth = 12;
                    viewYear -= 1;
                } else {
                    viewMonth -= 1;
                }
            } else if (viewMonth === 12) {
                viewMonth = 1;
                viewYear += 1;
            } else {
                viewMonth += 1;
            }
            renderCalendar();
        });
    };
    bindNav('[data-nav="prev"]', -1);
    bindNav('[data-nav="next"]', 1);

    const openPopup = () => {
        onBeforeOpen?.();
        syncViewFromValue();
        renderCalendar();
        popup.classList.remove('hidden');
    };

    input._datePickerRender = renderCalendar;
    input._datePickerOpenPopup = openPopup;
    return { openPopup, renderCalendar, syncViewFromValue };
}

function migrateLegacySegmentedDatePickerToPopupHost(input) {
    const legacyWrap = input.closest('.date-picker-wrap');
    if (!legacyWrap) return;
    const host = legacyWrap.parentElement;
    if (!host) return;
    legacyWrap.querySelector('.date-picker-control')?.remove();
    const popup = legacyWrap.querySelector('.date-picker-popup');
    if (popup) host.appendChild(popup);
    host.insertBefore(input, legacyWrap);
    legacyWrap.remove();
    input.classList.remove('date-picker-native');
    delete input.dataset.datePicker;
}

/** Keep native date input; attach custom calendar popup only. */
function setupDatePickerPopupOnly(input, options = {}) {
    if (!input || input.type !== 'date') return;
    if (options.onChange) input._datePickerOnChange = options.onChange;

    migrateLegacySegmentedDatePickerToPopupHost(input);

    if (input.dataset.datePickerPopup === '1') return;
    input.dataset.datePickerPopup = '1';
    input.classList.add('date-picker-has-popup');

    const host = input.parentElement;
    if (!host) return;
    host.classList.add('date-picker-popup-host');

    const emitChange = () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (input._datePickerOnChange) input._datePickerOnChange();
    };

    let popup = host.querySelector(':scope > .date-picker-popup');
    let titleEl;
    let gridEl;
    if (!popup) {
        ({ popup, titleEl, gridEl } = buildDatePickerPopupElement());
        host.appendChild(popup);
    } else {
        titleEl = popup.querySelector('.date-picker-title');
        gridEl = popup.querySelector('.date-picker-grid');
    }

    let openBtn = host.querySelector('.date-picker-open-native');
    if (!openBtn) {
        openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'date-picker-open-native';
        openBtn.title = 'Open calendar';
        openBtn.setAttribute('aria-label', 'Open calendar');
        openBtn.setAttribute('aria-haspopup', 'dialog');
        openBtn.setAttribute('aria-expanded', 'false');
        openBtn.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i>';
        const clearBtn = host.querySelector('.icon-clear-btn');
        if (clearBtn) host.insertBefore(openBtn, clearBtn);
        else host.appendChild(openBtn);
    }

    const { openPopup } = bindDatePickerPopup(popup, input, {
        titleEl,
        gridEl,
        onEmitChange: emitChange,
    });

    const togglePopup = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = !popup.classList.contains('hidden');
        closeAllDatePickerPopups();
        if (!wasOpen) {
            openPopup();
            openBtn.setAttribute('aria-expanded', 'true');
        }
    };

    if (openBtn.dataset.datePickerOpenNativeBound !== '1') {
        openBtn.dataset.datePickerOpenNativeBound = '1';
        openBtn.addEventListener('click', togglePopup);
    }

    if (input.dataset.datePickerPopupInputBound !== '1') {
        input.dataset.datePickerPopupInputBound = '1';
        input.addEventListener('click', (e) => {
            e.preventDefault();
            togglePopup(e);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                togglePopup(e);
            }
        });
    }

    if (!_datePickerOutsideCloseBound) {
        _datePickerOutsideCloseBound = true;
        document.addEventListener('click', onDatePickerDocumentClick);
    }
}

function parseIsoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y, mo, d };
}

function toIsoDate(y, mo, d) {
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDatePickerLabel(iso, showYear) {
    const p = parseIsoDate(iso);
    if (!p) return '';
    const base = `${String(p.d).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}`;
    return showYear ? `${base}.${p.y}` : base;
}

function parseManualDate(text, fallbackYear) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 6) {
        const d = +digits.slice(0, 2);
        const mo = +digits.slice(2, 4);
        let y = +digits.slice(4);
        if (digits.length === 6) y = y + (y < 70 ? 2000 : 1900);
        return parseIsoDate(toIsoDate(y, mo, d));
    }

    const normalized = raw.replace(/[/-]/g, '.').replace(/\s+/g, '');
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    if (isoMatch) return parseIsoDate(toIsoDate(+isoMatch[1], +isoMatch[2], +isoMatch[3]));

    const parts = normalized.split('.').filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;

    const d = +parts[0];
    const mo = +parts[1];
    let y = parts.length === 3 ? +parts[2] : (fallbackYear ?? new Date().getFullYear());
    if (parts.length === 3 && parts[2].length === 2) {
        y = +parts[2] + (+parts[2] < 70 ? 2000 : 1900);
    }
    if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
    return parseIsoDate(toIsoDate(y, mo, d));
}

function createDatePickerSegments() {
    const box = document.createElement('div');
    box.className = 'date-picker-segments';
    box.setAttribute('role', 'group');

    const mk = (seg, ph, max) => {
        const el = document.createElement('input');
        el.type = 'text';
        el.className = 'date-picker-seg';
        el.dataset.seg = seg;
        el.setAttribute('inputmode', 'numeric');
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('spellcheck', 'false');
        el.placeholder = ph;
        el.maxLength = max;
        el.setAttribute('aria-label', ph);
        return el;
    };

    const dInp = mk('d', 'dd', 2);
    const mInp = mk('m', 'mm', 2);
    const yInp = mk('y', 'yyyy', 4);
    const sep = () => {
        const s = document.createElement('span');
        s.className = 'date-picker-sep';
        s.textContent = '.';
        s.setAttribute('aria-hidden', 'true');
        return s;
    };

    box.append(dInp, sep(), mInp, sep(), yInp);
    return { box, dInp, mInp, yInp };
}

function fillDatePickerSegments(dInp, mInp, yInp, iso) {
    const p = parseIsoDate(iso);
    if (!p) {
        dInp.value = '';
        mInp.value = '';
        yInp.value = '';
        return;
    }
    dInp.value = String(p.d).padStart(2, '0');
    mInp.value = String(p.mo).padStart(2, '0');
    yInp.value = String(p.y);
}

function parseSegmentYear(raw) {
    if (!raw) return null;
    if (raw.length === 2) {
        const y = +raw + (+raw < 70 ? 2000 : 1900);
        return Number.isFinite(y) ? y : null;
    }
    if (raw.length >= 4) {
        const y = +raw.slice(0, 4);
        return Number.isFinite(y) ? y : null;
    }
    return null;
}

function parseSegmentMonth(raw) {
    if (!raw) return null;
    const mo = +raw;
    return Number.isFinite(mo) && mo >= 1 && mo <= 12 ? mo : null;
}

function segmentsMatchInput(dInp, mInp, yInp, input) {
    const p = parseIsoDate(input?.value);
    if (!p) {
        return !(dInp?.value.trim() || mInp?.value.trim() || yInp?.value.trim());
    }
    const y = parseSegmentYear((yInp?.value || '').replace(/\D/g, ''));
    const mo = parseSegmentMonth((mInp?.value || '').replace(/\D/g, ''));
    const dRaw = (dInp?.value || '').replace(/\D/g, '');
    if (y != null && y !== p.y) return false;
    if (mo != null && mo !== p.mo) return false;
    if (dRaw && +dRaw !== p.d) return false;
    return true;
}

/** Calendar view from segments first; committed date only when segments are empty. */
function readSegmentCalendarView(dInp, mInp, yInp, input) {
    const now = new Date();
    const dRaw = (dInp?.value || '').replace(/\D/g, '');
    const mRaw = (mInp?.value || '').replace(/\D/g, '');
    const yRaw = (yInp?.value || '').replace(/\D/g, '');
    const hasSeg = !!(dRaw || mRaw || yRaw);
    const y = parseSegmentYear(yRaw);
    const mo = parseSegmentMonth(mRaw);
    const d = dRaw ? +dRaw : null;

    if (hasSeg) {
        if (d && mo && y) {
            const parsed = parseIsoDate(toIsoDate(y, mo, d));
            if (parsed) return { y: parsed.y, mo: parsed.mo };
            return { y, mo };
        }
        if (mo && y) return { y, mo };
        if (y) return { y, mo: now.getMonth() + 1 };
        if (mo) return { y: now.getFullYear(), mo };
    }

    const committed = parseIsoDate(input?.value);
    if (committed) return { y: committed.y, mo: committed.mo };

    return { y: now.getFullYear(), mo: now.getMonth() + 1 };
}

function commitDatePickerSegments(dInp, mInp, yInp, fallbackYear) {
    const dRaw = dInp.value.replace(/\D/g, '');
    const mRaw = mInp.value.replace(/\D/g, '');
    const yRaw = yInp.value.replace(/\D/g, '');
    if (!dRaw && !mRaw && !yRaw) return { empty: true };
    if (!dRaw || !mRaw) return { invalid: true };

    let y = yRaw ? +yRaw : (fallbackYear ?? new Date().getFullYear());
    if (yRaw.length === 2) y = +yRaw + (+yRaw < 70 ? 2000 : 1900);
    const parsed = parseIsoDate(toIsoDate(y, +mRaw, +dRaw));
    if (!parsed) return { invalid: true };
    return { parsed, iso: toIsoDate(parsed.y, parsed.mo, parsed.d) };
}

function bindDatePickerSegments(ctx) {
    const { dInp, mInp, yInp, getFallbackYear, onCommit, onDraft } = ctx;
    const order = [dInp, mInp, yInp];
    const maxLens = [2, 2, 4];
    let commitTimer = null;

    const focusSeg = (el) => {
        el.focus();
        el.select();
    };

    const scheduleCommit = () => {
        clearTimeout(commitTimer);
        commitTimer = setTimeout(() => {
            if (!order.some((el) => el === document.activeElement)) onCommit();
        }, 0);
    };

    const applyPaste = (text) => {
        const parsed = parseManualDate(text, getFallbackYear());
        if (!parsed) return false;
        fillDatePickerSegments(dInp, mInp, yInp, toIsoDate(parsed.y, parsed.mo, parsed.d));
        onCommit();
        return true;
    };

    order.forEach((el, idx) => {
        if (el.dataset.datePickerSegBound === '1') return;
        el.dataset.datePickerSegBound = '1';

        el.addEventListener('focus', () => el.select());

        el.addEventListener('input', () => {
            const max = maxLens[idx];
            const v = el.value.replace(/\D/g, '').slice(0, max);
            if (el.value !== v) el.value = v;
            if (v.length >= max && idx < order.length - 1) focusSeg(order[idx + 1]);
            onDraft?.();
        });

        el.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && idx < order.length - 1) {
                e.preventDefault();
                focusSeg(order[idx + 1]);
            }
            if (e.key === 'ArrowLeft' && el.selectionStart === 0 && idx > 0) {
                e.preventDefault();
                focusSeg(order[idx - 1]);
            }
            if (e.key === 'Backspace' && !el.value && idx > 0) {
                e.preventDefault();
                focusSeg(order[idx - 1]);
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                onCommit();
            }
            if (e.key === 'Escape') closeAllDatePickerPopups();
        });

        el.addEventListener('blur', scheduleCommit);

        el.addEventListener('paste', (e) => {
            const text = e.clipboardData?.getData('text') || '';
            if (applyPaste(text)) e.preventDefault();
        });
    });
}

function buildDatePickerControl(wrap, input, controlClasses) {
    const control = document.createElement('div');
    control.className = 'date-picker-control';
    controlClasses.forEach((c) => control.classList.add(c));

    const { box, dInp, mInp, yInp } = createDatePickerSegments();

    const trail = document.createElement('span');
    trail.className = 'date-picker-trail';

    const clearBtn = document.createElement('span');
    clearBtn.className = 'date-picker-clear hidden';
    clearBtn.setAttribute('role', 'button');
    clearBtn.tabIndex = -1;
    clearBtn.title = 'Clear date';
    clearBtn.dataset.datePickerManaged = '1';
    if (input.id) clearBtn.dataset.clear = input.id;
    clearBtn.innerHTML = '<i class="fas fa-times"></i>';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'date-picker-open';
    openBtn.title = 'Open calendar';
    openBtn.setAttribute('aria-label', 'Open calendar');
    openBtn.setAttribute('aria-haspopup', 'dialog');
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i>';

    trail.appendChild(clearBtn);
    trail.appendChild(openBtn);
    control.appendChild(box);
    control.appendChild(trail);
    input.insertAdjacentElement('afterend', control);
    return { control, dInp, mInp, yInp, clearBtn, openBtn };
}

function migrateDatePickerControlDom(control, input) {
    const legacyBtn = control.closest('.date-picker-wrap')?.querySelector('.date-picker-btn');
    if (legacyBtn) {
        const wrap = control.closest('.date-picker-wrap');
        const misplacedPopup = legacyBtn.querySelector('.date-picker-popup');
        if (misplacedPopup) wrap.appendChild(misplacedPopup);
        legacyBtn.remove();
    }

    const single = control.querySelector('.date-picker-input');
    if (single && !control.querySelector('.date-picker-segments')) {
        const parsed = parseManualDate(single.value, new Date().getFullYear());
        const { box, dInp, mInp, yInp } = createDatePickerSegments();
        if (parsed) {
            fillDatePickerSegments(dInp, mInp, yInp, toIsoDate(parsed.y, parsed.mo, parsed.d));
        }
        single.replaceWith(box);
        control.dataset.datePickerSegsBound = '';
    }
}

function migrateLegacyDatePickerWrap(wrap, input) {
    if (!wrap) return;
    const legacyBtn = wrap.querySelector('.date-picker-btn');
    if (legacyBtn) {
        const controlClasses = [...legacyBtn.classList].filter(
            (c) => c !== 'date-picker-btn' && c !== 'is-empty',
        );
        const misplacedPopup = legacyBtn.querySelector('.date-picker-popup');
        if (misplacedPopup) wrap.appendChild(misplacedPopup);
        legacyBtn.remove();
        if (!wrap.querySelector('.date-picker-control')) {
            buildDatePickerControl(wrap, input, controlClasses);
        }
    }
    const control = wrap.querySelector('.date-picker-control');
    if (control) migrateDatePickerControlDom(control, input);
}

/** Custom calendar + segmented dd.mm.yyyy input; hidden input stores YYYY-MM-DD. */
function setupDatePicker(input, options = {}) {
    if (!input) return;
    if (options.onChange) input._datePickerOnChange = options.onChange;

    if (input.dataset.datePicker === '1') {
        const existingWrap = input.closest('.date-picker-wrap');
        migrateLegacyDatePickerWrap(existingWrap, input);
        const control = existingWrap?.querySelector('.date-picker-control');
        if (control?.querySelector('.date-picker-segments') && control.dataset.datePickerSegsBound !== '1') {
            delete input.dataset.datePicker;
            setupDatePicker(input, options);
            return;
        }
        const misplacedPopup = existingWrap?.querySelector('.date-picker-control .date-picker-popup');
        if (misplacedPopup && existingWrap) existingWrap.appendChild(misplacedPopup);
        refreshDatePicker(input);
        return;
    }

    input.dataset.datePicker = '1';

    let wrap = input.closest('.date-picker-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'date-picker-wrap';
        if (input.classList.contains('field')) wrap.classList.add('date-picker-wrap--field');
        if (input.classList.contains('input-field')) wrap.classList.add('date-picker-wrap--input');
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
    }

    input.classList.add('date-picker-native');

    const controlClasses = [];
    if (input.classList.contains('field')) controlClasses.push('field');
    else if (input.classList.contains('input-field')) controlClasses.push('input-field');

    migrateLegacyDatePickerWrap(wrap, input);

    let control = wrap.querySelector('.date-picker-control');
    let dInp = wrap.querySelector('.date-picker-seg[data-seg="d"]');
    let mInp = wrap.querySelector('.date-picker-seg[data-seg="m"]');
    let yInp = wrap.querySelector('.date-picker-seg[data-seg="y"]');
    let clearBtn = wrap.querySelector('.date-picker-clear');
    let openBtn = wrap.querySelector('.date-picker-open');

    if (!control) {
        ({ control, dInp, mInp, yInp, clearBtn, openBtn } = buildDatePickerControl(
            wrap, input, controlClasses,
        ));
    } else {
        migrateDatePickerControlDom(control, input);
        dInp = wrap.querySelector('.date-picker-seg[data-seg="d"]');
        mInp = wrap.querySelector('.date-picker-seg[data-seg="m"]');
        yInp = wrap.querySelector('.date-picker-seg[data-seg="y"]');
    }

    let popup = wrap.querySelector('.date-picker-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.className = 'date-picker-popup hidden';
        popup.setAttribute('role', 'dialog');
        popup.innerHTML = [
            '<div class="date-picker-header">',
            '<button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous month">',
            '<i class="fas fa-chevron-left"></i></button>',
            '<span class="date-picker-title"></span>',
            '<button type="button" class="date-picker-nav" data-nav="next" aria-label="Next month">',
            '<i class="fas fa-chevron-right"></i></button>',
            '</div>',
            '<div class="date-picker-weekdays"></div>',
            '<div class="date-picker-grid" role="grid"></div>',
        ].join('');
        wrap.appendChild(popup);
        popup.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const titleEl = popup.querySelector('.date-picker-title');
    const gridEl = popup.querySelector('.date-picker-grid');
    const weekdaysEl = popup.querySelector('.date-picker-weekdays');
    weekdaysEl.innerHTML = DATE_PICKER_WEEKDAYS.map((d) =>
        `<span class="date-picker-weekday">${d}</span>`).join('');

    let viewYear;
    let viewMonth;

    function syncViewFromValue() {
        const v = readSegmentCalendarView(dInp, mInp, yInp, input);
        viewYear = v.y;
        viewMonth = v.mo;
    }

    const segInputs = [dInp, mInp, yInp];

    function segmentsActive() {
        return segInputs.some((el) => el === document.activeElement);
    }

    function syncDisplay() {
        const has = !!input.value;
        const anySeg = segInputs.some((el) => el.value.trim());
        if (!segmentsActive()) {
            if (has && (!anySeg || !segmentsMatchInput(dInp, mInp, yInp, input))) {
                fillDatePickerSegments(dInp, mInp, yInp, input.value);
            } else if (!has && !anySeg) {
                fillDatePickerSegments(dInp, mInp, yInp, '');
            }
        }
        control.classList.toggle('is-empty', !has && !anySeg);
        clearBtn.classList.toggle('hidden', !has && !anySeg);
        wrap.classList.toggle('has-value', has || anySeg);
        input.title = input.value || '';
    }

    function emitChange() {
        syncDisplay();
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (input._datePickerOnChange) input._datePickerOnChange();
    }

    function commitSegments() {
        const result = commitDatePickerSegments(dInp, mInp, yInp, viewYear);
        if (result.empty) {
            if (input.value) {
                input.value = '';
                emitChange();
            } else {
                syncDisplay();
            }
            return;
        }
        if (result.invalid) {
            return;
        }
        viewYear = result.parsed.y;
        viewMonth = result.parsed.mo;
        fillDatePickerSegments(dInp, mInp, yInp, result.iso);
        if (input.value !== result.iso) {
            input.value = result.iso;
            emitChange();
        } else {
            syncDisplay();
        }
    }

    function renderCalendar() {
        titleEl.textContent = `${DATE_PICKER_MONTHS[viewMonth - 1]} ${viewYear}`;
        const first = new Date(viewYear, viewMonth - 1, 1);
        let start = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
        const prevDays = new Date(viewYear, viewMonth - 1, 0).getDate();
        let selectedIso = input.value || '';
        if (!selectedIso) {
            const dRaw = (dInp?.value || '').replace(/\D/g, '');
            const y = parseSegmentYear((yInp?.value || '').replace(/\D/g, ''));
            const mo = parseSegmentMonth((mInp?.value || '').replace(/\D/g, ''));
            const d = dRaw ? +dRaw : null;
            if (d && mo && y) {
                const p = parseIsoDate(toIsoDate(y, mo, d));
                if (p) selectedIso = toIsoDate(p.y, p.mo, p.d);
            }
        }
        const selected = parseIsoDate(selectedIso);
        const now = new Date();
        const todayIso = toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());

        const cells = [];
        for (let i = 0; i < start; i++) {
            const d = prevDays - start + i + 1;
            const mo = viewMonth === 1 ? 12 : viewMonth - 1;
            const y = viewMonth === 1 ? viewYear - 1 : viewYear;
            cells.push({ d, mo, y, outside: true });
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push({ d, mo: viewMonth, y: viewYear, outside: false });
        }
        let tail = 42 - cells.length;
        if (tail < 0) tail += 7;
        for (let i = 1; i <= tail; i++) {
            const mo = viewMonth === 12 ? 1 : viewMonth + 1;
            const y = viewMonth === 12 ? viewYear + 1 : viewYear;
            cells.push({ d: i, mo, y, outside: true });
        }

        gridEl.innerHTML = cells.map((c) => {
            const iso = toIsoDate(c.y, c.mo, c.d);
            const isSel = selected && selected.y === c.y && selected.mo === c.mo && selected.d === c.d;
            const isToday = iso === todayIso;
            const cls = [
                'date-picker-day',
                c.outside ? 'is-outside' : '',
                isToday ? 'is-today' : '',
                isSel ? 'is-selected' : '',
            ].filter(Boolean).join(' ');
            return `<button type="button" class="${cls}" data-iso="${iso}" role="gridcell">${c.d}</button>`;
        }).join('');

        gridEl.querySelectorAll('.date-picker-day').forEach((cell) => {
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = cell.dataset.iso;
                closeAllDatePickerPopups();
                emitChange();
            });
        });
    }

    const bindNav = (sel, delta) => {
        const navBtn = popup.querySelector(sel);
        if (!navBtn || navBtn.dataset.datePickerNavBound === '1') return;
        navBtn.dataset.datePickerNavBound = '1';
        navBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (delta < 0) {
                if (viewMonth === 1) {
                    viewMonth = 12;
                    viewYear -= 1;
                } else {
                    viewMonth -= 1;
                }
            } else if (viewMonth === 12) {
                viewMonth = 1;
                viewYear += 1;
            } else {
                viewMonth += 1;
            }
            renderCalendar();
        });
    };
    bindNav('[data-nav="prev"]', -1);
    bindNav('[data-nav="next"]', 1);

    if (openBtn.dataset.datePickerOpenBound !== '1') {
        openBtn.dataset.datePickerOpenBound = '1';
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasOpen = !popup.classList.contains('hidden');
            closeAllDatePickerPopups();
            if (!wasOpen) {
                syncViewFromValue();
                renderCalendar();
                popup.classList.remove('hidden');
                openBtn.setAttribute('aria-expanded', 'true');
            }
        });
    }

    if (control.dataset.datePickerSegsBound !== '1') {
        control.dataset.datePickerSegsBound = '1';
        bindDatePickerSegments({
            dInp,
            mInp,
            yInp,
            getFallbackYear: () => viewYear,
            onCommit: commitSegments,
            onDraft: () => {
                const v = readSegmentCalendarView(dInp, mInp, yInp, input);
                viewYear = v.y;
                viewMonth = v.mo;
                if (!popup.classList.contains('hidden')) renderCalendar();
                const has = !!input.value;
                const anySeg = segInputs.some((el) => el.value.trim());
                control.classList.toggle('is-empty', !has && !anySeg);
                clearBtn.classList.toggle('hidden', !has && !anySeg);
                wrap.classList.toggle('has-value', has || anySeg);
            },
        });
    }

    if (clearBtn.dataset.datePickerClearBound !== '1') {
        clearBtn.dataset.datePickerClearBound = '1';
        const onClear = (e) => {
            e.preventDefault();
            e.stopPropagation();
            input.value = '';
            fillDatePickerSegments(dInp, mInp, yInp, '');
            closeAllDatePickerPopups();
            emitChange();
        };
        clearBtn.addEventListener('click', onClear);
        clearBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') onClear(e);
        });
    }

    if (input.dataset.datePickerChangeBound !== '1') {
        input.dataset.datePickerChangeBound = '1';
        input.addEventListener('change', syncDisplay);
    }

    input._datePickerRender = renderCalendar;
    input._datePickerCommitSegments = commitSegments;
    syncViewFromValue();
    syncDisplay();
}

function refreshDatePicker(input) {
    if (!input || input.dataset.datePicker !== '1') return;
    const wrap = input.closest('.date-picker-wrap');
    migrateLegacyDatePickerWrap(wrap, input);
    const dInp = wrap?.querySelector('.date-picker-seg[data-seg="d"]');
    const mInp = wrap?.querySelector('.date-picker-seg[data-seg="m"]');
    const yInp = wrap?.querySelector('.date-picker-seg[data-seg="y"]');
    const control = wrap?.querySelector('.date-picker-control');
    const clearBtn = wrap?.querySelector('.date-picker-clear');
    if (!dInp || !control) return;
    const segs = [dInp, mInp, yInp];
    const has = !!input.value;
    const anySeg = segs.some((el) => el.value.trim());
    if (!segs.some((el) => el === document.activeElement)) {
        if (has && (!anySeg || !segmentsMatchInput(dInp, mInp, yInp, input))) {
            fillDatePickerSegments(dInp, mInp, yInp, input.value);
        } else if (!has && !anySeg) {
            fillDatePickerSegments(dInp, mInp, yInp, '');
        }
    }
    control.classList.toggle('is-empty', !has && !anySeg);
    clearBtn?.classList.toggle('hidden', !has && !anySeg);
    wrap?.classList.toggle('has-value', has || anySeg);
}

function initDatePickers(root = document, options = {}) {
    root.querySelectorAll('input[type="date"][data-date-picker]:not([data-date-picker-skip])').forEach((inp) => {
        setupFilterDatePicker(inp, options);
    });
    if (!_datePickerOutsideCloseBound) {
        _datePickerOutsideCloseBound = true;
        document.addEventListener('click', onDatePickerDocumentClick);
    }
}

/** Date + time UI for reminder datetime-local (custom date picker + native time). */
function setupDateTimePicker(dtInput, options = {}) {
    if (!dtInput || dtInput.type !== 'datetime-local') return;
    if (options.onChange) dtInput._dateTimePickerOnChange = options.onChange;

    if (dtInput.dataset.datetimePicker === '1') {
        dtInput._datetimePickerSync?.();
        return;
    }
    dtInput.dataset.datetimePicker = '1';
    dtInput.classList.add('datetime-picker-native');

    let wrap = dtInput.closest('.datetime-picker-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'datetime-picker-wrap';
        dtInput.parentNode.insertBefore(wrap, dtInput);
        wrap.appendChild(dtInput);
    }

    let dateInput = wrap.querySelector('input[type="date"].datetime-picker-date-part');
    if (!dateInput) {
        dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.className = 'date-picker-native datetime-picker-date-part field';
        dateInput.tabIndex = -1;
        dateInput.setAttribute('aria-hidden', 'true');
        wrap.insertBefore(dateInput, dtInput.nextSibling);
    }

    let timeInput = wrap.querySelector('.datetime-picker-time');
    if (!timeInput) {
        timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.className = 'datetime-picker-time input-field w-36';
        timeInput.required = dtInput.required;
        if (dtInput.id) {
            timeInput.id = `${dtInput.id}__time`;
            timeInput.setAttribute('aria-label', 'Time');
        }
        wrap.appendChild(timeInput);
    }

    const syncFromDatetime = () => {
        const v = dtInput.value;
        if (!v) {
            dateInput.value = '';
            timeInput.value = '';
        } else {
            const [d, t] = v.split('T');
            dateInput.value = d || '';
            timeInput.value = (t || '').slice(0, 5);
        }
        if (dateInput.dataset.datePicker === '1' && typeof refreshDatePicker === 'function') {
            refreshDatePicker(dateInput);
        }
    };

    const syncToDatetime = () => {
        const d = dateInput.value;
        const t = timeInput.value;
        if (!d && !t) {
            dtInput.value = '';
        } else if (d && t) {
            dtInput.value = `${d}T${t}`;
        } else if (d) {
            dtInput.value = `${d}T00:00`;
        } else {
            dtInput.value = '';
        }
        dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        dtInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (dtInput._dateTimePickerOnChange) dtInput._dateTimePickerOnChange();
    };

    setupDatePicker(dateInput, { onChange: syncToDatetime, ...options.dateOptions });
    if (timeInput.dataset.datetimeTimeBound !== '1') {
        timeInput.dataset.datetimeTimeBound = '1';
        timeInput.addEventListener('input', syncToDatetime);
        timeInput.addEventListener('change', syncToDatetime);
    }

    dtInput._datetimePickerSync = syncFromDatetime;
    syncFromDatetime();
}

function refreshDateTimePicker(dtInput) {
    if (!dtInput || dtInput.dataset.datetimePicker !== '1') return;
    dtInput._datetimePickerSync?.();
}

function initDateTimePickers(root = document, options = {}) {
    root.querySelectorAll('input[type="datetime-local"][data-datetime-picker]:not([data-datetime-picker-skip])').forEach((inp) => {
        setupDateTimePicker(inp, options);
    });
}

function bootDatePickers() {
    initDatePickers(document);
    initDateTimePickers(document);
}

/** @deprecated Use setupFilterDatePicker / data-date-picker */
function initDateFilterMd(inputId, onChange) {
    const input = document.getElementById(inputId);
    if (input) setupFilterDatePicker(input, { onChange });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDatePickers);
} else {
    bootDatePickers();
}

let _customSelectOutsideCloseBound = false;

function getSelectDisplayLabel(select) {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.textContent.trim() : '';
}

function closeAllCustomSelectDropdowns() {
    document.querySelectorAll('.custom-select-dd').forEach(dd => dd.classList.add('hidden'));
    document.querySelectorAll('.custom-select-btn').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
}

function measureSelectOptionTextWidth(text, styles, sizer) {
    const sample = String(text || '').trim();
    if (!sample) return 0;
    sizer.textContent = sample;
    sizer.style.font = styles.font;
    if (sizer.offsetWidth > 0) return sizer.offsetWidth;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.font = `${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    return ctx.measureText(sample).width;
}

function syncCustomSelectWidth(select) {
    const wrap = select?.closest('.custom-select-enhanced');
    const btn = wrap?.querySelector('.custom-select-btn');
    if (!wrap || !btn) return;

    let sizer = wrap.querySelector('.custom-select-sizer');
    if (!sizer) {
        sizer = document.createElement('span');
        sizer.className = 'custom-select-sizer';
        sizer.setAttribute('aria-hidden', 'true');
        wrap.appendChild(sizer);
    }

    const styles = getComputedStyle(btn);

    let maxTextW = 0;
    [...select.options].forEach((opt) => {
        if (opt.hidden) return;
        maxTextW = Math.max(maxTextW, measureSelectOptionTextWidth(opt.textContent, styles, sizer));
    });

    const clearBtn = wrap.querySelector('.icon-clear-btn');
    const isSm = select.classList.contains('select-sm');
    const padL = parseFloat(styles.paddingLeft) || 0;
    const padR = clearBtn
        ? (isSm ? 48 : 56)
        : (parseFloat(styles.paddingRight) || 0);
    const borderX = (parseFloat(styles.borderLeftWidth) || 0) + (parseFloat(styles.borderRightWidth) || 0);
    const fixedWidth = Math.ceil(maxTextW + padL + padR + borderX);

    wrap.dataset.customSelectWidth = String(fixedWidth);
    wrap.style.minWidth = `${fixedWidth}px`;
    if (select.classList.contains('w-full')) {
        wrap.style.width = '100%';
    } else {
        wrap.style.width = `${fixedWidth}px`;
    }
}

function refreshCustomSelect(select) {
    if (!select || select.dataset.customSelect !== '1') return;
    const wrap = select.closest('.custom-select-enhanced');
    const label = wrap?.querySelector('.custom-select-label');
    if (label) label.textContent = getSelectDisplayLabel(select);
    if (typeof select._customSelectBuildOptions === 'function') select._customSelectBuildOptions();
    const btn = wrap?.querySelector('.custom-select-btn');
    if (btn) btn.disabled = select.disabled;
    syncCustomSelectWidth(select);
}

/** Replace native select UI with custom dropdown; keeps the select for value/events. */
function setupCustomSelect(select) {
    if (!select || select.tagName !== 'SELECT') return;
    if (select.dataset.customSelectSkip === '1') return;
    if (select.dataset.customSelect === '1') {
        refreshCustomSelect(select);
        return;
    }
    select.dataset.customSelect = '1';

    let wrap = select.closest('.select-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'select-wrap custom-select-enhanced relative';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
    } else {
        wrap.classList.add('custom-select-enhanced', 'relative');
    }

    select.classList.add('custom-select-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-btn';
    if (select.classList.contains('select-sm')) btn.classList.add('select-sm');
    for (const cls of select.classList) {
        if (/^w-/.test(cls) || cls === 'text-sm' || cls === 'py-2' || cls === 'px-2') btn.classList.add(cls);
    }
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-label';
    labelSpan.textContent = getSelectDisplayLabel(select);

    const chevron = document.createElement('i');
    chevron.className = 'fas fa-chevron-down custom-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    btn.appendChild(labelSpan);
    btn.appendChild(chevron);

    const dd = document.createElement('div');
    dd.className = 'custom-select-dd hidden';
    dd.setAttribute('role', 'listbox');

    select.insertAdjacentElement('afterend', btn);
    btn.insertAdjacentElement('afterend', dd);

    function buildOptions() {
        dd.innerHTML = '';
        [...select.options].forEach(opt => {
            if (opt.hidden) return;
            const row = document.createElement('div');
            row.className = 'custom-select-option';
            row.setAttribute('role', 'option');
            row.dataset.value = opt.value;
            row.textContent = opt.textContent;
            if (opt.value === select.value) row.classList.add('is-selected');
            if (opt.disabled) row.classList.add('is-disabled');
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (opt.disabled) return;
                select.value = opt.value;
                labelSpan.textContent = opt.textContent.trim();
                closeAllCustomSelectDropdowns();
                buildOptions();
                select.dispatchEvent(new Event('change', { bubbles: true }));
                select.dispatchEvent(new Event('input', { bubbles: true }));
            });
            dd.appendChild(row);
        });
    }

    select._customSelectBuildOptions = buildOptions;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (select.disabled) return;
        const wasOpen = !dd.classList.contains('hidden');
        closeAllCustomSelectDropdowns();
        if (!wasOpen) {
            buildOptions();
            dd.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
        }
    });

    select.addEventListener('change', () => refreshCustomSelect(select));

    const observer = new MutationObserver(() => refreshCustomSelect(select));
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });

    btn.disabled = select.disabled;
    buildOptions();
    syncCustomSelectWidth(select);
}

function initCustomSelects(root = document) {
    root.querySelectorAll('select:not([data-custom-select-skip])').forEach(setupCustomSelect);
    if (!_customSelectOutsideCloseBound) {
        _customSelectOutsideCloseBound = true;
        document.addEventListener('click', closeAllCustomSelectDropdowns);
    }
}

function bootCustomSelects() {
    initCustomSelects(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCustomSelects);
} else {
    bootCustomSelects();
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
window.setupCustomSelect = setupCustomSelect;
window.refreshCustomSelect = refreshCustomSelect;
window.initCustomSelects = initCustomSelects;
window.setupDatePicker = setupDatePicker;
window.setupFilterDatePicker = setupFilterDatePicker;
window.setupDatePickerPopupOnly = setupDatePickerPopupOnly;
window.applyFilterDateFieldInput = applyFilterDateFieldInput;
window.refreshDatePicker = refreshDatePicker;
window.initDatePickers = initDatePickers;
window.initDateFilterMd = initDateFilterMd;
window.setupDateTimePicker = setupDateTimePicker;
window.refreshDateTimePicker = refreshDateTimePicker;
window.initDateTimePickers = initDateTimePickers;
