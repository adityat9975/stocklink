import { html, attrs } from '../core/html.js';
import { S, FLOW } from '../core/state.js';
import { t, ago, longDate, firstName, money } from '../core/format.js';

const ICON = {
  plans: 'M3 7h18v13H3zM3 7l3-4h12l3 4M8 12h8M8 16h5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  rupee: 'M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10',
  trend: 'M3 17l6-6 4 4 8-8M14 7h7v7',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  ask: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  catalog: 'M16.5 9.4 7.5 4.21M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  orders: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9zM9 12h6M9 16h6',
  wholesalers: 'M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 21V12M19 21V12M3 21h18',
  today: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  retailers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  stock: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  shops: 'M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 21V12M19 21V12M3 21h18',
  audit: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  stats: 'M12 20V10M18 20V4M6 20v-4',
  check: 'M20 6L9 17l-5-5',
  chevron: 'M9 6l6 6-6 6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
};
export const icon = (k) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k] || ''}"/></svg>`;

// "Pack of 12 pcs" label for how a product is sold, "3 × Pack = 36 pcs" for a quantity, "L 18 · XL 18" for sizes
export const unitName = (u) => { const k = t('u_' + u); return k === 'u_' + u ? u : k; };
export const perUnit = (p) => unitName(p.unit) + (p.pack_qty > 1 ? ' ' + t('of_pcs', { n: p.pack_qty }) : '');
export const sizesLine = (detail, mult = 1) => (detail || []).map((d) => d.label + ' ' + d.qty * mult).join(' · ');
export const qtyTotal = (it, q) => (it.pack_qty > 1 ? t('qty_total', { q, u: unitName(it.unit), n: q * it.pack_qty }) : '');

export const yn = (b) => (b ? 'true' : 'false');

// <input> bound to S.form[id] (see the global "input" listener in main.js)
export function field(id, label, o = {}) {
  const { type = 'text', cls = '', ...rest } = o;
  return html`<div class="field"><label for="${id}">${label}</label><input id="${id}" data-f="${id}" type="${type}" class="${cls}" value="${S.form[id] ?? ''}" ${attrs(rest)}></div>`;
}

// Password box with an eye button that shows / hides what was typed.
export function pwfield(id, label, o = {}) {
  const show = !!(S.showPw && S.showPw[id]);
  return html`<div class="field"><label for="${id}">${label}</label><div class="pwwrap">
    <input id="${id}" data-f="${id}" type="${show ? 'text' : 'password'}" value="${S.form[id] ?? ''}" autocapitalize="off" autocorrect="off" spellcheck="false" ${attrs(o)}>
    <button type="button" class="pweye" data-act="pwtoggle" data-id="${id}" aria-label="${t(show ? 'hide_pw' : 'show_pw')}" aria-pressed="${show ? 'true' : 'false'}" aria-controls="${id}">${icon(show ? 'eyeoff' : 'eye')}</button>
  </div></div>`;
}

export const btn = (label, act, id = '', cls = '', extra = {}) =>
  html`<button class="btn ${cls}" data-act="${act}" data-id="${id}" ${attrs(extra)}>${label}</button>`;

// segmented control: items = [{ id, label, disabled? }]
export const seg = (act, cur, items) =>
  html`<div class="seg" role="group">${items.map((i) => html`<button type="button" data-act="${act}" data-id="${i.id}" aria-pressed="${yn(i.id === cur)}" ${attrs({ disabled: !!i.disabled })}>${i.label}</button>`)}</div>`;

export const chips = (act, cur, items) =>
  html`<div class="chips">${items.map((i) => html`<button class="chip" data-act="${act}" data-id="${i.id}" aria-pressed="${yn(i.id === cur)}">${i.label}</button>`)}</div>`;

export const hello = () =>
  html`<div class="hello"><h1>${t('hi', { n: firstName() })}</h1><p>${longDate()}</p></div>`;

// Home screen pieces: blue hero card with key numbers, and a row of quick-action tiles.
const greet = () => { const h = new Date().getHours(); return t(h < 12 ? 'gm' : h < 17 ? 'ga' : 'ge'); };
export const hero = ({ title, sub, bigLabel, big, bigRaw, bigSub, stats = [] }) => html`<section class="hcard">
  <div class="hero-top"><div><p class="hero-hi">${greet()}, ${firstName()}</p><p class="hero-sub">${sub || longDate()}</p></div>${title ? html`<span class="hero-tag">${title}</span>` : ''}</div>
  <div class="hero-big"><span>${bigLabel}</span><b ${bigRaw != null ? html`data-countup="${bigRaw}" data-fmt="money"` : ''}>${big}</b>${bigSub ? html`<span class="hero-bs">${bigSub}</span>` : ''}</div>
  ${stats.length ? html`<div class="hero-stats">${stats.map(([v, l, act, id]) => act
    ? html`<button class="hs" data-act="${act}" data-id="${id || ''}"><b data-countup="${Number(v) || 0}">${v}</b><span>${l}</span></button>`
    : html`<div class="hs"><b>${v}</b><span>${l}</span></div>`)}</div>` : ''}
</section>`;
export const quick = (items) => html`<div class="qa">${items.map(([ic, label, act, id, cls]) => html`<button class="qa-i ${cls || ''}" data-act="${act}" data-id="${id || ''}"><span class="qa-ic">${icon(ic)}</span><span>${label}</span></button>`)}</div>`;
export const weekBars = (week, fmt) => {
  if (!week || !week.length) return '';
  const W = 700, Hh = 150, max = Math.max(1, ...week.map((d) => d.v)), bw = W / week.length;
  const day = (ts) => new Date(ts).toLocaleDateString('en-IN', { weekday: 'short' });
  return html`<svg class="wk" viewBox="0 0 ${W} ${Hh + 70}" role="img" aria-label="${t('h_week')}">
    ${week.map((d, i) => { const h = d.v ? Math.max(6, (d.v / max) * Hh) : 4; const last = i === week.length - 1; return html`
      <rect x="${(i * bw + bw * .2).toFixed(1)}" y="${(Hh - h + 22).toFixed(1)}" width="${(bw * .6).toFixed(1)}" height="${h.toFixed(1)}" rx="10" class="${last ? 'now' : d.v ? '' : 'zero'}"><title>${day(d.t)}: ${fmt(d.v)}</title></rect>
      ${d.v ? html`<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(Hh - h + 14).toFixed(1)}" text-anchor="middle" class="val">${fmt(d.v)}</text>` : ''}
      <text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh + 56}" text-anchor="middle" class="${last ? 'dnow' : ''}">${last ? t('h_tday') : day(d.t)}</text>`; })}
  </svg>`;
};

// Product photo card for horizontal rows on the home screens.
export const photoCard = (p, { tag = '', tagCls = '', action = '' } = {}) => {
  const mid = (p.media && p.media[0]) || p.media_id;
  return html`<div class="pc"><div class="pc-img">${mid ? html`<img alt="" loading="lazy" src="/api/media/${mid}">` : icon('box')}${tag ? html`<span class="pc-tag ${tagCls}">${tag}</span>` : ''}</div>
    <div class="pc-b"><div class="pc-n">${p.name}</div>${p.price_paise ? html`<div class="pc-p">${money(p.price_paise)}</div>` : ''}${action}</div></div>`;
};

export const allClear = (msg) => html`<div class="allclear">${icon('check')}<span>${msg}</span></div>`;
export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export const loading = () => empty('…');
export const sectionHead = (title, right = '') => html`<div class="sec"><h3>${title}</h3>${right}</div>`;

export const noImg = () =>
  html`<div class="noimg" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="17" cy="17" r="3" fill="currentColor"/></svg></div>`;
export const thumb = (p) =>
  p.media && p.media.length ? html`<img class="thumb" alt="" loading="lazy" src="/api/media/${p.media[0]}">` : noImg();

// one line describing availability + freshness
export function stockLine(p, withAge = true) {
  if (p.status === 'paused') return html`<span class="st mute">${t('paused')}</span>`;
  const age = withAge ? html`<span class="age"> · ${ago(p.verified_at)}</span>` : '';
  if (p.available <= 0) return html`<span class="st bad">${t('out')}</span>${age}`;
  if (p.available <= 5) return html`<span class="st warn">${t('only_left', { n: p.available })}</span>${age}`;
  return html`<span class="st good">${t('in_stock')} · ${p.available}</span>${age}`;
}

export const track = (o) => {
  const dead = o.status === 'cancelled' || o.status === 'expired', at = FLOW.indexOf(o.status);
  return html`<div class="track${dead ? ' x' : ''}">${FLOW.map((_, i) => html`<i class="${dead || i <= at ? 'on' : ''}"></i>`)}</div>`;
};
export const stLabel = (o) => t(o.status === 'dispatched' && o.fulfilment === 'pickup' ? 's_ready' : 's_' + o.status);
export const stClass = (o) => (o.status === 'cancelled' || o.status === 'expired' ? 'bad' : o.status === 'completed' ? 'good' : 'acc');
export const statusBadge = (o) => html`<span class="badge ${stClass(o)}">${stLabel(o)}</span>`;

// Changes the seller proposed for an order (shown to both sides).
export function proposalView(o) {
  const p = o.proposal;
  if (!p) return '';
  return html`<div class="note prop"><h3>${t('prop_h')}</h3>
    ${p.lines.map((l) => html`<div class="sub">${l.name}: ${l.old_qty} → <b>${l.qty}</b>${l.unit_price_paise !== l.old_price_paise ? html` · ${money(l.old_price_paise)} → <b>${money(l.unit_price_paise)}</b>` : ''}</div>`)}
    <div class="row sp"><span class="sub">${t('prop_new_total')}</span><span class="price">${money(p.subtotal_paise)}</span></div>
    ${p.note ? html`<p class="sub">“${p.note}”</p>` : ''}</div>`;
}

