(() => {
    let activeDays = 7;
    let activeSortBy = 'messages';
    let chart = null;
    let cachedByChar = [];
    let cachedByServer = [];
    let cachedByUser = [];
    let cachedByModel = [];

    function fmtNum(n) {
        if (n == null || n === '') return '0';
        n = Number(n);
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
        return String(n);
    }

    async function fetchAll(days) {
        const qs = `?days=${days}`;
        const [summary, timeseries, byChar, byServer, byModel, byUser] = await Promise.all([
            fetch(`/api/stats/summary${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(`/api/stats/timeseries${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(`/api/stats/by-character${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(`/api/stats/by-server${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(`/api/stats/by-model${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(`/api/stats/by-user${qs}`).then(r => { if (!r.ok) throw r; return r.json(); }),
        ]);
        return { summary, timeseries, byChar, byServer, byModel, byUser };
    }

    function renderKPIs(s) {
        document.getElementById('kpi-total').textContent = fmtNum(s.total);
        document.getElementById('kpi-errors').textContent = fmtNum(s.errors);
        document.getElementById('kpi-tokens').textContent = fmtNum(s.tokens);
        document.getElementById('kpi-users').textContent = fmtNum(s.active_users);

        const rate = s.total > 0 ? Math.round((s.success / s.total) * 100) : null;
        const rateEl = document.getElementById('kpi-success-rate');
        rateEl.textContent = rate != null ? `${rate}% success rate` : '';
        rateEl.className = `text-xs mt-1 ${rate != null && rate < 90 ? 'text-red-400' : 'text-gray-500'}`;
    }

    function formatLabel(day, days) {
        if (days === 1) {
            return day.slice(11, 16); // "2026-05-18 14:00" → "14:00"
        }
        if (days === 0) {
            // "2026-05" → "May '26"
            const [y, m] = day.split('-');
            const d = new Date(+y, +m - 1, 1);
            return d.toLocaleString('en', { month: 'short' }) + " '" + y.slice(2);
        }
        if (days <= 30) {
            // "2026-05-18" → "18 May"
            const d = new Date(day + 'T00:00:00');
            return d.getDate() + ' ' + d.toLocaleString('en', { month: 'short' });
        }
        // 90d weekly — day is Monday ISO date "2026-05-11" → "11 May"
        const d = new Date(day + 'T00:00:00');
        return d.getDate() + ' ' + d.toLocaleString('en', { month: 'short' });
    }

    function renderChart(rows) {
        const wrap = document.getElementById('chart-wrap');
        const empty = document.getElementById('chart-empty');

        if (!rows || !rows.length) {
            wrap.classList.add('hidden');
            empty.classList.remove('hidden');
            if (chart) { chart.destroy(); chart = null; }
            return;
        }

        wrap.classList.remove('hidden');
        empty.classList.add('hidden');

        const labels = rows.map(r => formatLabel(r.day, activeDays));
        const ok = rows.map(r => Math.max(0, r.total - r.errors));
        const errors = rows.map(r => r.errors);

        if (chart) chart.destroy();
        const ctx = document.getElementById('timeseries-chart').getContext('2d');
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'OK', data: ok, backgroundColor: '#6366f1', stack: 'a' },
                    { label: 'Errors', data: errors, backgroundColor: '#f87171', stack: 'a' },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#9ca3af', boxWidth: 12 } },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            footer(items) {
                                const idx = items[0]?.dataIndex;
                                if (idx == null) return '';
                                const tok = rows[idx]?.tokens;
                                return tok > 0 ? `Tokens: ${fmtNum(tok)}` : '';
                            },
                        },
                    },
                },
                scales: {
                    x: { ticks: { color: '#9ca3af', maxRotation: 45 }, grid: { color: '#1f2937' } },
                    y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' }, beginAtZero: true },
                },
            },
        });
    }

    function renderBarList(containerId, rows, sortBy = 'messages') {
        const el = document.getElementById(containerId);
        if (!rows || !rows.length) {
            el.innerHTML = '<p class="text-gray-500 text-sm">No data</p>';
            return;
        }
        const byTokens = sortBy === 'tokens';
        const sorted = [...rows].sort((a, b) => byTokens ? (b.tokens - a.tokens) : (b.total - a.total));
        const max = Math.max(...sorted.map(r => byTokens ? r.tokens : r.total), 1);
        el.innerHTML = sorted.map(r => {
            const primary = byTokens ? r.tokens : r.total;
            const pct = Math.round((primary / max) * 100);
            const errBadge = !byTokens && r.errors > 0
                ? `<span class="stats-err-badge">${r.errors} err</span>`
                : '';
            const secondary = '';
            return `
                <div>
                    <div class="flex items-center justify-between text-xs mb-1 gap-2">
                        <span class="text-gray-300 truncate">${escapeHtml(r.name ?? '—')}</span>
                        <span class="flex items-center gap-2 shrink-0">${secondary}<span class="text-white font-medium">${fmtNum(primary)}${errBadge}</span></span>
                    </div>
                    <div class="stats-bar-track">
                        <div class="stats-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }


    function renderAllBarLists() {
        renderBarList('by-character-list', cachedByChar, activeSortBy);
        renderBarList('by-server-list', cachedByServer, activeSortBy);
        renderBarList('by-model-list', cachedByModel, activeSortBy);
        renderBarList('by-user-list', cachedByUser, activeSortBy);
    }

    async function load(days) {
        try {
            const data = await fetchAll(days);
            cachedByChar = data.byChar;
            cachedByServer = data.byServer;
            cachedByUser = data.byUser;
            cachedByModel = data.byModel;
            renderKPIs(data.summary);
            renderChart(data.timeseries);
            renderAllBarLists();
        } catch {
            showToast('Failed to load stats', 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('range-btns').addEventListener('click', e => {
            const btn = e.target.closest('[data-days]');
            if (!btn) return;
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('range-btn-active'));
            btn.classList.add('range-btn-active');
            activeDays = parseInt(btn.dataset.days);
            load(activeDays);
        });

        document.getElementById('global-sort-btns').addEventListener('click', e => {
            const btn = e.target.closest('[data-sort]');
            if (!btn) return;
            activeSortBy = btn.dataset.sort;
            document.querySelectorAll('#global-sort-btns .tab-btn').forEach(b => {
                b.classList.toggle('tab-active', b === btn);
            });
            renderAllBarLists();
        });

        load(activeDays);
    });
})();
