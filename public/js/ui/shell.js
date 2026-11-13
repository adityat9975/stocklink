import { html } from '../core/html.js';
import { S, TABS } from '../core/state.js';
import { t } from '../core/format.js';
import { icon } from './components.js';
import { retailerBody, cartBarIfCatalog } from '../features/retailer.js';
import { wholesalerBody } from '../features/wholesaler.js';
import { adminBody } from '../features/admin.js';
import { chatBody } from '../features/chat.js';

const BODY = { retailer: retailerBody, wholesaler: wholesalerBody, admin: adminBody };

export function shell() {
  const m = S.me, tabs = TABS[m.role];
  const pending = (k) => (m.role === 'wholesaler' && k === 'retailers' && S.d.pending > 0 ? html`<span class="dot">${S.d.pending}</span>`
    : k === 'chat' && S.d.chatUnread > 0 ? html`<span class="dot">${S.d.chatUnread > 9 ? '9+' : S.d.chatUnread}</span>` : '');
  return html`
    <header class="bar">
      <div class="brand"><img class="logo" src="/icons/icon-192.png" alt="" width="28" height="28">Stock<span>Link</span></div>
      <span id="livedot" class="live${S.live ? ' on' : ''}"><i></i><span>${S.live ? t('live') : t('offline')}</span></span>
      <button class="bell" data-act="bell" aria-label="${t('t_notes')}">${icon('bell')}${S.notes && S.notes.unread ? html`<span class="dot">${S.notes.unread > 9 ? '9+' : S.notes.unread}</span>` : ''}</button>
      <button class="avatar" data-act="menu" aria-label="${t('t_menu')}">${(m.shop ? m.shop.name : m.name).slice(0, 1).toUpperCase()}</button>
    </header>
    <main class="page">${S.tab === 'chat' ? chatBody() : BODY[m.role]()}${m.role === 'retailer' ? cartBarIfCatalog() : ''}</main>
    <nav class="nav">${tabs.map((k) => html`
      <button data-act="tab" data-id="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${icon(k)}<span>${t('t_' + k)}</span>${pending(k)}</button>`)}
    </nav>`;
}
