// Super Admin: plans and wholesaler subscriptions; the authenticator setup screen. Wholesaler: plan banner.
import { html } from '../core/html.js';
import { S, app } from '../core/state.js';
import { t, money } from '../core/format.js';
import { api, toast, errText } from '../core/api.js';
import { field, btn, seg, empty, loading } from '../ui/components.js';

export async function loadPlans() {
  const [p, s] = await Promise.all([api('GET', '/api/admin/plans'), api('GET', '/api/admin/subscriptions')]);
  S.d.plans = p.plans; S.d.subs = s.shops;
}

const ST = { none: '', trial: 'good', active: 'good', cancelled: 'warn', grace: 'warn', expired: 'bad', suspended: 'bad' };
const planLine = (p) => [p.price_paise != null ? money(p.price_paise) + ' / ' + t('pl_days', { n: p.period_days }) : t('pl_noprice'),
  p.trial_days ? t('pl_trial', { n: p.trial_days }) : '', t('pl_grace', { n: p.grace_days }),
  p.max_products ? t('pl_maxp', { n: p.max_products }) : '', p.max_retailers ? t('pl_maxr', { n: p.max_retailers }) : '', p.max_staff != null ? t('pl_maxs', { n: p.max_staff }) : ''].filter(Boolean).join(' · ');

export function plansView() {
  const ps = S.d.plans, ss = S.d.subs;
  if (!ps || !ss) return loading();
  const live = ps.filter((p) => p.status === 'active');
  return html`<h2>${t('t_plans')}</h2>
    <p class="sub">${t('pl_intro')}</p>
    ${ps.length ? html`<div class="list">${ps.map((p) => html`<div class="item"><div class="grow"><div class="nm">${p.name} <span class="badge ${p.status === 'active' ? 'good' : 'mute'}">${t('pls_' + p.status)}</span></div><div class="ls">${planLine(p)}</div></div>
      ${p.status === 'active' ? btn(t('pl_pause'), 'plstatus', p.id + ':paused', 'ghost sm') : btn(t('pl_activate'), 'plstatus', p.id + ':active', 'sm')}</div>`)}</div>` : empty(t('pl_none'))}
    <details class="card more" ${S.open.newplan ? 'open' : ''}><summary>${t('pl_new')}</summary>
      ${field('pl_name', t('pl_name'), { maxlength: 40, placeholder: 'Pilot' })}
      <div class="row">${field('pl_price', t('pl_price'), { type: 'number', min: 0, step: '0.01', placeholder: t('pl_price_ph') })}${field('pl_period', t('pl_period'), { type: 'number', min: 1, placeholder: '30' })}</div>
      <div class="row">${field('pl_trial', t('pl_trial_days'), { type: 'number', min: 0, placeholder: '0' })}${field('pl_grace', t('pl_grace_days'), { type: 'number', min: 0, placeholder: '7' })}</div>
      <div class="row">${field('pl_maxp', t('pl_maxp_f'), { type: 'number', min: 1 })}${field('pl_maxr', t('pl_maxr_f'), { type: 'number', min: 1 })}${field('pl_maxs', t('pl_maxs_f'), { type: 'number', min: 0 })}</div>
      <p class="sub">${t('pl_blank')}</p>${btn(t('pl_create'), 'plcreate', '', 'pri sm')}</details>
    <h2>${t('pl_shops')}</h2>
    ${ss.length ? ss.map((s) => html`<div class="card">
      <div class="row sp"><div><div class="nm">${s.name}</div><p class="sub">${s.city} · ${s.phone}${s.plan_name ? ' · ' + s.plan_name : ''}</p></div>
        <span class="badge ${ST[s.state]}">${t('ps_' + s.state)}${s.days_left ? ' · ' + t('pl_left', { n: s.days_left }) : ''}</span></div>
      ${s.reason ? html`<p class="sub">${s.reason}</p>` : ''}
      <details class="more"><summary>${t('pl_manage')}</summary>
        ${live.length ? html`${seg('plpick_' + s.shop_id, String(S.form['plpick_' + s.shop_id] || live[0].id), live.map((p) => ({ id: String(p.id), label: p.name })))}
          ${field('plref_' + s.shop_id, t('pl_ref'), { maxlength: 80, placeholder: t('pl_ref_ph') })}
          <div class="chips">${btn(t('pl_start_trial'), 'plassign', s.shop_id + ':trial', 'sm')}${btn(t('pl_start_paid'), 'plassign', s.shop_id + ':paid', 'pri sm')}
            ${s.plan_id ? btn(t('pl_payment'), 'plpay', s.shop_id, 'pri sm') : ''}</div>` : html`<p class="sub">${t('pl_make_first')}</p>`}
        ${s.plan_id ? html`${field('plreason_' + s.shop_id, t('reason'), { maxlength: 200 })}
          <div class="chips">${s.state === 'suspended' ? btn(t('pl_resume'), 'plsusp', s.shop_id + ':resume', 'sm') : btn(t('pl_suspend'), 'plsusp', s.shop_id + ':suspend', 'danger sm')}</div>` : ''}
      </details></div>`) : empty(t('pl_noshops'))}`;
}

// Shown instead of every admin page until the authenticator is set up.
export function mfaView() {
  const m = S.d.mfa;
  if (!m) return loading();
  const key = (m.secret || '').match(/.{1,4}/g) || [];
  return html`<div class="card mfa"><h2>${t('mfa_h')}</h2><p>${t('mfa_d')}</p>
    <ol class="steps"><li>${t('mfa_s1')}</li><li>${t('mfa_s2')}</li><li>${t('mfa_s3')}</li></ol>
    <div class="codebox mono">${key.join(' ')}</div>
    <p class="center"><a class="btn sm" href="${m.uri}">${t('mfa_open')}</a></p>
    ${field('mfa_code', t('f_otp'), { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, cls: 'code' })}
    ${btn(t('mfa_enable'), 'mfaon', '', 'pri block')}</div>`;
}

// Wholesaler banner: trial / grace / expired / suspended.
export function planBanner() {
  const p = S.me && S.me.shop && S.me.shop.plan;
  if (!p || p.state === 'none' || p.state === 'active') return '';
  const cls = p.state === 'trial' ? 'info' : p.state === 'grace' || p.state === 'cancelled' ? '' : 'bad';
  return html`<div class="banner ${cls}">${t('pb_' + p.state, { n: p.days_left || 0, plan: p.name || '' })}</div>`;
}

const reload = async () => { await loadPlans(); app.render(); };
const go = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(t(okMsg), 'ok'); await reload(); } catch (e) { toast(errText(e), 'warn'); } };
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
export const planActions = {
  plcreate: () => go(async () => {
    const f = S.form;
    await api('POST', '/api/admin/plans', { name: f.pl_name || '', price: f.pl_price === undefined || f.pl_price === '' ? null : Number(f.pl_price),
      period_days: num(f.pl_period) ?? 30, trial_days: num(f.pl_trial) ?? 0, grace_days: num(f.pl_grace) ?? 7, max_products: num(f.pl_maxp), max_retailers: num(f.pl_maxr), max_staff: num(f.pl_maxs) });
    for (const k of ['pl_name', 'pl_price', 'pl_period', 'pl_trial', 'pl_grace', 'pl_maxp', 'pl_maxr', 'pl_maxs']) delete f[k]; S.open.newplan = false;
  }, 'saved'),
  plstatus: (v) => { const [id, st] = v.split(':'); return go(() => api('POST', '/api/admin/plans/' + id, { status: st }), 'saved'); },
  plassign: (v) => { const [sid, start] = v.split(':'); const live = (S.d.plans || []).filter((p) => p.status === 'active');
    const pid = Number(S.form['plpick_' + sid] || (live[0] && live[0].id));
    return go(() => api('POST', '/api/admin/shops/' + sid + '/plan', { plan_id: pid, start, reference: start === 'paid' ? (S.form['plref_' + sid] || '') : undefined }), 'saved'); },
  plpay: (sid) => go(() => api('POST', '/api/admin/shops/' + sid + '/payment', { reference: S.form['plref_' + sid] || '' }), 'pl_paid'),
  plsusp: (v) => { const [sid, act] = v.split(':'); return go(() => api('POST', '/api/admin/shops/' + sid + '/subscription/' + act, { reason: S.form['plreason_' + sid] || '' }), 'saved'); },
  mfaon: async () => {
    try { await api('POST', '/api/admin/2fa/enable', { otp: (S.form.mfa_code || '').trim() }); S.me.mfa_needed = false; delete S.form.mfa_code; toast(t('mfa_done'), 'ok'); await app.load(true); }
    catch (e) { toast(errText(e), 'warn'); }
  },
};
// seg() buttons send the plan picker id as act name 'plpick_<shop>' — handled generically in main.js.
