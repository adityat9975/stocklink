// Phone integration: service worker (installable app + offline shell), install prompt, and Web Push alerts.
import { api } from './api.js';

export const dev = {
  reg: null, installEvt: null, pushOn: false,
  secure: window.isSecureContext,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  get pushSupported() { return !!this.reg && 'PushManager' in window && 'Notification' in window; },
  get permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; },
};

export async function initDevice({ onChange, onOpenTab }) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); dev.installEvt = e; onChange(); });
  window.addEventListener('appinstalled', () => { dev.installEvt = null; dev.standalone = true; onChange(); });
  if (!('serviceWorker' in navigator) || !dev.secure) return;
  try { dev.reg = await navigator.serviceWorker.register('/sw.js'); } catch (_) { return; }
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open-tab') onOpenTab(e.data.tab); });
  if (dev.pushSupported) {
    const sub = await dev.reg.pushManager.getSubscription().catch(() => null);
    dev.pushOn = !!sub && dev.permission === 'granted';
  }
  onChange();
}

export async function promptInstall() {
  if (!dev.installEvt) return false;
  dev.installEvt.prompt();
  const r = await dev.installEvt.userChoice.catch(() => ({}));
  dev.installEvt = null;
  return r.outcome === 'accepted';
}

const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Why alerts cannot be turned on here, or '' when they can.
export function pushBlocker() {
  if (!dev.secure) return 'push_https';
  if (dev.ios && !dev.standalone) return 'push_ios';
  if (!dev.pushSupported) return 'push_unsupported';
  if (dev.permission === 'denied') return 'push_denied';
  return '';
}

export async function enablePush() {
  if (pushBlocker()) return pushBlocker();
  if ((await Notification.requestPermission()) !== 'granted') return 'push_denied';
  const { key } = await api('GET', '/api/push/key');
  const opts = { userVisibleOnly: true, applicationServerKey: b64ToBytes(key) };
  let sub = await dev.reg.pushManager.getSubscription();
  try { if (!sub) sub = await dev.reg.pushManager.subscribe(opts); }
  catch (_) { if (sub) await sub.unsubscribe(); sub = await dev.reg.pushManager.subscribe(opts); }
  await registerSub(sub).catch(async () => {
    // server key changed (new database): start a fresh subscription
    await sub.unsubscribe(); sub = await dev.reg.pushManager.subscribe(opts); await registerSub(sub);
  });
  dev.pushOn = true;
  return '';
}
const registerSub = (sub) => { const j = sub.toJSON(); return api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys }); };

// After login: attach this phone's existing subscription to the account that just signed in.
export async function syncPush() {
  if (!dev.pushOn || !dev.reg) return;
  const sub = await dev.reg.pushManager.getSubscription().catch(() => null);
  if (sub) await registerSub(sub).catch(() => {});
}

export async function disablePush() {
  const sub = dev.reg ? await dev.reg.pushManager.getSubscription().catch(() => null) : null;
  if (sub) {
    await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  dev.pushOn = false;
}
