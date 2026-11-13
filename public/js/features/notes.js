// In-app notification feed (bell) + live arrival from the SSE stream.
import { html } from '../core/html.js';
import { S, TABS, app } from '../core/state.js';
import { t, ago } from '../core/format.js';
import { api, toast } from '../core/api.js';
import { btn, empty } from '../ui/components.js';
import { dev, pushBlocker } from '../core/device.js';

export async function loadNotes() {
  try { S.notes = await api('GET', '/api/notifications'); } catch (_) { S.notes = S.notes || { items: [], unread: 0 }; }
}

export function onNotify(d) {
  S.notes = S.notes || { items: [], unread: 0 };
  S.notes.items.unshift({ id: d.id, title: d.title, body: d.body, tab: d.tab, created_at: d.ts, read_at: null });
  S.notes.unread++;
  toast(d.title);
  if (navigator.vibrate && document.visibilityState === 'visible') { try { navigator.vibrate(60); } catch (_) { /* not allowed */ } }
  app.render();
}

export function openTab(tab) {
  if (!S.me || !tab || !TABS[S.me.role].includes(tab)) return;
  S.modal = null;
  app.go(tab);
}

export function notesSheetBody() {
  const items = (S.notes && S.notes.items) || [];
  return html`<div class="row sp"><h2>${t('t_notes')}</h2>${btn(t('close'), 'closemodal', '', 'ghost sm')}</div>
    ${items.length ? html`<div class="list">${items.map((n) => html`<button class="item link note-item${n.read_at ? '' : ' unread'}" data-act="noteopen" data-id="${n.tab || ''}">
      <div class="grow"><div class="nm">${n.title}</div><div class="ls">${n.body}</div><div class="ls age">${ago(n.created_at)}</div></div></button>`)}</div>` : empty(t('notes_none'))}`;
}

export const notesActions = {
  bell: async () => {
    S.modal = { type: 'notes' };
    app.render();
    if (S.notes && S.notes.unread) {
      await api('POST', '/api/notifications/read', {}).catch(() => {});
      S.notes.unread = 0;
      for (const n of S.notes.items) if (!n.read_at) n.read_at = Date.now();
      setTimeout(() => app.render(), 1500); // let the highlight show briefly
    }
  },
  noteopen: (tab) => { if (tab) openTab(tab); else { S.modal = null; app.render(); } },
};

// One-time card on the first screen: "turn on alerts" (or how to install on iPhone first).
const CARD_KEY = 'sl_alert_card_hidden';
export function alertCard() {
  let hidden = false;
  try { hidden = localStorage.getItem(CARD_KEY) === '1'; } catch (_) { /* storage blocked */ }
  const why = pushBlocker();
  if (hidden || dev.pushOn || (why && why !== 'push_ios')) return '';
  const wholesaler = S.me.role === 'wholesaler';
  return html`<div class="card feature alertcard"><h3>${t(wholesaler ? 'card_w_h' : 'card_r_h')}</h3>
    <p class="sub">${why ? t('push_ios') : t('card_d')}</p>
    <div class="row">${why ? '' : btn(t('push_enable'), 'pushon', '', 'pri sm')}${btn(t('later'), 'cardhide', '', 'ghost sm')}</div></div>`;
}
notesActions.cardhide = () => { try { localStorage.setItem(CARD_KEY, '1'); } catch (_) { /* storage blocked */ } app.render(); };
