class SiteFooter extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <footer class="site-footer" role="contentinfo">
                <div class="site-footer-inner">
                    <span class="site-footer-brand">zahul-ai</span>
                    <span class="site-footer-version">v<span data-version></span></span>
                </div>
            </footer>`;
        const cached = sessionStorage.getItem('zahul_version');
        const ts = sessionStorage.getItem('zahul_version_ts');
        const fresh = ts && (Date.now() - Number(ts)) < 5 * 60 * 1000;
        if (cached && fresh) {
            this.querySelector('[data-version]').textContent = cached;
        } else {
            fetch('/api/version')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    const v = data?.version;
                    if (v) {
                        sessionStorage.setItem('zahul_version', v);
                        sessionStorage.setItem('zahul_version_ts', Date.now());
                        this.querySelector('[data-version]').textContent = v;
                    }
                })
                .catch(() => {});
        }
    }
}
customElements.define('site-footer', SiteFooter);
