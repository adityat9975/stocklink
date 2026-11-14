import { S, TABS, app } from './state.js';
import { api } from './api.js';
import { openStream, closeStream } from './live.js';
import { load } from './data.js';
import { startTutorial } from '../ui/modals.js';
import { loadNotes, openTab } from '../features/notes.js';
import { syncPush, disablePush } from './device.js';

export async function enter(m, quiet) {
  S.me = Object.assign({}, m.user, { shop: m.shop, businesses: m.businesses || [] });
  S.lang = m.user.lang || S.lang;
  S.form = {}; S.d = {}; S.cart = { wid: null, items: {} }; S.checkout = null; S.modal = null;
  S.tab = TABS[S.me.role][0];
  openStream();
  await Promise.all([load(quiet), loadNotes()]);
  syncPush();
  if (!S.me.tutorial_done) startTutorial();
  // deep link from a tapped phone notification: /?tab=orders
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab) { history.replaceState(null, '', '/'); if (S.me.tutorial_done) openTab(tab); }
  // from the public /delete-account page: open the menu at the delete section
  if (new URLSearchParams(location.search).get('delete') === '1' && S.me.role !== 'admin') {
    history.replaceState(null, '', '/'); S.open.delacct = true; S.modal = { type: 'menu' }; app.render();
  }
}

export async function boot() {
  try { S.cfg = await api('GET', '/api/config'); } catch (_) { S.cfg = { demo: false, currency: '₹', accounts: [] }; }
  try { await enter(await api('GET', '/api/me'), true); } catch (_) { app.render(); }
}

export async function logout() {
  await disablePush(); // this phone stops getting the old account's alerts
  try { await api('POST', '/api/logout', {}); } catch (_) { /* already logged out */ }
  closeStream();
  S.me = null; S.form = {}; S.modal = null;
  app.render();
}
