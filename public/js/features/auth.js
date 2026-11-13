import { html } from '../core/html.js';
import { S, app } from '../core/state.js';
import { t } from '../core/format.js';
import { api, errText } from '../core/api.js';
import { field, pwfield, btn, seg } from '../ui/components.js';
import { enter } from '../core/session.js';
import { withBusy } from '../core/busy.js';

export const langToggle = () => seg('lang', S.lang, [{ id: 'en', label: 'English' }, { id: 'hi', label: 'Hinglish' }]);

export function authView() {
  const signup = S.authMode === 'signup', f = S.form, ws = f.role === 'wholesaler';
  const demo = S.cfg.demo ? html`
    <div class="card soft demo"><b>${t('demo_title')}</b><span class="sub">${t('demo_pw', { pw: S.cfg.demo_password })}</span>
      <div class="chips">${S.cfg.accounts.map((a) => btn(a.label, 'fill', a.phone, 'chip'))}</div>
      <span class="sub">${t('demo_code', { code: S.cfg.demo_code })}</span></div>` : '';
  return html`
    <div class="authwrap">
      <div class="authtop"><div class="brand"><img class="logo" src="/icons/icon-192.png" alt="" width="28" height="28">Stock<span>Link</span></div>${langToggle()}</div>
      <div class="hero"><h1>${t('hero')}</h1><p>${t('hero_sub')}</p></div>
      ${seg('authmode', S.authMode, [{ id: 'login', label: t('login') }, { id: 'signup', label: t('signup') }])}
      <form data-form="${signup ? 'signup' : 'login'}" class="card" novalidate>
        ${signup ? html`${seg('role', f.role || 'retailer', [{ id: 'retailer', label: t('i_retailer') }, { id: 'wholesaler', label: t('i_wholesaler') }])}
          ${field('name', t('f_name'), { autocomplete: 'name', maxlength: 60 })}` : ''}
        ${field('phone', t('f_phone'), { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 16 })}
        ${pwfield('password', t('f_password'), { autocomplete: signup ? 'new-password' : 'current-password', maxlength: 128 })}
        ${!signup && S.needOtp ? field('otp', t('f_otp'), { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, cls: 'code' }) : ''}
        ${signup ? html`${field('shop_name', t('f_shop'), { maxlength: 80 })}${field('city', t('f_city'), { maxlength: 60 })}
          ${ws ? field('gstin', t('f_gstin'), { cls: 'code', maxlength: 15, autocomplete: 'off' }) : ''}
          <p class="sub">${t(ws ? 'signup_w_note' : 'signup_r_note')}</p>` : ''}
        <div class="err${S.needOtp && S.authErr === t('otp_needed') ? ' note-info' : ''}" role="alert">${S.authErr}</div>
        <button class="btn pri block" type="submit" ${S.busy ? 'disabled' : ''}>${t(signup ? 'signup' : 'login')}</button>
      </form>
      ${demo}
      <p class="sub center">${t('privacy')}</p>
    </div>`;
}

export const authActions = {
  lang: async (id) => { S.lang = id; app.render(); if (S.me) api('POST', '/api/me/prefs', { lang: id }).catch(() => {}); },
  authmode: (id) => { S.authMode = id; S.authErr = ''; app.render(); },
  role: (id) => { S.form.role = id; app.render(); },
  pwtoggle: (id) => { S.showPw = { ...(S.showPw || {}), [id]: !(S.showPw && S.showPw[id]) }; app.render(); document.getElementById(id)?.focus(); },
  fill: (id) => { S.form.phone = id; S.form.password = S.cfg.demo_password; S.authMode = 'login'; app.render(); },
};

export async function submitAuth(kind) {
  const signup = kind === 'signup', v = S.form;
  S.authErr = '';
  await withBusy(async () => {
    try {
      const m = signup
        ? await api('POST', '/api/signup', { role: v.role || 'retailer', name: v.name || '', phone: v.phone || '', password: v.password || '', shop_name: v.shop_name || '', city: v.city || '', gstin: v.role === 'wholesaler' ? (v.gstin || '') : undefined })
        : await api('POST', '/api/login', { phone: v.phone || '', password: v.password || '', otp: S.needOtp ? (v.otp || '') : undefined });
      S.busy = false; S.needOtp = false; delete v.otp;
      await enter(m);
    } catch (e) {
      if (e.message === 'otp_required') { S.needOtp = true; S.authErr = t('otp_needed'); app.render(); return; }
      S.authErr = errText(e);
    }
  });
}
