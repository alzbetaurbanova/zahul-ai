/**
 * <uptime-card> — bot availability history for the dashboard.
 *
 * Renders /api/uptime: a range switcher, a proportional online/offline bar with
 * per-segment tooltips, a time axis and an outage summary. Segment widths come
 * straight from each interval's duration via flex-grow, so the bar stays true to
 * scale at any container width.
 */
class UptimeCard extends HTMLElement {
    connectedCallback() {
        this.range = null;          // chosen once the API reports what's available
        this.innerHTML = '<div class="card-dark"><div class="up-sub">Loading uptime…</div></div>';
        this.load();

        // index.js fires this after the bot is activated/deactivated, so the card
        // reflects the flip without waiting for the next visit.
        this._onBotStatus = () => this.load();
        window.addEventListener('bot-status-refresh', this._onBotStatus);
    }

    disconnectedCallback() {
        window.removeEventListener('bot-status-refresh', this._onBotStatus);
    }

    async load() {
        try {
            const qs = this.range ? `?range=${encodeURIComponent(this.range)}` : '';
            const res = await fetch(`/api/uptime${qs}`);
            if (!res.ok) { this.renderUnavailable(); return; }
            this.render(await res.json());
        } catch {
            this.renderUnavailable();
        }
    }

    renderUnavailable() {
        this.innerHTML = `
            <div class="card-dark">
                ${UptimeCard.head()}
                <div class="up-sub">Uptime data is unavailable.</div>
            </div>`;
    }

    /** Card heading; `heading-card` is the panel-wide title style. */
    static head(pct) {
        return `<div class="up-head">
                    <h2 class="heading-card"><i class="fas fa-power-off"></i>Bot uptime</h2>
                    ${pct === undefined ? '' : `<span class="up-pct">${pct}</span>`}
                </div>`;
    }

    /** Human-readable duration; the unit follows the magnitude so tooltips stay short. */
    static duration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)} s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1).replace('.0', '')} h`;
        return `${(seconds / 86400).toFixed(1).replace('.0', '')} d`;
    }

    render(data) {
        const fmt = UptimeCard.duration;
        const ranges = data.available_ranges || [];
        this.range = data.range;

        if (!data.tracking_since || !data.segments.length) {
            this.innerHTML = `
                <div class="card-dark">
                    ${UptimeCard.head()}
                    <div class="up-sub">No data recorded yet — tracking starts with the next heartbeat.</div>
                </div>`;
            return;
        }

        const label = (data.label || '').toLowerCase();
        const sub = label === 'all time'
            ? `Since ${new Date(data.tracking_since).toLocaleDateString()}`
            : `Last ${label}`;

        // .range-btn / .range-btn-active are the Stats page's switcher styles.
        const rangeBtns = ranges.map(r =>
            `<button type="button" data-range="${r.key}"
                     class="range-btn${r.key === data.range ? ' range-btn-active' : ''}">${r.label}</button>`
        ).join('');

        const segs = data.segments.map(s => {
            const on = s.status === 'up';
            const when = new Date(s.started_at).toLocaleString();
            return `<div class="up-seg ${on ? 'on' : 'off'}" style="flex:${s.seconds} 0 0">
                        <span class="tip">${on ? 'Online' : 'Offline'} · ${fmt(s.seconds)}<br>${when}</span>
                    </div>`;
        }).join('');

        const summary = data.outages === 0
            ? 'No outages'
            : `<b>${data.outages}</b> outage${data.outages > 1 ? 's' : ''} · <b>${fmt(data.down_seconds)}</b> down`;

        this.innerHTML = `
            <div class="card-dark">
                ${UptimeCard.head(data.pct === null ? '—' : data.pct.toFixed(1) + '%')}
                <div class="up-sub">${sub}</div>
                <div class="up-range">${rangeBtns}</div>
                <div class="up-track">${segs}</div>
                <div class="up-axis">${(data.axis || []).map(a => `<span>${a}</span>`).join('')}</div>
                <div class="up-legend">
                    <span class="lg"><span class="sw on"></span>Online</span>
                    <span class="lg"><span class="sw off"></span>Offline</span>
                    <span class="spacer"></span>
                    <span>${summary}</span>
                </div>
            </div>`;

        this.querySelectorAll('.up-range button').forEach(btn => {
            btn.addEventListener('click', () => {
                this.range = btn.dataset.range;
                this.load();
            });
        });
    }
}
customElements.define('uptime-card', UptimeCard);
