import { html } from '../core/html.js';
import { S, FINAL, FLOW, app } from '../core/state.js';
import { t, money, ago } from '../core/format.js';
import { api, toast, errText, attempt } from '../core/api.js';
import { withBusy } from '../core/busy.js';
import { shrink } from './images.js';
import { alertCard } from './notes.js';
import { field, btn, seg, chips, hello, hero, quick, photoCard, allClear, empty, loading, sectionHead, thumb, stockLine, track, statusBadge, yn, icon, perUnit, sizesLine, qtyTotal, proposalView } from '../ui/components.js';

/* ---------- data ---------- */
const approvedConns = () => (S.d.conns || []).filter((x) => x.status === 'approved' && x.verification === 'approved');
const isLive = (o) => !FINAL.includes(o.status);

export async function loadRetailer(tab) {
  const c = await api('GET', '/api/r/wholesalers');
  S.d.conns = c.connections;
  const approved = approvedConns();
  // Prefer a supplier whose catalogue is open; a paused one (plan expired) stays listed but is not opened by default.
  if (!approved.find((x) => x.shop_id === S.sel.wid)) { const open = approved.find((x) => x.supplier_active !== false) || approved[0]; S.sel.wid = open ? open.shop_id : null; }
  const sel = approved.find((x) => x.shop_id === S.sel.wid);
  const wantsCatalog = tab === 'catalog' || tab === 'home';
  if (wantsCatalog && sel && sel.supplier_active === false) S.d.catalog = { paused: true, shop: { id: sel.shop_id, name: sel.name, city: sel.city }, products: [] };
  else if (wantsCatalog && S.sel.wid) { S.d.catalog = await api('GET', '/api/r/catalog/' + S.sel.wid); watchCheck(); }
  else if (wantsCatalog) S.d.catalog = null;
  if (['orders', 'home', 'catalog'].includes(tab)) S.d.orders = (await api('GET', '/api/r/orders')).orders;
}

/* ---------- "tell me when it is back" watch list (this device only) ---------- */
const WKEY = 'sl_watch';
const watchGet = () => { try { return JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch (_) { return []; } };
const watchSet = (a) => { try { localStorage.setItem(WKEY, JSON.stringify(a.slice(-50))); } catch (_) { /* storage blocked */ } };

function watchCheck() {
  const prev = S.prevAvail, w = watchGet(), back = [];
  for (const p of S.d.catalog.products) {
    if (w.includes(p.id) && prev[p.id] === 0 && p.available > 0 && p.status === 'active') back.push(p);
    prev[p.id] = p.available;
  }
  if (back.length) {
    watchSet(w.filter((id) => !back.find((b) => b.id === id)));
    toast(t('back_in', { n: back.map((b) => b.name).join(', ') }), 'ok');
  }
}

function usualItems() {
  const cat = S.d.catalog;
  if (!cat) return [];
  const seen = {};
  for (const o of S.d.orders || []) {
    if (o.wholesaler_shop_id !== S.sel.wid || ['cancelled', 'expired'].includes(o.status)) continue;
    for (const i of o.items) {
      const s = (seen[i.product_id] = seen[i.product_id] || { n: 0, last: 0 });
      s.n += i.qty; s.last = Math.max(s.last, o.created_at);
    }
  }
  return Object.keys(seen)
    .map((id) => ({ p: cat.products.find((x) => x.id === +id), s: seen[id] }))
    .filter((x) => x.p)
    .sort((a, b) => b.s.last - a.s.last || b.s.n - a.s.n)
    .slice(0, 5).map((x) => x.p);
}

/* ---------- views ---------- */
export function retailerBody() {
  if (S.checkout) return checkoutView();
  return ({ home: homeView, orders: ordersView, wholesalers: shopsView }[S.tab] || catalogView)();
}

export const cartBarIfCatalog = () => (S.tab === 'catalog' || S.tab === 'home') && !S.checkout ? cartBar() : '';

function cartBar() {
  const items = Object.entries(S.cart.items).filter(([, q]) => q > 0);
  if (!items.length || !S.d.catalog) return '';
  let total = 0, n = 0;
  for (const [id, q] of items) {
    const p = S.d.catalog.products.find((x) => x.id === +id);
    if (p) { total += p.price_paise * q; n += q; }
  }
  return html`<button class="cartbar" data-act="review"><span>${t('cart_items', { n })}</span><span>${t('review')} · ${money(total)}</span></button>`;
}

const cats = (cat) => {
  const m = new Map();
  for (const p of (cat && cat.products) || []) {
    if (!p.category || p.status !== 'active') continue;
    const c = m.get(p.category) || { name: p.category, n: 0, img: null };
    c.n++; if (!c.img && p.media && p.media.length) c.img = p.media[0]; m.set(p.category, c);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
};
const searchBar = () => html`<form class="sbar" data-form="homesearch" role="search"><span class="sbar-ic">${icon('search')}</span>
  <input id="hq" data-f="hq" type="search" value="${S.form.hq || ''}" placeholder="${t('h_search_ph')}" aria-label="${t('h_search_ph')}" autocomplete="off" enterkeyhint="search">
  <button type="button" class="btn pri sm" data-act="homesearch">${t('search')}</button></form>`;

const STEPS = [['received', 'tl_placed'], ['paid', 'tl_confirmed'], ['packed', 'tl_packed'], ['dispatched', 'tl_ready'], ['completed', 'tl_done']];
function timeline(o) {
  const idx = FLOW.indexOf(o.status);
  return html`<button class="card tl link" data-act="tab" data-id="orders">
    <div class="row sp"><div><b>${o.no}</b> <span class="sub">· ${o.wholesaler.name}</span></div><span class="price">${money(o.subtotal_paise)}</span></div>
    <div class="tl-steps">${STEPS.map(([st, k], i) => html`<div class="tl-s ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="tl-dot">${i < idx ? icon('check') : ''}</span><span class="tl-l">${t(k === 'tl_ready' && o.fulfilment === 'home' ? 'tl_onway' : k)}</span></div>`)}</div>
    ${o.status === 'dispatched' && o.fulfilment === 'pickup' ? html`<div class="tl-code">${t('h_show_code')}: <b class="pick">${o.pickup_code}</b></div>` : ''}</button>`;
}

function homeView() {
  if (!approvedConns().length) return html`${hello()}${catalogView()}`;
  const os = S.d.orders || [], cat = S.d.catalog;
  const needPay = os.filter((o) => o.payment_mode === 'upi' && o.status === 'received' && !o.utr);
  const active = os.filter(isLive);
  const last = os.find((o) => o.wholesaler_shop_id === S.sel.wid && !['cancelled', 'expired'].includes(o.status));
  const usual = usualItems();
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const month = os.filter((o) => o.created_at >= m0.getTime() && !['cancelled', 'expired'].includes(o.status));
  const spent = month.reduce((a, o) => a + o.subtotal_paise, 0);
  const cur = approvedConns().find((c) => c.shop_id === S.sel.wid) || approvedConns()[0];
  const byId = (id) => cat && cat.products.find((p) => p.id === id);
  const live = cat ? cat.products.filter((p) => p.status === 'active' && p.available > 0) : [];
  const fresh = live.filter((p) => p.is_new).slice(0, 5);
  const shelf = usual.length ? usual : live.slice(0, 8);
  const cs = cats(cat);
  const addBtn = (p) => (p.available > 0 && p.status === 'active' ? btn('+ ' + t('add_1'), 'quick', p.id, 'pri sm') : html`<span class="sub">${t('out')}</span>`);
  return html`
    ${searchBar()}
    ${hero({
      title: cur ? cur.name : '', bigLabel: t('h_month_buy'), big: money(spent), bigRaw: spent,
      bigSub: t('h_month_orders', { n: month.length }),
      stats: [[active.length, t('h_active'), 'tab', 'orders'], [needPay.length, t('h_topay'), 'tab', 'orders']],
    })}
    ${alertCard()}
    ${fresh.length ? html`<div class="banners" id="banners">${fresh.map((p) => html`<button class="bn" data-act="catpick" data-id="${p.category ? 'c:' + p.category : 'q:' + p.name}">
      <div class="bn-t"><span class="bn-k">${t('h_new_at', { s: cat.shop.name })}</span><b>${p.name}</b><span class="bn-p">${money(p.price_paise)} <span class="bn-go">${t('h_view')} →</span></span></div>
      <div class="bn-img">${p.media && p.media.length ? html`<img alt="" src="/api/media/${p.media[0]}">` : icon('box')}</div></button>`)}</div>
      ${fresh.length > 1 ? html`<div class="bn-dots" aria-hidden="true">${fresh.map((_, i) => html`<i class="${i === 0 ? 'on' : ''}"></i>`)}</div>` : ''}` : ''}
    ${cs.length ? html`${sectionHead(t('h_cats'))}<div class="cats">${cs.map((c) => html`<button class="ct" data-act="catpick" data-id="c:${c.name}"><span class="ct-img">${c.img ? html`<img alt="" loading="lazy" src="/api/media/${c.img}">` : icon('box')}</span><span class="ct-n">${c.name}</span></button>`)}</div>` : ''}
    ${active.length ? html`${sectionHead(t('h_track'), active.length > 1 ? btn(t('h_see_all'), 'tab', 'orders', 'ghost sm') : '')}${timeline(active[0])}` : ''}
    ${needPay.map((o) => html`<div class="card alert"><div class="row sp"><div><b>${o.no}</b> <span class="sub">· ${o.wholesaler.name}</span></div><span class="price">${money(o.subtotal_paise)}</span></div>${btn(t('pay_now'), 'tab', 'orders', 'pri sm')}</div>`)}
    ${last ? html`<div class="card reo"><h3>${t('last_order')}</h3>
      <div class="reo-pics">${last.items.slice(0, 4).map((i) => { const p = byId(i.product_id); return p && p.media && p.media.length ? html`<img alt="" loading="lazy" src="/api/media/${p.media[0]}">` : html`<span class="ph"></span>`; })}${last.items.length > 4 ? html`<span class="more">+${last.items.length - 4}</span>` : ''}</div>
      <div class="big">${last.items.slice(0, 2).map((i) => i.qty + ' × ' + i.name).join(', ')}${last.items.length > 2 ? ' +' + (last.items.length - 2) : ''}</div>
      <div class="sub">${last.wholesaler.name} · ${money(last.subtotal_paise)} · ${ago(last.created_at)}</div>
      ${btn(t('reorder'), 'reorder', last.id, 'pri block')}</div>` : ''}
    ${shelf.length ? html`${sectionHead(t(usual.length ? 'usual_h' : 'h_fresh'), btn(t('h_see_all'), 'tab', 'catalog', 'ghost sm'))}
      <div class="prow">${shelf.map((p) => photoCard(p, { tag: p.available > 0 && p.available <= 5 ? t('h_left', { n: p.available }) : '', action: addBtn(p) }))}</div>` : ''}`;
}

// New-arrivals banner slides by itself every 4 s (pauses when touched or when motion is reduced).
let bnTimer = null, bnHold = 0;
function bnSync(el) { const i = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('.bn-dots i').forEach((d, j) => d.classList.toggle('on', j === i)); }
document.addEventListener('scroll', (e) => { if (e.target && e.target.id === 'banners') bnSync(e.target); }, true);
document.addEventListener('touchstart', (e) => { if (e.target.closest && e.target.closest('#banners')) bnHold = Date.now() + 8000; }, { passive: true });
clearInterval(bnTimer);
bnTimer = setInterval(() => {
  const el = document.getElementById('banners');
  if (!el || document.hidden || Date.now() < bnHold || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const n = el.children.length, i = Math.round(el.scrollLeft / el.clientWidth);
  if (n > 1) el.scrollTo({ left: ((i + 1) % n) * el.clientWidth, behavior: 'smooth' });
}, 4000);

function usualRow(p) {
  const out = p.available <= 0, low = p.available <= 5 && !out;
  return html`<div class="item">${thumb(p)}<div class="grow"><div class="nm">${p.name}</div>
    <div class="ls">${money(p.price_paise)} / ${perUnit(p)}${low ? ' · ' + t('low_run') : ''}</div></div>
    <span class="qty ${out ? 'out' : low ? 'low' : ''}">${out ? t('out') : p.available}</span>
    ${!out && p.status === 'active' ? btn('+ ' + t('add_1'), 'quick', p.id, 'pri sm') : ''}</div>`;
}

const joinCard = () => html`<div class="card"><h3>${t('join_h')}</h3><p class="sub">${t('join_d')}</p>
  ${field('code', t('invite_code'), { cls: 'code', autocomplete: 'off', maxlength: 12, placeholder: t('code_ph') })}${btn(t('join'), 'join', '', 'pri')}</div>`;

function searchCard() {
  const res = S.d.search || [];
  return html`<details class="card more" ${S.open.searched ? 'open' : ''}><summary>${t('find_h')}</summary>
    ${field('q', t('find_ph'), { maxlength: 40, autocomplete: 'off' })}${btn(t('search'), 'search')}
    ${res.map((s) => html`<div class="item"><div class="grow"><div class="nm">${s.name}</div><div class="ls">${s.city}</div></div>
      ${s.conn === 'approved' ? html`<span class="badge good">${t('connected')}</span>` : s.conn === 'pending' ? html`<span class="badge mute">${t('pending')}</span>` : s.conn === 'blocked' ? '' : btn(t('request'), 'reqaccess', s.id, 'sm')}</div>`)}
    ${S.open.searched && !res.length ? html`<p class="sub">${t('no_results')}</p>` : ''}</details>`;
}

function catalogView() {
  const approved = approvedConns(), pend = (S.d.conns || []).filter((x) => x.status === 'pending');
  if (!approved.length) {
    return html`<h2>${t('locked')}</h2><p class="sub">${t('locked_d')}</p>
      ${pend.map((c) => html`<div class="banner info"><b>${c.name}</b>: ${t('pending_d')}</div>`)}${joinCard()}${searchCard()}`;
  }
  const cat = S.d.catalog;
  if (!cat) return loading();
  if (cat.paused) return html`${approved.length > 1 ? chips('selw', S.sel.wid, approved.map((c) => ({ id: c.shop_id, label: c.name }))) : ''}
    <h2>${cat.shop.name}</h2><div class="banner">${t('sup_paused_d')}</div>`;
  return html`
    ${approved.length > 1 ? chips('selw', S.sel.wid, approved.map((c) => ({ id: c.shop_id, label: c.name }))) : ''}
    <div class="head"><h2>${cat.shop.name}</h2><p class="sub">${cat.shop.city} · <span class="badge acc">${t('verified')}</span></p></div>
    ${catTools(cat)}
    ${(() => { const list = filtered(cat); return list.length ? html`<div class="list">${list.map(productRow)}</div>` : empty(cat.products.length ? t('h_no_match') : t('no_products')); })()}`;
}

function filtered(cat) {
  const qq = (S.cq || '').trim().toLowerCase();
  return cat.products.filter((p) => (!S.ccat || p.category === S.ccat) && (!qq || (p.name + ' ' + p.spec + ' ' + (p.category || '')).toLowerCase().includes(qq)));
}
function catTools(cat) {
  const cs = cats(cat);
  return html`<form class="sbar" data-form="catsearch" role="search"><span class="sbar-ic">${icon('search')}</span>
    <input id="cq" data-f="cq" type="search" value="${S.form.cq ?? S.cq ?? ''}" placeholder="${t('h_search_ph')}" aria-label="${t('h_search_ph')}" autocomplete="off" enterkeyhint="search">
    ${S.cq ? btn('×', 'catclear', '', 'ghost sm', { 'aria-label': t('close') }) : btn(t('search'), 'catsearch', '', 'pri sm')}</form>
    ${cs.length ? chips('catpick', S.ccat ? 'c:' + S.ccat : 'all', [{ id: 'all', label: t('all') }, ...cs.map((c) => ({ id: 'c:' + c.name, label: c.name }))]) : ''}`;
}

function productRow(p) {
  const q = (S.cart.wid === p.shop_id && S.cart.items[p.id]) || 0, can = p.status === 'active' && p.available > 0, watching = watchGet().includes(p.id);
  const action = can
    ? html`<div class="stepper"><button data-act="cart" data-id="${p.id}:-1" aria-label="${t('less')}">−</button><b>${q}</b><button data-act="cart" data-id="${p.id}:1" aria-label="${t('more')}">+</button></div>`
    : p.status === 'active' ? btn(t(watching ? 'notifying' : 'notify'), 'watch', p.id, 'sm' + (watching ? ' pri' : ''), { 'aria-pressed': yn(watching) }) : '';
  const hasPhoto = p.media && p.media.length;
  return html`<div class="item prod">
    <button class="thumbbtn" data-act="gal" data-id="${p.id}" aria-label="${t('photos')}" ${hasPhoto ? '' : 'disabled'}>${thumb(p)}</button>
    <div class="grow"><div class="nm">${p.name}${p.is_new ? html` <span class="badge acc">${t('newtag')}</span>` : ''}</div>
      ${p.spec ? html`<div class="ls">${p.spec}</div>` : ''}
      <div class="ls"><b class="price">${money(p.price_paise)}</b>${p.rate === 'special' ? html` <span class="badge acc">${t('your_price')}</span>` : ''} / ${perUnit(p)}${p.moq > 1 ? ' · ' + t('moq', { n: p.moq }) : ''}</div>
      ${p.pack_detail.length ? html`<div class="ls sizes">${sizesLine(p.pack_detail)}</div>` : ''}
      <div class="ls">${stockLine(p)}</div></div>
    <div class="act">${action}${can && q > 0 && p.pack_qty > 1 ? html`<div class="ls center">${qtyTotal(p, q)}</div>` : ''}</div></div>`;
}

function checkoutView() {
  const cat = S.d.catalog, co = S.checkout, conn = (S.d.conns || []).find((c) => c.shop_id === S.cart.wid) || {};
  let total = 0;
  const lines = Object.entries(S.cart.items).filter(([, q]) => q > 0).map(([id, q]) => {
    const p = cat.products.find((x) => x.id === +id);
    total += p.price_paise * q;
    return html`<div class="row sp"><span>${q} × ${p.name}${p.pack_qty > 1 ? html`<br><span class="ls">${qtyTotal(p, q)}${p.pack_detail.length ? ' · ' + sizesLine(p.pack_detail, q) : ''}</span>` : ''}</span><span class="price">${money(p.price_paise * q)}</span></div>`;
  });
  const home = co.fulfilment === 'home', cashOk = cat.shop.allow_cash !== 0 && cat.shop.allow_cash !== false, homeOk = cat.shop.allow_home !== 0 && cat.shop.allow_home !== false;
  const payNote = co.mode === 'upi' ? t('upi_note', { upi: conn.upi_id || cat.shop.upi_id || '—' }) : co.mode === 'credit' ? t('credit_note') : t(home ? 'cod_note' : 'cash_pickup_note');
  return html`
    ${btn('← ' + t('back'), 'cobk', '', 'ghost sm selfstart')}<h2>${t('checkout')}</h2>
    <div class="card">${lines}<div class="row sp total"><b>${t('total')}</b><b class="price">${money(total)}</b></div></div>
    <div class="card"><h3>${t('fulfil')}</h3>${seg('ful', co.fulfilment, [{ id: 'pickup', label: t('pickup') }, { id: 'home', label: t(homeOk ? 'home' : 'home_off'), disabled: !homeOk }])}
      ${co.fulfilment === 'home' ? field('address', t('address'), { maxlength: 300, autocomplete: 'street-address' }) : html`<p class="sub">${t('pickup_note')}</p>`}</div>
    <div class="card"><h3>${t('pay')}</h3>${seg('pm', co.mode, [{ id: 'upi', label: 'UPI' }, { id: 'credit', label: t('p_credit'), disabled: !conn.credit_allowed }, { id: 'cod', label: t(cashOk ? (home ? 'p_cod' : 'p_cash_pickup') : 'cash_off'), disabled: !cashOk }])}
      <p class="sub">${payNote}</p></div>
    <p class="sub">${t('reserve_note')}</p>
    <button class="btn pri block" data-act="place" ${S.busy ? 'disabled' : ''}>${t('place')}</button>`;
}

function ordersView() {
  const all = S.d.orders;
  if (!all) return loading();
  const tab = S.open.ord || 'active', list = all.filter((o) => (tab === 'active') === isLive(o));
  return html`<h2>${t('t_orders')}</h2>
    ${seg('ordtab', tab, [{ id: 'active', label: t('ord_active') }, { id: 'past', label: t('ord_past') }])}
    ${list.length ? list.map(orderCard) : empty(t(tab === 'active' ? 'ord_none_active' : 'ord_none_past'))}`;
}

function orderCard(o) {
  const live = isLive(o), needsUtr = o.payment_mode === 'upi' && o.status === 'received' && !o.utr;
  return html`<div class="card order">
    <div class="row sp"><div><b>${o.no}</b> <span class="sub">· ${o.wholesaler.name}</span></div>${statusBadge(o)}</div>
    ${o.items.map((i) => html`<div class="sub">${i.qty} × ${i.name} · ${money(i.unit_price_paise)}${i.pack_qty > 1 ? html`<br>${qtyTotal(i, i.qty)}${i.pack_detail.length ? ' · ' + sizesLine(i.pack_detail, i.qty) : ''}` : ''}</div>`)}
    ${track(o)}
    <div class="row sp"><span class="sub">${t(o.fulfilment === 'home' ? 'home' : 'pickup')} · ${t(o.payment_mode === 'cod' && o.fulfilment === 'pickup' ? 'pm_cash_pickup' : 'pm_' + o.payment_mode)}</span><span class="price">${money(o.subtotal_paise)}</span></div>
    ${o.fulfilment === 'pickup' && live ? html`<div class="note"><span class="sub">${t('pickup_code')}</span><span class="pick">${o.pickup_code}</span><span class="sub">${t('pickup_code_d')}</span></div>` : ''}
    ${needsUtr ? html`<div class="note"><h3>${t('pay_now')}</h3><p class="sub">${t('pay_now_d', { upi: o.wholesaler.upi_id || '—', amt: money(o.subtotal_paise) })}</p>
      ${field('utr_' + o.id, t('utr'), { cls: 'code', maxlength: 30, autocomplete: 'off' })}
      <div class="row wrap"><label class="btn sm" for="proof_${o.id}">${t(S.form['proof_' + o.id] ? 'proof_ok' : 'proof_add')}</label><input class="vh" type="file" accept="image/*" id="proof_${o.id}" data-proof="${o.id}">${btn(t('submit_pay'), 'paysubmit', o.id, 'pri sm')}</div></div>` : ''}
    ${o.utr ? html`<div class="sub">${t('utr')}: <span class="mono">${o.utr}</span> · ${t(o.status === 'received' ? 'verify_wait' : 'verified')}</div>` : ''}
    ${o.cancel_reason && !live ? html`<div class="sub">${o.cancel_reason}</div>` : ''}
    ${o.proposal ? html`${proposalView(o)}<p class="sub">${t('prop_ask')}</p><div class="row wrap">${btn(t('prop_accept'), 'propdec', o.id + ':accept', 'pri sm')}${btn(t('prop_decline'), 'propdec', o.id + ':decline', 'ghost danger sm')}</div>` : ''}
    <div class="row wrap">${btn(t('msg_btn'), 'chatorder', o.wholesaler_shop_id + ':' + o.id, 'ghost sm')}${o.status === 'received' ? btn(t('cancel_order'), 'rcancel', o.id, 'ghost danger sm') : ''}</div></div>`;
}

function shopsView() {
  const cs = S.d.conns;
  if (!cs) return loading();
  return html`<h2>${t('my_wh')}</h2>
    ${cs.length ? html`<div class="list">${cs.map((c) => html`<div class="item"><div class="grow"><div class="nm">${c.name}</div>
      <div class="ls">${c.city}${c.status === 'approved' && c.credit_allowed ? ' · ' + t('credit_ok') : ''}</div></div>
      <span class="badge ${c.supplier_active === false ? 'warn' : c.status === 'approved' ? 'good' : c.status === 'pending' ? 'mute' : 'bad'}">${c.supplier_active === false ? t('sup_paused') : t('cs_' + c.status)}</span></div>`)}</div>` : empty(t('no_wh'))}
    ${joinCard()}${searchCard()}`;
}

/* ---------- actions ---------- */
const startCheckout = () => {
  S.checkout = { idem: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), fulfilment: 'pickup', mode: 'upi' };
  S.form.address = S.form.address || '';
  app.render();
};

const goCatalog = () => { S.tab = 'catalog'; window.scrollTo(0, 0); app.render(); app.load(true); };
export const retailerActions = {
  homesearch: () => { S.cq = (S.form.hq || '').trim(); S.form.cq = S.cq; S.ccat = null; goCatalog(); },
  catsearch: () => { S.cq = (S.form.cq || '').trim(); app.render(); },
  catclear: () => { S.cq = ''; S.form.cq = ''; S.ccat = null; app.render(); },
  catpick: (id) => { if (id === 'all') S.ccat = null; else if (id.startsWith('c:')) { S.ccat = id.slice(2); S.cq = ''; S.form.cq = ''; } else if (id.startsWith('q:')) { S.cq = id.slice(2); S.form.cq = S.cq; S.ccat = null; } if (S.tab !== 'catalog') goCatalog(); else app.render(); },
  review: startCheckout,
  cobk: () => { S.checkout = null; app.render(); },
  ful: (id) => { S.checkout.fulfilment = id; app.render(); },
  pm: (id) => { S.checkout.mode = id; app.render(); },
  ordtab: (id) => { S.open.ord = id; app.render(); },
  selw: (id) => { S.sel.wid = +id; S.d.catalog = null; app.load(); },
  watch: (id) => {
    const w = watchGet(), i = w.indexOf(+id);
    if (i >= 0) w.splice(i, 1); else w.push(+id);
    watchSet(w); app.render();
  },
  quick: (id) => {
    const p = S.d.catalog.products.find((x) => x.id === +id);
    if (!p) return;
    if (S.cart.wid !== p.shop_id) S.cart = { wid: p.shop_id, items: {} };
    const cur = S.cart.items[p.id] || 0;
    S.cart.items[p.id] = Math.min(p.available, cur ? cur + 1 : Math.max(1, p.moq));
    toast(t('added', { n: p.name, q: S.cart.items[p.id] }), 'ok');
    app.render();
  },
  cart: (id) => {
    const [pid, d] = id.split(':').map(Number), p = S.d.catalog.products.find((x) => x.id === pid);
    if (S.cart.wid !== p.shop_id) S.cart = { wid: p.shop_id, items: {} };
    let q = (S.cart.items[pid] || 0) + d;
    if (d > 0 && q < p.moq) q = p.moq;
    if (q < p.moq) q = 0;
    if (q > p.available) { q = p.available; toast(t('e_stock', { n: p.available }), 'warn'); }
    S.cart.items[pid] = q;
    app.render();
  },
  reorder: async (id) => {
    const o = (S.d.orders || []).find((x) => x.id === +id);
    if (!o) return;
    S.sel.wid = o.wholesaler_shop_id;
    try { S.d.catalog = await api('GET', '/api/r/catalog/' + o.wholesaler_shop_id); } catch (e) { return toast(errText(e), 'warn'); }
    S.cart = { wid: o.wholesaler_shop_id, items: {} };
    let add = 0, skip = 0;
    for (const it of o.items) {
      const p = S.d.catalog.products.find((x) => x.id === it.product_id);
      if (!p || p.status !== 'active' || p.available < Math.max(1, p.moq)) { skip++; continue; }
      S.cart.items[p.id] = Math.min(Math.max(it.qty, p.moq), p.available); add++;
    }
    if (!add) return toast(t('reorder_none'), 'warn');
    S.tab = 'catalog'; startCheckout();
    toast(t('reorder_done', { n: add }) + (skip ? ' ' + t('reorder_skip', { m: skip }) : ''), 'ok');
  },
  place: () => withBusy(async () => {
    const items = Object.entries(S.cart.items).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: +id, qty: q })), co = S.checkout;
    try {
      const o = await api('POST', '/api/r/orders', { shop_id: S.cart.wid, items, fulfilment: co.fulfilment, address: co.fulfilment === 'home' ? (S.form.address || '') : undefined, payment_mode: co.mode, idem_key: co.idem });
      S.cart = { wid: null, items: {} }; S.checkout = null; S.tab = 'orders'; S.open.ord = 'active';
      toast(t('placed', { id: o.no }), 'ok');
      await app.load(true);
    } catch (e) {
      toast(errText(e), 'warn');
      if (e.message === 'insufficient_stock') { S.checkout = null; await app.load(true); }
    }
  }),
  propdec: async (id) => {
    const [oid, decision] = id.split(':');
    if (await attempt(() => api('POST', '/api/r/orders/' + oid + '/proposal', { decision }))) { toast(t(decision === 'accept' ? 'prop_accepted' : 'prop_declined'), decision === 'accept' ? 'ok' : 'bad'); await app.load(true); }
  },
  rcancel: async (id) => { if (await attempt(() => api('POST', '/api/r/orders/' + id + '/cancel', {}))) { toast(t('cancelled'), 'bad'); await app.load(true); } },
  paysubmit: async (id) => {
    const ok = await attempt(() => api('POST', '/api/r/orders/' + id + '/payment', { utr: S.form['utr_' + id] || '', proof: S.form['proof_' + id] || undefined }));
    if (!ok) return;
    delete S.form['utr_' + id]; delete S.form['proof_' + id];
    toast(t('pay_sent'), 'ok'); await app.load(true);
  },
  join: () => withBusy(async () => {
    const r = await attempt(() => api('POST', '/api/r/join', { code: S.form.code || '' }));
    if (!r) return;
    S.form.code = ''; toast(t(r.status === 'approved' ? 'joined' : 'join_pending'), 'ok'); await app.load(true);
  }),
  search: async () => {
    const r = await attempt(() => api('GET', '/api/shops/search?q=' + encodeURIComponent(S.form.q || '')));
    if (r) { S.d.search = r.shops; S.open.searched = true; app.render(); }
  },
  reqaccess: async (id) => {
    if (!(await attempt(() => api('POST', '/api/r/request', { wholesaler_shop_id: +id })))) return;
    toast(t('req_sent'), 'ok');
    S.d.search = (await api('GET', '/api/shops/search?q=' + encodeURIComponent(S.form.q || ''))).shops;
    await app.load(true);
  },
};

// proof-of-payment screenshot picked on an order card
export async function proofPicked(orderId, file) {
  try { S.form['proof_' + orderId] = await shrink(file); } catch (_) { toast(t('e_img'), 'warn'); }
  app.render();
}
