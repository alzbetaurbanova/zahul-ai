const params = new URLSearchParams(window.location.search);
if (params.get('error')) {
    document.getElementById('error-msg').classList.remove('hidden');
    const attempts = parseInt(localStorage.getItem('login_attempts') || '0') + 1;
    localStorage.setItem('login_attempts', attempts);
    if (attempts >= 3) {
        fetch('/api/panel-hint').then(r => r.json()).then(d => {
            if (d.hint) {
                document.getElementById('hint-text').textContent = d.hint;
                document.getElementById('hint-msg').classList.remove('hidden');
            }
        });
    }
} else {
    localStorage.removeItem('login_attempts');
}
