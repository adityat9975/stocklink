// Chat between a wholesaler and its retailers. One conversation per shop pair; a message can point at an order.
import { html } from '../core/html.js';
import { S, app } from '../core/state.js';
import { t, ago } from '../core/format.js';
import { api, toast, errText } from '../core/api.js';
import { btn, empty, loading, icon } from '../ui/components.js';

const QUICK = {
  retailer: ['q_r1', 'q_r2', 'q_r3', 'q_r4'],
  wholesaler: ['q_w1', 'q_w2', 'q_w3', 'q_w4'],
};

export async function loadChat() {
  if (S.chat && S.chat.with) {
    const r = await api('GET', '/api/chat/' + S.chat.with);
    S.chat.data = r;
  } else {
    S.d.chats = (await api('GET', '/api/chat')).chats;
  }
}

const hm = (ts) => {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString(S.lang === 'hi' ? 'en-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + time;
};

export function chatBody() {
  return S.chat && S.chat.with ? threadView() : listView();
}

function listView() {
  const list = S.d.chats;
  if (!list) return loading();
  return html`<h2>${t('t_chat')}</h2>
    ${list.length ? html`<div class="list">${list.map((c) => html`
      <button class="item link chatrow" data-act="chatopen" data-id="${c.other_id}">
        <span class="avatar sm">${c.name.slice(0, 1).toUpperCase()}</span>
        <div class="grow"><div class="nm${c.unread ? ' strong' : ''}">${c.name}${c.status === 'pending' ? html` <span class="badge mute">${t('pending')}</span>` : ''}</div>
          <div class="ls${c.unread ? ' strong' : ''}">${c.last_body ? (c.last_from_me ? t('you') + ': ' : '') + c.last_body : t('chat_start')}</div></div>
        <div class="chatmeta">${c.last_at ? html`<span class="ls">${ago(c.last_at)}</span>` : ''}${c.unread ? html`<span class="dot inline">${c.unread}</span>` : ''}</div>
      </button>`)}</div>`
      : empty(t(S.me.role === 'wholesaler' ? 'chat_none_w' : 'chat_none_r'))}`;
}

function threadView() {
  const d = S.chat.data;
  if (!d) return loading();
  const quick = QUICK[S.me.role] || [];
  return html`
    <div class="chathead">${btn('← ' + t('back'), 'chatback', '', 'ghost sm')}<div class="grow"><b>${d.other.name}</b><div class="ls">${d.other.city}</div></div></div>
    <div class="thread" id="thread">
      ${d.messages.length ? d.messages.map((m) => html`
        <div class="bubble ${m.mine ? 'me' : 'them'}">
          ${m.order_id ? html`<span class="badge acc">${t('about_order')} #${m.order_id}</span>` : ''}
          <div class="txt">${m.body}</div>
          <div class="meta">${hm(m.created_at)}${m.mine ? html` <span class="${m.read ? 'seen' : ''}">${m.read ? '✓✓' : '✓'}</span>` : ''}</div>
        </div>`) : empty(t('chat_empty'))}
    </div>
    <div class="quick">${quick.map((k) => btn(t(k), 'chatquick', k, 'chip'))}</div>
    ${S.chat.order ? html`<div class="banner info row sp"><span>${t('about_order')} #${S.chat.order}</span>${btn('×', 'chatnoorder', '', 'ghost sm', { 'aria-label': t('close') })}</div>` : ''}
    <div class="composer">
      <textarea id="chatmsg" data-f="chatmsg" rows="1" maxlength="1000" placeholder="${t('chat_ph')}" aria-label="${t('chat_ph')}">${S.form.chatmsg || ''}</textarea>
      <button class="btn pri send" data-act="chatsend" aria-label="${t('send')}" ${S.busy ? 'disabled' : ''}>${icon('send')}</button>
    </div>`;
}

const scrollDown = () => requestAnimationFrame(() => { const el = document.getElementById('thread'); if (el) el.scrollTop = el.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });

async function open(otherId, orderId) {
  S.tab = 'chat'; S.checkout = null;
  S.chat = { with: +otherId, order: orderId ? +orderId : null, data: null };
  app.render();
  await app.load(true);
  scrollDown();
}

async function send(text) {
  const body = (text ?? S.form.chatmsg ?? '').trim();
  if (!body || S.busy) return;
  S.busy = true;
  try {
    await api('POST', '/api/chat/' + S.chat.with, { body, order_id: S.chat.order || undefined });
    if (text == null) S.form.chatmsg = '';
    S.chat.order = null;
    await app.load(true);
    scrollDown();
  } catch (e) {
    toast(e.message === 'rate_limited' ? t('chat_slow') : errText(e), 'warn');
  } finally { S.busy = false; app.render(); }
}

export const chatActions = {
  chatopen: (id) => open(id),
  chatorder: (v) => { const [other, order] = String(v).split(':'); open(other, order); },
  chatback: () => { S.chat = null; app.load(true); },
  chatnoorder: () => { S.chat.order = null; app.render(); },
  chatquick: (k) => send(t(k)),
  chatsend: () => send(),
};

// Enter sends, Shift+Enter makes a new line.
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'chatmsg' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
