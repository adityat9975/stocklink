import { S, app } from './state.js';
import { api, toast, errText } from './api.js';
import { loadRetailer } from '../features/retailer.js';
import { loadWholesaler } from '../features/wholesaler.js';
import { loadAdmin } from '../features/admin.js';
import { loadChat } from '../features/chat.js';

const LOADERS = { retailer: loadRetailer, wholesaler: loadWholesaler, admin: loadAdmin };

export async function load(silent) {
  if (!S.me) return;
  try {
    if (S.tab === 'chat') await loadChat(); else await LOADERS[S.me.role](S.tab);
    if (S.me.role !== 'admin') S.d.chatUnread = (await api('GET', '/api/chat/unread')).n;
  } catch (e) { if (!silent) toast(errText(e), 'warn'); }
  app.render();
}

export function go(tab) {
  S.tab = tab; S.checkout = null; S.d.verify = null;
  if (tab !== 'chat') S.chat = null;
  load();
}
