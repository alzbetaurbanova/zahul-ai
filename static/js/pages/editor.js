const canvas = document.getElementById('avatar-canvas');
const ctx = canvas.getContext('2d');
const discordCanvas = document.getElementById('discord-preview');
const dctx = discordCanvas.getContext('2d');
const DISCORD_SIZE = 40;
const urlInput = document.getElementById('url-input');
const urlLoadBtn = document.getElementById('url-load-btn');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const resetBtn = document.getElementById('reset-btn');
const exportBtn = document.getElementById('export-btn');
const resultDiv = document.getElementById('result');
const resultImg = document.getElementById('result-img');
const slZoom = document.getElementById('sl-zoom');
const slBrightness = document.getElementById('sl-brightness');
const slContrast = document.getElementById('sl-contrast');
const slHue = document.getElementById('sl-hue');
const slZoomVal = document.getElementById('sl-zoom-val');
const slBrightnessVal = document.getElementById('sl-brightness-val');
const slContrastVal = document.getElementById('sl-contrast-val');
const slHueVal = document.getElementById('sl-hue-val');

let img = null, offsetX = 0, offsetY = 0, dragging = false, dragStartX = 0, dragStartY = 0, loadToken = 0;

function getFilter() {
    const b = parseInt(slBrightness.value), c = parseInt(slContrast.value), h = parseInt(slHue.value);
    return `brightness(${100+b}%) contrast(${100+c}%) hue-rotate(${h}deg)`;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const zoom = parseFloat(slZoom.value);
    ctx.filter = getFilter();
    const w = img.naturalWidth * zoom, ht = img.naturalHeight * zoom;
    ctx.drawImage(img, (canvas.width - w) / 2 + offsetX, (canvas.height - ht) / 2 + offsetY, w, ht);
    ctx.filter = 'none';
    updateDiscordPreview();
}

function updateDiscordPreview() {
    const S = DISCORD_SIZE;
    dctx.clearRect(0, 0, S, S);
    if (!img) return;
    dctx.save();
    dctx.beginPath();
    dctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    dctx.clip();
    const scale = S / canvas.width;
    const zoom = parseFloat(slZoom.value);
    dctx.filter = getFilter();
    const w = img.naturalWidth * zoom * scale, ht = img.naturalHeight * zoom * scale;
    dctx.drawImage(img, (S - w) / 2 + offsetX * scale, (S - ht) / 2 + offsetY * scale, w, ht);
    dctx.filter = 'none';
    dctx.restore();
}

function toProxied(src) {
    if (src && (src.startsWith('http://') || src.startsWith('https://')))
        return `/api/characters/proxy_image?url=${encodeURIComponent(src)}`;
    return src;
}

function loadImage(src) {
    const token = ++loadToken;
    canvas.width = canvas.width;
    const i = new Image();
    i.onload = () => {
        if (token !== loadToken) return;
        img = i;
        const autoZoom = Math.min(canvas.width / i.naturalWidth, canvas.height / i.naturalHeight);
        slZoom.value = Math.max(0.1, Math.min(2, autoZoom));
        slZoomVal.textContent = parseFloat(slZoom.value).toFixed(2);
        offsetX = 0; offsetY = 0;
        draw();
    };
    i.onerror = () => alert('Failed to load image. Check the URL.');
    i.src = toProxied(src);
}

function resetControls() {
    slZoom.value = 1; slBrightness.value = 0; slContrast.value = 0; slHue.value = 0;
    slZoomVal.textContent = '1.00'; slBrightnessVal.textContent = '0'; slContrastVal.textContent = '0'; slHueVal.textContent = '0';
    offsetX = 0; offsetY = 0;
}

[[slZoom, slZoomVal, v => parseFloat(v).toFixed(2)], [slBrightness, slBrightnessVal, v => v],
 [slContrast, slContrastVal, v => v], [slHue, slHueVal, v => v]
].forEach(([s, l, f]) => s.addEventListener('input', () => { l.textContent = f(s.value); draw(); }));

canvas.addEventListener('mousedown', e => { dragging = true; dragStartX = e.clientX - offsetX; dragStartY = e.clientY - offsetY; });
window.addEventListener('mousemove', e => { if (!dragging) return; offsetX = e.clientX - dragStartX; offsetY = e.clientY - dragStartY; draw(); });
window.addEventListener('mouseup', () => dragging = false);

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const z = Math.min(2, Math.max(0.1, parseFloat(slZoom.value) + (e.deltaY > 0 ? -0.05 : 0.05)));
    slZoom.value = z; slZoomVal.textContent = z.toFixed(2); draw();
}, { passive: false });

urlLoadBtn.addEventListener('click', () => { if (urlInput.value.trim()) loadImage(urlInput.value.trim()); });
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') urlLoadBtn.click(); });

fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    fileLabel.textContent = f.name;
    loadImage(URL.createObjectURL(f));
});

resetBtn.addEventListener('click', () => { resetControls(); if (img) draw(); });

const cdnResult = document.getElementById('cdn-result');
const cdnUrlInput = document.getElementById('cdn-url');
const cdnCopyBtn = document.getElementById('cdn-copy-btn');
const discordUploadBtn = document.getElementById('discord-upload-btn');

discordUploadBtn.addEventListener('click', async () => {
    if (!img) { alert('Load an image first.'); return; }
    discordUploadBtn.disabled = true;
    discordUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Uploading...';
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const formData = new FormData();
        formData.append('image', blob, 'avatar.png');
        const resp = await fetch('/api/characters/upload_image', { method: 'POST', body: formData });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || resp.status);
        }
        const { cdn_url } = await resp.json();
        cdnUrlInput.value = cdn_url;
        cdnResult.classList.remove('hidden');
        navigator.clipboard.writeText(cdn_url).catch(() => {});
    } catch (e) {
        alert(`Upload failed: ${e.message}`);
    } finally {
        discordUploadBtn.disabled = false;
        discordUploadBtn.innerHTML = '<i class="fab fa-discord mr-1"></i>Save on Discord';
    }
});

cdnCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(cdnUrlInput.value);
    cdnCopyBtn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => cdnCopyBtn.innerHTML = '<i class="fas fa-copy"></i>', 2000);
});

exportBtn.addEventListener('click', () => {
    if (!img) { alert('Load an image first.'); return; }
    try {
        const dataUrl = canvas.toDataURL('image/png');
        resultImg.src = dataUrl;
        resultDiv.classList.remove('hidden');
        const a = document.createElement('a');
        a.href = dataUrl; a.download = 'avatar.png'; a.click();
    } catch (e) {
        alert('Export failed (CORS). Use file upload instead of URL.');
    }
});
