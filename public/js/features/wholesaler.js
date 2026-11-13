import { html } from '../core/html.js';
import { S, FINAL, app, can } from '../core/state.js';
import { t, money, ago } from '../core/format.js';
import { api, toast, attempt, $ } from '../core/api.js';
import { withBusy } from '../core/busy.js';
import { shrink } from './images.js';
import { field, btn, seg, hello, hero, quick, weekBars, photoCard, allClear, empty, loading, sectionHead, thumb, stockLine, track, statusBadge, icon, perUnit, sizesLine, qtyTotal, proposalView } from '../ui/components.js';
import { openModal } from '../ui/modals.js';
import { alertCard } from './notes.js';
import { planBanner } from './plans.js';

/* ---------- data ---------- */
export async function loadWholesaler(tab) {
  S.me = Object.assign(S.me, { shop: (await api('GET', '/api/me')).shop });
  if (tab === 'today') { S.d.dash = await api('GET', '/api/w/dashboard').catch(() => null); S.d.orders = (await api('GET', '/api/w/orders')).orders; }
  if (tab === 'retailers') {
    S.d.rconns = (await api('GET', '/api/w/retailers')).connections;
    S.d.invites = (await api('GET', '/api/w/invites')).invites;
  }
  if (tab === 'stock') { S.d.products = (await api('GET', '/api/w/products')).products; S.d.rconns = (await api('GET', '/api/w/retailers')).connections; }
  if (tab === 'orders') S.d.orders = (await api('GET', '/api/w/orders')).orders;
  if (tab !== 'retailers') S.d.pending = (await api('GET', '/api/w/retailers')).connections.filter((x) => x.status === 'pending').length;
}

/* ---------- views ---------- */
export function wholesalerBody() {
  const view = { retailers: retailersView, stock: stockView, orders: ordersView }[S.tab] || todayView;
  return html`${verifyBanner()}${planBanner()}${view()}`;
}

function verifyBanner() {
  const sh = S.me.shop, v = sh && sh.verification;
  if (v === 'approved') return '';
  return html`<div class="banner">${t('ver_' + v)}${sh.reject_reason ? ' ' + sh.reject_reason : ''}</div>`;
}

const compact = (p) => { const v = (Number(p) || 0) / 100; return v >= 1e5 ? '₹' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + 'L' : v >= 1e3 ? '₹' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : '₹' + Math.round(v); };

const PM = { cod: 'h_cash', credit: 'p_credit', upi: 'h_upi_check' };
function collectCard(c) {
  if (!c || !c.total) return '';
  const rows = ['cod', 'credit', 'upi'].filter((k) => c[k].n > 0);
  return html`<button class="card collect link" data-act="tab" data-id="orders">
    <div class="row sp"><h3>${t('h_collect')}</h3>${icon('chevron')}</div>
    <b class="collect-big" data-countup="${c.total}" data-fmt="money">${money(c.total)}</b>
    <div class="collect-rows">${rows.map((k) => html`<div class="cr"><span class="cr-dot ${k}"></span><span class="grow">${t(PM[k])}</span><span class="ls">${t(c[k].n === 1 ? 'h_n_order1' : 'h_n_orders', { n: c[k].n })}</span><b>${money(c[k].v)}</b></div>`)}</div></button>`;
}
function miniOrder(o) {
  const items = o.items.slice(0, 2).map((i) => i.qty + ' × ' + i.name).join(', ') + (o.items.length > 2 ? ' +' + (o.items.length - 2) : '');
  return html`<div class="card mo"><div class="row sp"><div class="grow"><b>${o.no}</b> <span class="sub">· ${o.retailer.name}</span></div>${statusBadge(o)}</div>
    <div class="mo-items">${items}</div>
    <div class="row sp mo-foot"><span class="price">${money(o.subtotal_paise)}</span><span class="ls">${t('pm_' + (o.payment_mode === 'cod' && o.fulfilment === 'pickup' ? 'cash_pickup' : o.payment_mode))} · ${ago(o.created_at)}</span></div>
    <div class="row wrap mo-act">${nextStep(o)}</div></div>`;
}

function todayView() {
  const d = S.d.dash, sh = S.me.shop || {};
  const open = (S.d.orders || []).filter((o) => !FINAL.includes(o.status));
  return html`
    ${hero({
      title: sh.name, sub: longDateShort(),
      bigLabel: t('h_today_sales'), big: d ? money(d.today_value_paise || 0) : '…', bigRaw: d ? d.today_value_paise || 0 : null,
      bigSub: d ? t('h_today_orders', { n: d.today_orders || 0 }) : '',
      stats: d ? [[d.open_orders, t('h_open'), 'tab', 'orders'], [d.retailers ?? '–', t('h_retailers'), 'tab', 'retailers']] : [],
    })}
    ${alertCard()}
    ${quick([can('catalog') ? ['plus', t('qa_add'), 'addform'] : ['box', t('t_stock'), 'tab', 'stock'], ['invite', can('network') ? t('qa_invite') : t('t_retailers'), 'tab', 'retailers'], ['orders', t('t_orders'), 'tab', 'orders'], ['share', t('qa_share'), 'sharestock', '', 'wa']])}
    ${!d ? loading() : html`
      ${d.pending_requests ? html`<button class="card reqbar link" data-act="tab" data-id="retailers"><span class="todo-ic">${icon('invite')}</span><span class="grow"><b>${t(d.pending_requests === 1 ? 'h_req_1' : 'h_req_n', { n: d.pending_requests })}</b><span class="sub">${t('h_req_d')}</span></span>${icon('chevron')}</button>` : ''}
      ${sectionHead(t('h_orders_now'), open.length ? btn(t('h_see_all'), 'tab', 'orders', 'ghost sm') : '')}
      ${open.length ? open.slice(0, 3).map(miniOrder) : allClear(t('h_no_open'))}
      ${collectCard(d.collect)}
      ${d.low_items.length ? html`${sectionHead(t('w_low'), btn(t('h_see_all'), 'tab', 'stock', 'ghost sm'))}
        <div class="prow">${d.low_items.map((i) => photoCard(i, { tag: i.available <= 0 ? t('out') : t('h_left', { n: i.available }), tagCls: i.available <= 0 ? 'out' : '', action: btn('+10 ' + t('h_stock'), 'stock', i.id + ':10', 'pri sm') }))}</div>` : ''}
      ${d.top_products && d.top_products.length ? html`${sectionHead(t('h_top_products'))}
        <div class="prow">${d.top_products.map((p) => photoCard(p, { tag: t('h_sold', { n: p.qty }), tagCls: 'hot', action: html`<div class="ls">${money(p.v)}</div>` }))}</div>` : ''}
      ${d.top_retailers && d.top_retailers.length ? html`${sectionHead(t('h_top_retailers'))}
        <div class="list">${d.top_retailers.map((r, i) => html`<div class="item tr"><span class="rank r${i + 1}">${i + 1}</span><div class="grow"><div class="nm">${r.name}</div><div class="ls">${r.city} · ${t(r.n === 1 ? 'h_n_order1' : 'h_n_orders', { n: r.n })}</div></div><b>${money(r.v)}</b></div>`)}</div>` : ''}`}`;
}
const longDateShort = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

function retailersView() {
  const cs = S.d.rconns || [], inv = S.d.invites || [];
  const pending = cs.filter((c) => c.status === 'pending'), rest = cs.filter((c) => c.status !== 'pending');
  return html`
    <h2>${t('t_retailers')}</h2>
    ${sectionHead(t('new_req'))}
    ${pending.length ? pending.map((c) => html`<div class="card"><div class="nm">${c.name}</div>
      <p class="sub">${c.city} · ${t(c.source === 'invite_code' ? 'via_code' : 'via_req')} · ${ago(c.requested_at)}</p>
      <div class="row">${btn(t('approve'), 'conn', c.id + ':approve', 'pri sm')}${btn(t('decline'), 'conn', c.id + ':decline', 'danger sm')}</div></div>`) : empty(t('no_req'))}
    <div class="card"><h3>${t('invite_h')}</h3><p class="sub">${t('invite_d')}</p>
      ${btn(t('gen_code'), 'newinvite', '', 'pri')}
      <details class="more"><summary>${t('more')}</summary>
        <p class="sub">${t('single_use_d')}</p>
        <div class="row">${field('idays', t('valid_days'), { type: 'number', min: 1, max: 30, placeholder: '7' })}</div>
        <label class="row sub"><input type="checkbox" id="iauto" ${S.form.iauto ? 'checked' : ''}> ${t('auto')}</label></details>
      ${inv.map((i) => html`<div class="row sp"><div class="mono">••••-••${i.hint}</div><span class="sub">${i.max_uses === 1 ? t(i.uses ? 'code_used' : 'code_unused') : t('uses', { u: i.uses, m: i.max_uses })}${i.auto_approve ? ' · ' + t('auto_short') : ''}</span>
        ${i.active ? btn(t('revoke_code'), 'revinvite', i.id, 'danger sm') : html`<span class="badge mute">${t('inactive')}</span>`}</div>`)}</div>
    ${sectionHead(t('connected_h'))}
    ${rest.length ? html`<div class="list">${rest.map(connectedRow)}</div>` : empty('–')}`;
}

function connectedRow(c) {
  const ok = c.status === 'approved';
  return html`<div class="entry"><div class="item"><div class="grow"><div class="nm">${c.name}</div><div class="ls">${c.city}${c.phone ? ' · ' + c.phone : ''}</div></div>
    ${ok ? html`<span class="badge acc">${t('rate_x', { r: c.tier || 'A' })}</span>` : ''}<span class="badge ${ok ? 'good' : 'bad'}">${t('cs_' + c.status)}</span></div>
    <details class="more"><summary>${t('more')}</summary><div class="chips">
      ${ok && can('catalog') ? html`<span class="sub">${t('rate_pick')}</span>${['A', 'B', 'C'].map((r) => btn(t('rate_x', { r }), 'conn', c.id + ':tier:' + r, (c.tier || 'A') === r ? 'pri sm' : 'sm', { 'aria-pressed': (c.tier || 'A') === r ? 'true' : 'false' }))}` : ''}
      ${ok ? html`${btn(t(c.credit_allowed ? 'credit_off' : 'credit_on'), 'conn', c.id + ':credit:' + (c.credit_allowed ? 0 : 1), 'sm')}${btn(t('revoke'), 'conn', c.id + ':revoke', 'danger sm')}` : ''}
      ${c.status === 'revoked' || c.status === 'rejected' ? btn(t('approve'), 'conn', c.id + ':approve', 'pri sm') : ''}
      ${c.status !== 'blocked' ? btn(t('block'), 'conn', c.id + ':block', 'danger sm') : ''}</div></details></div>`;
}

function stockView() {
  const ps = S.d.products;
  if (!ps) return loading();
  return html`<div class="row sp"><h2>${t('t_stock')}</h2>${can('catalog') ? btn(t('add_product'), 'addform', '', 'pri sm') : ''}</div>
    ${ps.length ? html`<div class="list">${ps.map(stockRow)}</div>` : empty(t('no_products'))}`;
}

function stockRow(p) {
  return html`<div class="entry"><div class="item">${thumb(p)}
    <div class="grow"><div class="nm">${p.name}</div>${p.category ? html`<span class="badge acc">${p.category}</span>` : ''}<div class="ls">${money(p.price_paise)} / ${perUnit(p)} · ${p.reserved} ${t('res')}</div>${p.pack_detail.length ? html`<div class="ls sizes">${sizesLine(p.pack_detail)}</div>` : ''}<div class="ls">${stockLine(p, false)}</div></div>
    <div class="stepper"><button data-act="stock" data-id="${p.id}:-1" aria-label="${t('adj_m')}">−1</button><b>${p.on_hand}</b><button data-act="stock" data-id="${p.id}:10" aria-label="${t('adj_p')}">+10</button></div></div>
    <details class="more"><summary>${t('more')}</summary>
      <p class="sub">${t('ver', { t: ago(p.verified_at) })}</p>
      <div class="chips">${btn(t(p.status === 'paused' ? 'resume' : 'pause'), 'pst', p.id + ':' + (p.status === 'paused' ? 'active' : 'paused'), 'sm')}${btn(t('markv'), 'markv', p.id, 'sm')}${btn(t('add_more_photos'), 'addphoto', p.id, 'sm')}${btn(t('archive'), 'pst', p.id + ':archived', 'danger sm')}</div>
      <div class="row wrap">${field('set_' + p.id, t('set_count'), { type: 'number', min: 0 })}${field('price_' + p.id, t('set_price'), { type: 'number', min: 0, step: '0.01' })}</div>
      <div class="chips">${btn(t('set_count_btn'), 'setstock', p.id, 'sm')}${btn(t('set_price_btn'), 'setprice', p.id, 'sm')}</div>
      <h4 class="mini">${t('rates_h')}</h4><p class="sub">${t('rates_d', { a: money(p.price_paise) })}</p>
      <div class="row wrap">${field('pb_' + p.id, t('rate_x', { r: 'B' }) + ' (₹)', { type: 'number', min: 0, step: '0.01', placeholder: p.price_b_paise ? String(p.price_b_paise / 100) : '–' })}${field('pc2_' + p.id, t('rate_x', { r: 'C' }) + ' (₹)', { type: 'number', min: 0, step: '0.01', placeholder: p.price_c_paise ? String(p.price_c_paise / 100) : '–' })}</div>
      <div class="chips">${btn(t('rates_save'), 'setrates', p.id, 'sm')}${p.price_b_paise || p.price_c_paise ? btn(t('rates_clear'), 'clrrates', p.id, 'ghost sm') : ''}</div>
      ${specialBox(p)}
      <div class="row wrap">${field('cat_' + p.id, t('add_cat'), { maxlength: 30, placeholder: p.category || t('cat_ph') })}</div>
      <div class="chips">${btn(t('set_cat_btn'), 'setcat', p.id, 'sm')}</div></details></div>`;
}

// One retailer, one product, one price (beats their rate). Empty price removes it.
function specialBox(p) {
  const rs = (S.d.rconns || []).filter((c) => c.status === 'approved');
  if (!rs.length) return '';
  const cur = S.form['spr_' + p.id] || '';
  return html`<h4 class="mini">${t('sp_h')}</h4>
    <div class="row wrap"><div class="field"><label for="spr_${p.id}">${t('sp_who')}</label><select id="spr_${p.id}" data-f="spr_${p.id}"><option value="">–</option>${rs.map((c) => html`<option value="${c.retailer_shop_id}" ${String(c.retailer_shop_id) === cur ? 'selected' : ''}>${c.name}</option>`)}</select></div>
    ${field('spp_' + p.id, t('sp_price'), { type: 'number', min: 0, step: '0.01', placeholder: t('sp_ph') })}</div>
    <div class="chips">${btn(t('sp_save'), 'setspecial', p.id, 'sm')}</div>`;
}

function nextStep(o) {
  if (o.proposal) return html`<span class="badge warn">${t('prop_wait')}</span>`;
  if (o.status === 'received') {
    if (o.payment_mode === 'upi' && !o.utr) return html`<span class="sub">${t('wait_utr')}</span>`;
    return btn(t(o.payment_mode === 'upi' ? 'nx_upi' : o.payment_mode === 'credit' ? 'nx_credit' : 'nx_cod'), 'adv', o.id, 'pri sm');
  }
  if (o.status === 'paid') return btn(t('nx_pack'), 'adv', o.id, 'pri sm');
  if (o.status === 'packed') return btn(t(o.fulfilment === 'pickup' ? 'nx_ready' : 'nx_disp'), 'adv', o.id, 'pri sm');
  if (o.status === 'dispatched') {
    const done = btn(t('nx_done'), 'adv', o.id, 'pri sm');
    return o.fulfilment === 'pickup' ? html`<div class="row grow">${field('pc_' + o.id, t('pickup_code'), { cls: 'code', maxlength: 8, autocomplete: 'off' })}${done}</div>` : done;
  }
  return '';
}

function ordersView() {
  const all = S.d.orders;
  if (!all) return loading();
  const tab = S.open.ord || 'active', list = all.filter((o) => (tab === 'active') === !FINAL.includes(o.status));
  return html`<h2>${t('t_orders')}</h2>
    ${seg('ordtab', tab, [{ id: 'active', label: t('ord_active') }, { id: 'past', label: t('ord_past') }])}
    ${list.length ? list.map(orderCard) : empty(t(tab === 'active' ? 'ord_none_active' : 'ord_none_past'))}`;
}

function orderCard(o) {
  const canCancel = ['received', 'paid', 'packed'].includes(o.status);
  return html`<div class="card order">
    <div class="row sp"><div><b>${o.no}</b> <span class="sub">· ${o.retailer.name}</span></div>${statusBadge(o)}</div>
    ${o.items.map((x) => html`<div class="sub">${x.qty} × ${x.name}${x.pack_qty > 1 ? html`<br>${qtyTotal(x, x.qty)}${x.pack_detail.length ? ' · ' + sizesLine(x.pack_detail, x.qty) : ''}` : ''}</div>`)}
    ${track(o)}
    <div class="row sp"><span class="sub">${t(o.fulfilment === 'home' ? 'home' : 'pickup')} · ${t(o.payment_mode === 'cod' && o.fulfilment === 'pickup' ? 'pm_cash_pickup' : 'pm_' + o.payment_mode)}</span><span class="price">${money(o.subtotal_paise)}</span></div>
    ${o.address ? html`<div class="sub">${o.address}</div>` : ''}
    ${proposalView(o)}${o.status === 'received' && !o.proposal && can('orders') ? proposeEditor(o) : ''}
    ${o.utr ? html`<div class="sub">${t('utr')}: <span class="mono">${o.utr}</span>${o.has_proof ? html` · <a href="/api/orders/${o.id}/proof" target="_blank" rel="noopener">${t('view_proof')}</a>` : ''}</div>` : ''}
    <div class="row wrap">${nextStep(o)}${btn(t('msg_btn'), 'chatorder', o.retailer_shop_id + ':' + o.id, 'ghost sm')}${canCancel ? btn(t('cancel_order'), 'wcancel', o.id, 'ghost danger sm') : ''}</div></div>`;
}

function proposeEditor(o) {
  if (!S.open['prop_' + o.id]) return html`<div class="chips">${btn(t('prop_open'), 'propopen', o.id, 'ghost sm')}</div>`;
  return html`<div class="note"><h3>${t('prop_open')}</h3><p class="sub">${t('prop_d')}</p>
    ${o.items.map((i) => html`<div class="sub"><b>${i.name}</b></div><div class="row wrap">${field('pq_' + o.id + '_' + i.product_id, t('item_qty'), { type: 'number', min: 0, placeholder: String(i.qty) })}${field('pp_' + o.id + '_' + i.product_id, t('sp_price'), { type: 'number', min: 0, step: '0.01', placeholder: String(i.unit_price_paise / 100) })}</div>`)}
    ${field('pn_' + o.id, t('prop_note'), { maxlength: 300 })}
    <div class="chips">${btn(t('prop_send'), 'propsend', o.id, 'pri sm')}${btn(t('btn_close'), 'propopen', o.id, 'ghost sm')}</div></div>`;
}

/* ---------- actions ---------- */
const reload = () => app.load(true);
const post = (url, body) => attempt(() => api('POST', url, body));

export const wholesalerActions = {
  ordtab: (id) => { S.open.ord = id; app.render(); },
  punit: (id) => { S.form.punit = id; app.render(); },
  pmode: (id) => { S.form.pmode = id; if (id === 'sizes' && !(S.form.psizes || []).length) S.form.psizes = [{ label: '', qty: '' }]; app.render(); },
  sizeadd: (id) => { (S.form.psizes = S.form.psizes || []).push({ label: id, qty: '' }); app.render(); },
  sizerm: (id) => { S.form.psizes.splice(+id, 1); app.render(); },
  saveopts: async (k) => {
    const sh = S.me.shop, cur = { allow_cash: sh.allow_cash !== 0 && sh.allow_cash !== false, allow_home: sh.allow_home !== 0 && sh.allow_home !== false };
    cur[k] = !cur[k];
    if (await post('/api/w/options', cur)) { sh.allow_cash = cur.allow_cash ? 1 : 0; sh.allow_home = cur.allow_home ? 1 : 0; toast(t('saved'), 'ok'); app.render(); }
  },
  saveupi: async () => { if (await post('/api/w/profile', { upi_id: S.form.upi_id || '' })) { S.form.upi_id = ''; toast(t('saved'), 'ok'); await reload(); } },
  conn: async (id) => {
    const [cid, action, v] = id.split(':');
    const body = action === 'credit' ? { action, allowed: v === '1' } : action === 'tier' ? { action, tier: v } : { action };
    if (await post('/api/w/connections/' + cid, body)) { if (action === 'tier') toast(t('saved'), 'ok'); await reload(); }
  },
  newinvite: async () => {
    const r = await post('/api/w/invites', { days: +(S.form.idays || 7), auto_approve: $('#iauto') ? $('#iauto').checked : false });
    if (!r) return;
    await reload(); openModal({ type: 'code', code: r.code });
  },
  revinvite: async (id) => { if (await post('/api/w/invites/' + id + '/revoke', {})) await reload(); },
  stock: async (id) => {
    const [pid, d] = id.split(':');
    if (await post('/api/w/products/' + pid + '/stock', { delta: +d, reason: +d < 0 ? 'counter sale' : 'restock' })) await reload();
  },
  setstock: async (id) => {
    const v = S.form['set_' + id];
    if (await post('/api/w/products/' + id + '/stock', { set: v === undefined || v === '' ? NaN : Number(v), reason: 'stock count' })) { delete S.form['set_' + id]; await reload(); }
  },
  setcat: async (id) => {
    if (await post('/api/w/products/' + id + '/update', { category: (S.form['cat_' + id] || '').trim() })) { delete S.form['cat_' + id]; toast(t('saved'), 'ok'); await reload(); }
  },
  setprice: async (id) => {
    if (await post('/api/w/products/' + id + '/update', { price: Number(S.form['price_' + id]) })) { delete S.form['price_' + id]; toast(t('saved'), 'ok'); await reload(); }
  },
  setrates: async (id) => {
    const b = {}, vb = S.form['pb_' + id], vc = S.form['pc2_' + id];
    if (vb !== undefined && vb !== '') b.price_b = Number(vb);
    if (vc !== undefined && vc !== '') b.price_c = Number(vc);
    if (!Object.keys(b).length) return toast(t('need'), 'warn');
    if (await post('/api/w/products/' + id + '/update', b)) { delete S.form['pb_' + id]; delete S.form['pc2_' + id]; toast(t('saved'), 'ok'); await reload(); }
  },
  clrrates: async (id) => { if (await post('/api/w/products/' + id + '/update', { price_b: null, price_c: null })) { toast(t('saved'), 'ok'); await reload(); } },
  setspecial: async (id) => {
    const rid = Number(S.form['spr_' + id]), v = S.form['spp_' + id];
    if (!rid) return toast(t('sp_need'), 'warn');
    if (await post('/api/w/products/' + id + '/buyer-price', { retailer_shop_id: rid, price: v === undefined || v === '' ? null : Number(v) })) {
      toast(t(v === undefined || v === '' ? 'sp_removed' : 'saved'), 'ok'); delete S.form['spp_' + id];
    }
  },
  propopen: (id) => { S.open['prop_' + id] = !S.open['prop_' + id]; app.render(); },
  propsend: async (id) => {
    const o = (S.d.orders || []).find((x) => String(x.id) === String(id));
    if (!o) return;
    const num = (k) => (S.form[k] === undefined || S.form[k] === '' ? undefined : Number(S.form[k]));
    const lines = o.items.map((i) => {
      const qn = num('pq_' + id + '_' + i.product_id), pr = num('pp_' + id + '_' + i.product_id);
      return { product_id: i.product_id, qty: qn === undefined ? i.qty : qn, ...(pr === undefined ? {} : { price: pr }) };
    });
    if (await post('/api/w/orders/' + id + '/propose', { lines, note: S.form['pn_' + id] || undefined })) {
      for (const k of Object.keys(S.form)) if (k.startsWith('pq_' + id + '_') || k.startsWith('pp_' + id + '_') || k === 'pn_' + id) delete S.form[k];
      S.open['prop_' + id] = false; toast(t('prop_sent'), 'ok'); await reload();
    }
  },
  pst: async (id) => { const [pid, st] = id.split(':'); if (await post('/api/w/products/' + pid + '/status', { status: st })) await reload(); },
  markv: async (id) => { if (await post('/api/w/products/' + id + '/verify', {})) await reload(); },
  addphoto: (id) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
    i.onchange = async () => {
      const arr = [];
      for (const f of [...i.files].slice(0, 4)) { try { arr.push(await shrink(f)); } catch (_) { /* skip unreadable file */ } }
      if (arr.length && await post('/api/w/products/' + id + '/photos', { photos: arr })) { toast(t('saved'), 'ok'); await reload(); }
    };
    i.click();
  },
  addp: () => withBusy(async () => {
    const f = S.form;
    if (!f.pname || !f.pprice || f.pstock === undefined || f.pstock === '') return toast(t('need'), 'warn');
    const unit = f.punit || 'pc', sizes = unit !== 'pc' && f.pmode === 'sizes';
    const rows = (f.psizes || []).filter((r) => r.label.trim() && Number(r.qty) > 0).map((r) => ({ label: r.label.trim(), qty: Number(r.qty) }));
    if (sizes && !rows.length) return toast(t('need_sizes'), 'warn');
    const pack = unit === 'pc' ? {} : sizes ? { pack_detail: rows } : { pack_qty: Number(f.ppack || 1) };
    const ok = await post('/api/w/products', { name: f.pname, spec: f.pspec || '', category: (f.pcat || '').trim(), price: Number(f.pprice), on_hand: Number(f.pstock), moq: f.pmoq ? Number(f.pmoq) : 1, unit, ...pack, photos: f.photos || [] });
    if (!ok) return;
    for (const k of ['pcat', 'pname', 'pspec', 'pprice', 'pstock', 'pmoq', 'punit', 'ppack', 'pmode', 'psizes']) delete f[k];
    f.photos = []; S.modal = null; toast(t('published'), 'ok'); await reload();
  }),
  adv: async (id) => {
    if (await post('/api/w/orders/' + id + '/advance', { pickup_code: S.form['pc_' + id] || undefined })) { delete S.form['pc_' + id]; await reload(); }
  },
  wcancel: async (id) => { if (await post('/api/w/orders/' + id + '/cancel', { reason: 'Cancelled by wholesaler' })) { toast(t('cancelled'), 'bad'); await reload(); } },
  sharestock: async () => {
    const r = await attempt(() => api('GET', '/api/w/products'));
    if (!r) return;
    const lines = r.products.filter((p) => p.status === 'active' && p.on_hand - p.reserved > 0)
      .map((p) => '• ' + p.name + ' — ' + (p.on_hand - p.reserved <= 5 ? t('wa_low') : t('wa_in')));
    const msg = t('wa_stock_head', { shop: S.me.shop.name, d: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }) + '\n' + lines.join('\n') + '\n\n' + t('wa_stock_tail', { url: location.origin });
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  },
};

// photos picked in the "add product" sheet
export async function productPhotosPicked(files) {
  S.form.photos = S.form.photos || [];
  for (const f of files) {
    if (S.form.photos.length >= 4) { toast(t('e_photos'), 'warn'); break; }
    try { S.form.photos.push(await shrink(f)); } catch (_) { toast(t('e_img'), 'warn'); }
  }
  app.render();
}
