(async function () {
    let version = null;
    try {
        const res = await fetch('/api/version');
        if (res.ok) {
            const data = await res.json();
            version = data?.version || null;
        }
    } catch {
        /* ignore */
    }

    const text = version || '—';

    const container = document.getElementById('footer-container');
    if (container) {
        try {
            const tpl = await fetch('/static/templates/footer.html');
            if (tpl.ok) container.innerHTML = await tpl.text();
        } catch {
            /* ignore */
        }
        container.querySelectorAll('[data-version]').forEach(el => {
            el.textContent = text;
        });
    }
})();
