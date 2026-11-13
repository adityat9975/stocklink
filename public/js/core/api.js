import { S, app } from './state.js';
import { t } from './format.js';
import { esc } from './html.js';
import { closeStream } from './live.js';

export const $ = (s, r = document) => r.querySelector(s);

const ER = {
  invalid_credentials: 'e_cred', network: 'e_net', server_error: 'e_server', rate_limited: 'e_rate', too_many_attempts: 'e_attempts', login_locked: 'e_locked',
  phone_taken: 'e_phone', weak_password: 'e_pw', invalid_phone: 'e_phone_inv', invalid_code: 'e_code', already_connected: 'e_already',
  insufficient_stock: 'e_stock', below_moq: 'e_moq', not_connected: 'e_notconn', shop_not_verified: 'e_notver', credit_not_allowed: 'e_credit',
  too_many_open_orders: 'e_open', payment_reference_missing: 'e_payref', wrong_pickup_code: 'e_pickup', utr_already_used: 'e_utr',
  invalid_utr: 'e_utr_inv', below_reserved: 'e_reserved', invalid_image: 'e_img', image_too_large: 'e_img', too_many_photos: 'e_photos',
  csrf: 'e_generic', invalid_gstin: 'e_gstin', gstin_required: 'e_gstin_req', gstin_taken: 'e_gstin_taken', invalid_upi_id: 'e_upi',
  too_many_active_codes: 'e_codes', product_unavailable: 'e_unavail', bad_state: 'e_state', cash_not_allowed: 'e_cash', delivery_not_allowed: 'e_delivery',
  supplier_inactive: 'e_supplier_off', plan_inactive: 'e_plan_off', plan_limit: 'e_plan_limit', mfa_required: 'e_mfa', invalid_otp: 'e_otp', plan_has_no_trial: 'e_no_trial', no_plan: 'e_no_plan', plan_not_found: 'e_no_plan',
  not_member: 'e_not_member', no_permission: 'e_no_perm', user_not_found: 'e_user_nf', already_member: 'e_already_member', cannot_remove_owner: 'e_rm_owner', too_many_businesses: 'e_many_biz',
};

export async function api(method, url, body) {
  const opt = { method, headers: { 'X-Requested-With': 'StockLink' }, credentials: 'same-origin' };
  // Name the business this page acts for; the server checks the user belongs to it.
  if (S.me && S.me.shop && S.me.shop.id) opt.headers['X-Business'] = String(S.me.shop.id);
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch (_) { throw new Error('network'); }
  let j = {};
  try { j = await r.json(); } catch (_) { /* empty body */ }
  if (!r.ok) {
    const e = new Error(j.error || 'error');
    e.status = r.status; e.data = j;
    if (r.status === 401 && url !== '/api/login' && S.me) { S.me = null; closeStream(); toast(t('e_session'), 'warn'); app.render(); }
    throw e;
  }
  return j;
}

export const errText = (e) => {
  if (e.message === 'insufficient_stock') return t('e_stock', { n: (e.data && e.data.available) ?? 0 });
  return t(ER[e.message] || 'e_generic', e.data || {});
};

let toastTimer;
// kind: 'ok' (green, done), 'warn' (orange, info / cannot be done), 'bad' (red, cancelled / denied), '' (neutral)
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.innerHTML = '<div class="t' + (/^(ok|warn|bad)$/.test(kind) ? ' ' + kind : '') + '" role="' + (kind === 'warn' || kind === 'bad' ? 'alert' : 'status') + '">' + esc(msg) + '</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.innerHTML = ''; }, 3600);
}

// Runs an API call; on failure shows the error toast and returns undefined.
export async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(errText(e), 'warn'); return undefined; }
}
