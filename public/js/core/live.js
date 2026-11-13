import { S, app } from './state.js';
import { t } from './format.js';

let es = null, timer = null;
const $ = (s) => document.querySelector(s);

export function openStream() {
  closeStream();
  es = new EventSource('/api/stream');
  es.onopen = () => { S.live = true; paintLive(); };
  es.onerror = () => { S.live = false; paintLive(); };
  es.addEventListener('notify', (e) => { try { app.onNotify(JSON.parse(e.data)); } catch (_) { /* bad event */ } });
  for (const k of ['stock', 'order', 'conn', 'catalog', 'chat']) {
    es.addEventListener(k, () => { clearTimeout(timer); timer = setTimeout(refreshLive, 300); });
  }
}

export function closeStream() { if (es) { es.close(); es = null; } S.live = false; }

export function paintLive() {
  const el = $('#livedot');
  if (!el) return;
  el.className = 'live' + (S.live ? ' on' : '');
  el.lastChild.textContent = S.live ? t('live') : t('offline');
}

const typing = () => {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file';
};

async function refreshLive() {
  if (!S.me || S.modal) return;
  if (typing()) { S.pendingRefresh = true; return; }
  await app.load(true);
}

export function initLive() {
  document.addEventListener('focusout', () => {
    if (!S.pendingRefresh) return;
    S.pendingRefresh = false;
    setTimeout(() => { if (!typing()) refreshLive(); }, 200);
  });
}
