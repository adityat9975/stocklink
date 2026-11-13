import { html } from '../core/html.js';
import { S, app } from '../core/state.js';
import { t, money, clock } from '../core/format.js';
import { api, toast, errText, attempt } from '../core/api.js';
import { field, btn, chips, empty, loading } from '../ui/components.js';
import { loadDash, dashView, askView, dashTick } from './insights.js';
import { loadPlans, plansView, mfaView } from './plans.js';

dashTick();

export async function loadAdmin(tab) {
  if (S.me.mfa_needed) { S.d.mfa = await api('GET', '/api/admin/2fa'); return; }
  if (tab === 'plans') await loadPlans();
  if (tab === 'dash') await loadDash();
  if (tab === 'shops') S.d.shops = (await api('GET', '/api/admin/shops' + (S.open.allShops ? '' : '?status=pending'))).shops;
  if (tab === 'audit') S.d.audit = (await api('GET', '/api/admin/audit?limit=100')).logs;
  if (tab === 'stats') S.d.stats = await api('GET', '/api/admin/stats');
}

export const adminBody = () => (S.me.mfa_needed ? mfaView() : ({ dash: dashView, ask: askView, plans: plansView, audit: auditView, stats: statsView }[S.tab] || shopsView)());

const vClass = (v) => (v === 'approved' ? 'good' : v === 'pending' ? 'warn' : 'bad');

function gstLine(s) {
  if (s.type !== 'wholesaler') return '';
  if (!s.gstin) return html`<p class="sub">${t('gst_none')}</p>`;
  return html`<p class="sub">${t(s.gstin_valid ? 'gst_fmt_ok' : 'gst_fmt_bad')}${s.gstin_state ? ' · ' + t('gst_state', { s: s.gstin_state }) : ''} · <a href="https://services.gst.gov.in/services/searchtp" target="_blank" rel="noopener noreferrer">${t('gst_portal')}</a></p>`;
}

function shopsView() {
  const sh = S.d.shops;
  if (!sh) return loading();
  return html`<h2>${t('v_h')}</h2>
    ${chips('shopfilter', S.open.allShops ? 'all' : 'pending', [{ id: 'pending', label: t('v_pending') }, { id: 'all', label: t('all') }])}
    ${sh.length ? sh.map((s) => html`<div class="card"><div class="row sp"><div><div class="nm">${s.name}</div>
      <p class="sub">${t('r_' + s.type)} · ${s.city} · ${s.owner} · ${s.phone}${s.gstin ? ' · ' + s.gstin : ''}</p>${gstLine(s)}</div>
      <span class="badge ${vClass(s.verification)}">${t('vs_' + s.verification)}</span></div>
      ${field('reason_' + s.id, t('reason'), { maxlength: 200 })}
      <div class="chips">${s.verification !== 'approved' ? btn(t('approve'), 'verify', s.id + ':approve', 'pri sm') : btn(t('suspend'), 'verify', s.id + ':suspend', 'danger sm')}
        ${s.verification === 'pending' ? btn(t('decline'), 'verify', s.id + ':reject', 'danger sm') : ''}</div></div>`) : empty(t('v_none'))}`;
}

function auditView() {
  const lg = S.d.audit, v = S.d.verify;
  if (!lg) return loading();
  return html`<h2>${t('audit_h')}</h2>${btn(t('verify_chain'), 'verifychain', '', 'sm')}
    ${v ? html`<div class="banner ${v.ok ? 'info' : ''}">${v.ok ? t('chain_ok', { n: v.checked }) : t('chain_bad', { id: v.broken_at })}</div>` : ''}
    ${lg.map((a) => html`<div class="log"><time>${clock(a.ts)}</time><span><b>${a.actor_label || '–'}</b> ${a.action}${a.detail ? ' · ' + a.detail : ''}</span></div>`)}`;
}

function statsView() {
  const s = S.d.stats;
  if (!s) return loading();
  const n = (arr, k, v) => (arr.find((x) => x[k] === v) || {}).n || 0;
  const gmv = s.orders.filter((o) => ['paid', 'packed', 'dispatched', 'completed'].includes(o.status)).reduce((a, o) => a + o.paise, 0);
  const pendingShops = s.shops.filter((x) => x.type === 'wholesaler' && x.verification === 'pending').reduce((a, x) => a + x.n, 0);
  const stat = (v, label) => html`<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  return html`<h2>${t('t_stats')}</h2>
    <div class="stats">${stat(n(s.users, 'role', 'wholesaler'), t('r_wholesaler'))}${stat(n(s.users, 'role', 'retailer'), t('r_retailer'))}${stat(pendingShops, t('v_pending'))}${stat(s.orders.reduce((a, o) => a + o.n, 0), t('t_orders'))}</div>
    ${stat(money(gmv), t('gmv'))}
    ${S.cfg.demo ? html`<div class="card"><h3>${t('demo_reset_h')}</h3><p class="sub">${t('demo_reset_d')}</p>${btn(t('demo_reset'), 'resetdemo', '', 'danger sm')}</div>` : ''}`;
}

export const adminActions = {
  shopfilter: (id) => { S.open.allShops = id === 'all'; app.load(); },
  verify: async (id) => {
    const [sid, action] = id.split(':');
    try {
      await api('POST', '/api/admin/shops/' + sid + '/verify', { action, reason: S.form['reason_' + sid] || undefined });
      delete S.form['reason_' + sid]; toast(t('saved'), 'ok'); await app.load(true);
    } catch (e) { toast(e.message === 'invalid_reason' ? t('need_reason') : errText(e), 'warn'); }
  },
  verifychain: async () => { const r = await attempt(() => api('GET', '/api/admin/audit/verify')); if (r) { S.d.verify = r; app.render(); } },
  resetdemo: async () => { if (await attempt(() => api('POST', '/api/admin/reset-demo', {}))) { toast(t('saved'), 'ok'); await app.load(true); } },
};
