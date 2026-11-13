// StockLink website: Install button. Uses the same service worker and manifest as the app, so "Install" adds the real app.
// Optional: put your WhatsApp business number (country code, digits only, e.g. '919812345678') to show a contact link.
const WHATSAPP = '';

let deferred = null;
const $ = (id) => document.getElementById(id);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Show the APK button when an APK has been uploaded to public/download/StockLink.apk (Android only; iPhone uses Add to Home Screen).
const android = /android/i.test(navigator.userAgent);
fetch('/download/StockLink.apk', { method: 'HEAD' }).then((r) => {
  if (!r.ok) return;
  const a = $('apk'); a.hidden = false; $('apkhelp').hidden = false;
  if (android) { $('install').classList.replace('pri', 'ghost'); $('install').textContent = 'Or install from browser'; }
}).catch(() => {});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; setLabels('Open StockLink'); $('installnote').textContent = 'Installed. Open StockLink from your home screen.'; });

function setLabels(text) { ['install', 'install2'].forEach((id) => { const b = $(id); if (b) b.textContent = text; }); }
if (standalone) setLabels('Open StockLink');

async function install() {
  if (standalone) { location.href = '/'; return; }
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    if (outcome === 'accepted') return;
  }
  if (ios) { $('ios').hidden = false; $('ios-ok').focus(); return; }
  // Browser without an install prompt (desktop, or already installed): show the steps, the app also works in the browser.
  $('get').scrollIntoView({ behavior: 'smooth' });
}
['install', 'install2'].forEach((id) => $(id).addEventListener('click', install));
$('ios-ok').addEventListener('click', () => { $('ios').hidden = true; });
$('ios').addEventListener('click', (e) => { if (e.target.id === 'ios') $('ios').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('ios').hidden = true; });

if (/^\d{10,15}$/.test(WHATSAPP)) {
  const c = $('contact'); c.hidden = false;
  const a = document.createElement('a');
  a.href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent('Hi, I want to know more about StockLink');
  a.rel = 'noopener'; a.textContent = 'Questions? Message us on WhatsApp';
  c.append(a);
}
