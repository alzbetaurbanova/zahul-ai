/**
 * /docs — guide index (cards) and Markdown reader.
 *
 * The guides live in docs/*.md and are served by api/routers/docs.py. Markdown
 * is rendered client-side with marked; the result is then stripped of scripts
 * and inline event handlers, because rendered Markdown is HTML and the reader
 * should not become a way to run code even if a guide ever gains raw HTML.
 */
(function () {
    const $ = (id) => document.getElementById(id);
    const grid = $('docs-grid');
    const indexView = $('docs-index');
    const readerView = $('docs-reader');
    const body = $('doc-body');

    let docs = [];

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    /** Remove anything executable from rendered Markdown. */
    function sanitize(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script, style, iframe, object, embed, form').forEach(el => el.remove());
        tpl.content.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                const name = attr.name.toLowerCase();
                const value = attr.value.trim().toLowerCase();
                if (name.startsWith('on')) el.removeAttribute(attr.name);
                if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return tpl.innerHTML;
    }

    function renderCards(list) {
        if (!list.length) {
            grid.innerHTML = '';
            $('docs-no-results').classList.remove('hidden');
            return;
        }
        $('docs-no-results').classList.add('hidden');
        grid.innerHTML = list.map(d => `
            <a class="doc-card" href="?doc=${encodeURIComponent(d.slug)}" data-slug="${escapeHtml(d.slug)}">
                <div class="doc-icon"><i class="fas fa-fw fa-${escapeHtml(d.icon)}"></i></div>
                <h3>${escapeHtml(d.title)}</h3>
                <p>${escapeHtml(d.summary)}</p>
                <div class="doc-foot">
                    <span>${d.read_minutes} min read</span>
                    <span class="read">Read <i class="fas fa-arrow-right"></i></span>
                </div>
            </a>`).join('');

        grid.querySelectorAll('.doc-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                openDoc(card.dataset.slug, true);
            });
        });
    }

    /** Give wide tables their own scroll box so the page never scrolls sideways. */
    function wrapTables() {
        body.querySelectorAll('table').forEach(table => {
            if (table.parentElement?.classList.contains('doc-table')) return;
            const box = document.createElement('div');
            box.className = 'doc-table';
            table.replaceWith(box);
            box.appendChild(table);
        });
    }

    /**
     * Rewrite in-repo links so "[AI Config](02-ai-config.md)" navigates inside
     * the reader instead of trying to download a file.
     */
    function wireDocLinks() {
        body.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            const local = /^(?!https?:|mailto:|#)([\w.-]+)\.md(#.*)?$/.exec(href || '');
            if (local) {
                const slug = local[1];
                a.setAttribute('href', `?doc=${encodeURIComponent(slug)}`);
                a.addEventListener('click', (e) => { e.preventDefault(); openDoc(slug, true); });
            } else if (/^https?:/.test(href || '')) {
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
        });
    }

    function showIndex(push) {
        readerView.classList.add('hidden');
        indexView.classList.remove('hidden');
        document.title = 'zahul-ai - Docs';
        if (push) history.pushState({}, '', '/docs');
        window.scrollTo(0, 0);
    }

    async function openDoc(slug, push) {
        try {
            const r = await fetch(`/api/docs/${encodeURIComponent(slug)}`);
            if (!r.ok) throw new Error('That guide could not be loaded.');
            const doc = await r.json();

            body.innerHTML = sanitize(marked.parse(doc.markdown));
            wrapTables();
            wireDocLinks();

            const meta = docs.find(d => d.slug === slug);
            $('doc-meta').textContent = `${doc.read_minutes} min read`;
            if (meta) $('doc-meta').textContent += ` · ${meta.title}`;

            indexView.classList.add('hidden');
            readerView.classList.remove('hidden');
            document.title = `zahul-ai - ${doc.title}`;
            if (push) history.pushState({ slug }, '', `?doc=${encodeURIComponent(slug)}`);
            window.scrollTo(0, 0);
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    function applySearch(term) {
        const q = term.trim().toLowerCase();
        if (!q) return renderCards(docs);
        renderCards(docs.filter(d =>
            d.title.toLowerCase().includes(q) || d.summary.toLowerCase().includes(q)
        ));
    }

    async function init() {
        try {
            const r = await fetch('/api/docs/');
            if (!r.ok) throw new Error('Could not load the guide list.');
            docs = await r.json();
        } catch (e) {
            grid.innerHTML = `<div class="docs-empty">${escapeHtml(e.message)}</div>`;
            return;
        }

        renderCards(docs);
        $('docs-search').addEventListener('input', (e) => applySearch(e.target.value));
        $('docs-back').addEventListener('click', () => showIndex(true));

        window.addEventListener('popstate', () => {
            const slug = new URLSearchParams(location.search).get('doc');
            slug ? openDoc(slug, false) : showIndex(false);
        });

        const slug = new URLSearchParams(location.search).get('doc');
        if (slug) openDoc(slug, false);
    }

    function boot() {
        /* marked is deferred too; wait for it rather than racing the parser. */
        if (typeof marked === 'undefined') return setTimeout(boot, 30);
        init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
