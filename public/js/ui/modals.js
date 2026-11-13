import { html } from '../core/html.js';
import { S, app, can } from '../core/state.js';
import { t } from '../core/format.js';
import { api, toast, errText } from '../core/api.js';
import { closeStream } from '../core/live.js';
import { field, btn, seg, unitName } from './components.js';
import { logout, enter } from '../core/session.js';
import { dev, pushBlocker, enablePush, disablePush, promptInstall } from '../core/device.js';
import { notesSheetBody } from '../features/notes.js';

const TUT = { retailer: ['r1', 'r2', 'r3', 'r4', 'r5'], wholesaler: ['w1', 'w2', 'w3', 'w4', 'w5'], admin: ['a1', 'a2', 'a3'] };

export const openModal = (m) => { S.modal = m; app.render(); };
export const closeModal = () => { S.modal = null; app.render(); };
export const startTutorial = () => openModal({ type: 'tut', i: 0 });

function endTutorial() {
  S.modal = null;
  if (S.me && !S.me.tutorial_done) {
    S.me.tutorial_done = true;
    api('POST', '/api/me/prefs', { tutorial_done: true }).catch(() => {});
  }
  app.render();
}

const sheet = (label, body) =>
  html`<div class="modal" data-bd="1" role="dialog" aria-modal="true" aria-label="${label}"><div class="sheet">${body}</div></div>`;

function tutorialSheet(m) {
  const steps = TUT[S.me.role], k = steps[m.i], last = m.i === steps.length - 1;
  return sheet(t('tut_label'), html`
    <div class="row sp"><div class="dots">${steps.map((_, i) => html`<i class="${i === m.i ? 'on' : ''}"></i>`)}</div>${btn(t('skip'), 'tutskip', '', 'ghost sm')}</div>
    <div class="tutbig" aria-hidden="true">${t(k + '_i')}</div>
    <h2>${t(k + '_t')}</h2><p>${t(k + '_b', { code: S.cfg.demo_code || '' })}</p>
    <div class="row sp">${btn(t('back'), 'tutback', '', '', { disabled: m.i === 0 })}${btn(t(last ? 'start' : 'next'), last ? 'tutdone' : 'tutnext', '', 'pri')}</div>`);
}

const codeSheet = (m) => sheet(t('code_new'), html`
  <h2>${t('code_new')}</h2><div class="codebox">${m.code}</div><p class="sub">${t('code_once')}</p>
  <div class="row wrap">${btn(t('share_code_btn'), 'sharecode', '', 'wa')}${btn(t('copy'), 'copycode')}${btn(t('done'), 'closemodal', '', 'pri')}</div>`);

// "App on this phone": install + phone alerts
function appGroup() {
  const why = pushBlocker();
  const install = dev.standalone ? html`<p class="sub">${t('installed')}</p>`
    : dev.installEvt ? btn(t('install'), 'install', '', 'sm')
    : dev.ios ? html`<p class="sub">${t('push_ios')}</p>` : '';
  const alerts = dev.pushOn
    ? html`<p class="sub ok">${t('push_on')}</p><div class="row">${btn(t('push_test'), 'pushtest', '', 'sm')}${btn(t('push_disable'), 'pushoff', '', 'ghost sm')}</div>`
    : why ? html`<p class="sub">${t('push_off')}. ${t(why)}</p>` : html`<p class="sub">${t('push_off')}</p>${btn(t('push_enable'), 'pushon', '', 'pri sm')}`;
  return html`<div class="group"><h3>${t('app_h')}</h3>${install}${alerts}</div>`;
}

function menuSheet() {
  const m = S.me, sh = m.shop;
  const upi = m.role === 'wholesaler' ? html`
    <div class="group"><h3>${t('shop_settings')}</h3><p class="sub">${t('upi_d')}</p>
      ${sh && sh.upi_id ? html`<div class="mono">${sh.upi_id}</div>` : ''}
      ${field('upi_id', t('upi_ph'), { maxlength: 80, autocomplete: 'off' })}${btn(t('save'), 'saveupi', '', 'sm')}
      <h3>${t('opts_h')}</h3>
      <div class="row sp"><span>${t('opt_cash')}</span>${btn(t(sh && (sh.allow_cash === 0 || sh.allow_cash === false) ? 'off' : 'on'), 'saveopts', 'allow_cash', 'sm' + (sh && (sh.allow_cash === 0 || sh.allow_cash === false) ? ' ghost danger' : ' pri'))}</div>
      <div class="row sp"><span>${t('opt_home')}</span>${btn(t(sh && (sh.allow_home === 0 || sh.allow_home === false) ? 'off' : 'on'), 'saveopts', 'allow_home', 'sm' + (sh && (sh.allow_home === 0 || sh.allow_home === false) ? ' ghost danger' : ' pri'))}</div></div>` : '';
  const bizs = m.businesses || [];
  const bizGroup = m.role === 'admin' ? '' : html`<div class="group"><h3>${t('biz_h')}</h3>
    <div class="list">${bizs.map((b) => html`<div class="item"><div class="grow"><div class="nm">${b.name}</div><div class="ls">${t('r_' + b.type)} · ${t('mr_' + b.member_role)} · ${b.city}</div></div>
      ${sh && b.id === sh.id ? html`<span class="badge good">${t('biz_active')}</span>` : btn(t('biz_switch'), 'switchbiz', b.id, 'sm')}</div>`)}</div>
    <details class="more" ${S.open.newbiz ? 'open' : ''}><summary>${t('biz_add_h')}</summary>
      ${seg('nbtype', S.form.nbtype || 'retailer', [{ id: 'retailer', label: t('r_retailer') }, { id: 'wholesaler', label: t('r_wholesaler') }])}
      ${field('nb_name', t('f_shop'), { maxlength: 80 })}${field('nb_city', t('f_city'), { maxlength: 60 })}
      ${(S.form.nbtype || 'retailer') === 'wholesaler' ? field('nb_gstin', t('f_gstin'), { maxlength: 15, cls: 'code', autocomplete: 'off' }) : ''}
      ${btn(t('biz_add'), 'newbiz', '', 'pri sm', { disabled: S.busy })}</details></div>`;
  const team = can('team') && sh ? html`<div class="group"><h3>${t('team_h')}</h3><p class="sub">${t('team_d')}</p>
    ${S.d.members ? html`<div class="list">${S.d.members.map((x) => html`<div class="item"><div class="grow"><div class="nm">${x.name}</div><div class="ls">${x.phone} · ${t('mr_' + x.role)}</div></div>
      ${x.role === 'owner' ? '' : btn(t('team_remove'), 'teamrm', x.id, 'ghost danger sm')}</div>`)}</div>` : ''}
    ${field('tm_phone', t('f_phone'), { type: 'tel', maxlength: 15, inputmode: 'tel' })}
    ${seg('tmrole', S.form.tmrole || 'staff', [{ id: 'staff', label: t('mr_staff') }, { id: 'manager', label: t('mr_manager') }])}
    <p class="sub">${t((S.form.tmrole || 'staff') === 'staff' ? 'team_staff_d' : 'team_mgr_d')}</p>
    ${btn(t('team_add'), 'teamadd', '', 'pri sm')}</div>` : '';
  return sheet(t('t_menu'), html`
    <div class="who"><span class="avatar">${(sh ? sh.name : m.name).slice(0, 1).toUpperCase()}</span>
      <div><b>${sh ? sh.name : m.name}</b><div class="sub">${t('r_' + m.role)}${m.member_role ? ' · ' + t('mr_' + m.member_role) : ''}</div></div></div>
    ${bizGroup}
    <div class="group"><h3>${t('lang_h')}</h3>${seg('lang', S.lang, [{ id: 'en', label: 'English' }, { id: 'hi', label: 'Hinglish' }])}</div>
    ${can('settings') ? upi : ''}
    ${team}
    ${appGroup()}
    <div class="row wrap">${btn(t('help'), 'tutorial')}${btn(t('logout'), 'logout', '', 'ghost danger')}${btn(t('close'), 'closemodal', '', 'pri')}</div>`);
}

function gallerySheet(m) {
  const p = ((S.d.catalog || {}).products || []).find((x) => x.id === m.id);
  if (!p) return sheet('', '');
  return sheet(p.name, html`<h2>${p.name}</h2><div class="gal">${p.media.map((id) => html`<img alt="${p.name}" loading="lazy" src="/api/media/${id}">`)}</div>${btn(t('close'), 'closemodal', '', 'pri block')}`);
}

export const sizesTotal = () => (S.form.psizes || []).reduce((a, r) => a + (Number(r.qty) > 0 ? Number(r.qty) : 0), 0);

// rows like "L 6 | XL 6 | XXL 6": one set holds all of them
function sizeRows(unit) {
  const rows = S.form.psizes || [];
  return html`<h3 class="gap">${t('sizes_h', { u: unitName(unit).toLowerCase() })}</h3>
    ${rows.map((r, i) => html`<div class="row sizerow">
      <input type="text" data-sz="${i}:label" value="${r.label}" maxlength="12" placeholder="${t('size_label')}" aria-label="${t('size_label')}">
      <input type="number" data-sz="${i}:qty" value="${r.qty}" min="1" inputmode="numeric" placeholder="${t('size_qty')}" aria-label="${t('size_qty')}">
      <button type="button" class="btn ghost sm" data-act="sizerm" data-id="${i}" aria-label="${t('rm_size')}">×</button></div>`)}
    <div class="chips">${['S', 'M', 'L', 'XL', 'XXL', 'XXXL'].map((l) => btn(l, 'sizeadd', l, 'chip'))}${btn(t('size_other'), 'sizeadd', '', 'chip')}</div>
    <p class="total-line">${t('set_total', { u: unitName(unit).toLowerCase() })} <b id="sztotal">${sizesTotal()}</b> pcs</p>`;
}

function addProductSheet() {
  const f = S.form, unit = f.punit || 'pc', mode = f.pmode || 'plain';
  return sheet(t('add_h'), html`
    <h2>${t('add_h')}</h2>
    <div class="prev">${(f.photos || []).map((u, i) => html`<div><img alt="" src="${u}"><button type="button" data-act="rmphoto" data-id="${i}" aria-label="${t('rm')}">×</button></div>`)}</div>
    <label class="btn sm" for="aPhotos">${t('add_photos')}</label><input class="vh" type="file" id="aPhotos" accept="image/*" multiple>
    ${field('pname', t('add_name'), { maxlength: 100 })}${field('pspec', t('add_spec'), { maxlength: 200 })}
    ${field('pcat', t('add_cat'), { maxlength: 30, placeholder: t('cat_ph'), list: 'catlist' })}
    <datalist id="catlist">${[...new Set((S.d.products || []).map((p) => p.category).filter(Boolean))].map((c) => html`<option value="${c}"></option>`)}</datalist>
    <div class="group"><h3>${t('sold_as')}</h3>${seg('punit', unit, ['pc', 'set', 'box', 'pack', 'dozen'].map((u) => ({ id: u, label: unitName(u) })))}
      ${unit === 'pc' ? '' : html`${seg('pmode', mode, [{ id: 'plain', label: t('mode_plain') }, { id: 'sizes', label: t('mode_sizes') }])}
        ${mode === 'sizes' ? sizeRows(unit) : html`${field('ppack', t('pack_qty'), { type: 'number', min: 1, inputmode: 'numeric', placeholder: '12' })}<p class="sub">${t('pack_hint', { u: unitName(unit).toLowerCase() })}</p>`}`}</div>
    <div class="row">${field('pprice', t('add_price'), { type: 'number', min: 0, step: '0.01', inputmode: 'decimal' })}${field('pstock', t('add_stock'), { type: 'number', min: 0, inputmode: 'numeric' })}${field('pmoq', t('add_moq'), { type: 'number', min: 1, inputmode: 'numeric' })}</div>
    <div class="row wrap">${btn(t('close'), 'closemodal')}${btn(t('add_btn'), 'addp', '', 'pri', { disabled: S.busy })}</div>`);
}

export function modalView() {
  const m = S.modal;
  if (m.type === 'code') return codeSheet(m);
  if (m.type === 'menu') return menuSheet();
  if (m.type === 'notes') return sheet(t('t_notes'), notesSheetBody());
  if (m.type === 'gal') return gallerySheet(m);
  if (m.type === 'addp') return addProductSheet();
  return tutorialSheet(m);
}

export const modalActions = {
  menu: async () => { openModal({ type: 'menu' }); if (can('team') && S.me.shop) { try { S.d.members = (await api('GET', '/api/b/members')).members; app.render(); } catch (_) { /* shown without the team list */ } } },
  nbtype: (id) => { S.form.nbtype = id; S.open.newbiz = true; app.render(); },
  tmrole: (id) => { S.form.tmrole = id; app.render(); },
  switchbiz: async (id) => {
    try { const m = await api('POST', '/api/me/business', { shop_id: Number(id) }); closeStream(); S.modal = null; await enter(m); toast(t('biz_now', { s: m.shop.name }), 'ok'); }
    catch (e) { toast(errText(e), 'warn'); }
  },
  newbiz: async () => {
    const f = S.form, type = f.nbtype || 'retailer';
    if (!f.nb_name || !f.nb_city || (type === 'wholesaler' && !f.nb_gstin)) return toast(t('need'), 'warn');
    try { const m = await api('POST', '/api/businesses', { type, shop_name: f.nb_name, city: f.nb_city, gstin: f.nb_gstin || undefined });
      for (const k of ['nb_name', 'nb_city', 'nb_gstin', 'nbtype']) delete f[k]; S.open.newbiz = false; closeStream(); S.modal = null; await enter(m); toast(t('biz_now', { s: m.shop.name }), 'ok'); }
    catch (e) { toast(errText(e), 'warn'); }
  },
  teamadd: async () => {
    try { await api('POST', '/api/b/members', { phone: S.form.tm_phone || '', role: S.form.tmrole || 'staff' }); delete S.form.tm_phone; S.d.members = (await api('GET', '/api/b/members')).members; toast(t('saved'), 'ok'); app.render(); }
    catch (e) { toast(errText(e), 'warn'); }
  },
  teamrm: async (id) => {
    try { await api('POST', '/api/b/members/' + id + '/remove', {}); S.d.members = (await api('GET', '/api/b/members')).members; toast(t('team_removed'), 'bad'); app.render(); }
    catch (e) { toast(errText(e), 'warn'); }
  },
  closemodal: closeModal,
  tutorial: startTutorial,
  tutnext: () => { S.modal.i++; app.render(); },
  tutback: () => { S.modal.i = Math.max(0, S.modal.i - 1); app.render(); },
  tutskip: endTutorial,
  tutdone: endTutorial,
  gal: (id) => openModal({ type: 'gal', id: +id }),
  addform: () => { S.form.photos = S.form.photos || []; openModal({ type: 'addp' }); },
  copycode: async () => {
    try { await navigator.clipboard.writeText(S.modal.code); toast(t('copied'), 'ok'); } catch (_) { toast(S.modal.code); }
  },
  sharecode: () => {
    const msg = t('wa_code_msg', { url: location.origin, code: S.modal.code });
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  },
  logout,
  install: async () => { if (await promptInstall()) toast(t('installed'), 'ok'); app.render(); },
  pushon: async () => {
    let why;
    try { why = await enablePush(); } catch (_) { why = 'e_sub'; }
    toast(why ? t(why) : t('push_on'), why ? 'warn' : 'ok');
    app.render();
  },
  pushoff: async () => { await disablePush(); toast(t('push_off'), 'ok'); app.render(); },
  pushtest: async () => { try { await api('POST', '/api/push/test', {}); toast(t('push_test_sent'), 'ok'); } catch (_) { toast(t('e_rate'), 'warn'); } },
  rmphoto: (id) => { S.form.photos.splice(+id, 1); app.render(); },
};
