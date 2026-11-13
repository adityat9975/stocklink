// Admin dashboard (live numbers with time filters) and the "Ask" assistant.
import { html } from '../core/html.js';
import { S, app } from '../core/state.js';
import { t, ago, clock } from '../core/format.js';
import { api, toast, errText } from '../core/api.js';
import { chips, empty, loading, icon, btn } from '../ui/components.js';

const RANGES = ['1h', '2h', '6h', '24h', '7d', '30d', '90d', 'all'];
const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const short = (v) => { v = Number(v) || 0; return v >= 1e7 ? '₹' + (v / 1e7).toFixed(1) + ' Cr' : v >= 1e5 ? '₹' + (v / 1e5).toFixed(1) + ' L' : v >= 1e3 ? '₹' + (v / 1e3).toFixed(1) + 'k' : '₹' + Math.round(v); };
const PAY = { upi: 'UPI', credit: 'p_credit', cod: 'd_cash' };

export async function loadDash() {
  S.dashRange = S.dashRange || '24h';
  S.d.dash = await api('GET', '/api/admin/dashboard?range=' + S.dashRange);
}

// Refresh the dashboard every 30 s while it is on screen.
let timer = null;
export function dashTick() {
  clearInterval(timer);
  timer = setInterval(() => { if (S.me && S.me.role === 'admin' && S.tab === 'dash' && !S.modal && !document.hidden) app.load(true); }, 30000);
}

const kpiIn = (label, value, sub) => html`<span class="kl">${label}</span><b>${value}</b>${sub ? html`<span class="ks">${sub}</span>` : ''}`;
const kpi = (label, value, sub = '', cls = '', act = '') => act
  ? html`<button class="kpi link ${cls}" data-act="${act}" data-id="shops">${kpiIn(label, value, sub)}</button>`
  : html`<div class="kpi ${cls}">${kpiIn(label, value, sub)}</div>`;

function bars(series, bucket) {
  if (!series.length) return '';
  const W = 600, Hh = 200, max = Math.max(1, ...series.map((p) => p.v)), bw = W / series.length;
  const lbl = (ts) => bucket >= 86400000 ? new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const ticks = [0, Math.floor(series.length / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return html`<svg class="chart" viewBox="0 0 ${W} ${Hh + 30}" role="img" aria-label="${t('d_chart')}">
    <line x1="0" y1="${Hh}" x2="${W}" y2="${Hh}" class="axis"/>
    ${series.map((p, i) => { const h = p.v ? Math.max(3, (p.v / max) * (Hh - 8)) : 0; return html`<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(Hh - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${lbl(p.t)}: ${p.n} · ${inr(p.v)}</title></rect>`; })}
    ${ticks.map((i) => html`<text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh + 24}" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${lbl(series[i].t)}</text>`)}
  </svg>`;
}

function split(rows, nameOf) {
  const tot = rows.reduce((a, r) => a + r.n, 0) || 1;
  return html`<div class="split">${rows.map((r) => html`<div class="sp-row"><span class="sp-k">${nameOf(r.k)}</span>
    <svg class="sp-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="8" rx="4" class="bg"/><rect width="${Math.max(2, (r.n / tot) * 100).toFixed(1)}" height="8" rx="4"/></svg>
    <span class="sp-v">${r.n} · ${short(r.v)}</span></div>`)}</div>`;
}

const topList = (rows) => rows.length ? html`<ol class="top">${rows.map((r) => html`<li><span class="grow"><b>${r.name}</b><span class="ls"> · ${r.city}</span></span><span class="tv">${r.n} · ${short(r.v)}</span></li>`)}</ol>` : html`<p class="sub">${t('d_none')}</p>`;

export function dashView() {
  const d = S.d.dash;
  const rangeChips = chips('dashrange', S.dashRange || '24h', RANGES.map((r) => ({ id: r, label: t('rg_' + r) })));
  if (!d) return html`<h2>${t('t_dash')}</h2>${rangeChips}${loading()}`;
  const o = d.orders, a = d.active;
  return html`
    <div class="row sp dashhead"><h2>${t('t_dash')}</h2><span class="live on"><i></i><span>${t('d_online', { n: d.online_now })}</span></span></div>
    ${rangeChips}
    <div class="kpis">
      ${kpi(t('d_active'), a.total, t('d_split', { w: a.wholesaler, r: a.retailer }), 'ok')}
      ${kpi(t('d_orders'), o.live, o.cancelled ? t('d_cancelled', { n: o.cancelled }) : '')}
      ${kpi(t('d_value'), short(o.value), t('d_avg', { v: inr(o.avg) }))}
      ${kpi(t('d_signups'), d.signups.total, t('d_split', { w: d.signups.wholesaler, r: d.signups.retailer }))}
      ${kpi(t('d_msgs'), d.messages)}
      ${kpi(t('d_pending'), d.pending_verification, d.pending_verification ? t('d_tap') : '', d.pending_verification ? 'warn' : '', d.pending_verification ? 'tab' : '')}
    </div>
    <div class="card"><div class="row sp"><h3>${t('d_chart')}</h3><span class="ls">${inr(o.value)}</span></div>${bars(d.series, d.bucket)}</div>
    <div class="cols2">
      <div class="card"><h3>${t('d_by_pay')}</h3>${d.by_payment.length ? split(d.by_payment, (k) => (k === 'upi' ? 'UPI' : t(PAY[k] || k))) : html`<p class="sub">${t('d_none')}</p>`}</div>
      <div class="card"><h3>${t('d_by_status')}</h3>${d.by_status.length ? split(d.by_status, (k) => t('s_' + k)) : html`<p class="sub">${t('d_none')}</p>`}</div>
      <div class="card"><h3>${t('d_top_w')}</h3>${topList(d.top_wholesalers)}</div>
      <div class="card"><h3>${t('d_top_r')}</h3>${topList(d.top_retailers)}</div>
    </div>
    <div class="card"><div class="row sp"><h3>${t('d_people')}</h3><span class="ls">${a.total}</span></div>
      ${d.active_list.length ? html`<div class="people">${d.active_list.map((u) => html`<div class="person">
        <span class="pdot ${u.online ? 'on' : ''}" aria-label="${u.online ? t('d_now') : ''}"></span>
        <div class="grow"><b>${u.shop || u.name}</b><div class="ls">${u.name} · ${t('r_' + u.role)}${u.city ? ' · ' + u.city : ''}</div></div>
        <span class="ls">${u.online ? t('d_now') : ago(u.last_seen)}</span></div>`)}</div>` : html`<p class="sub">${t('d_nobody')}</p>`}</div>
    <div class="kpis small">
      ${kpi(t('r_wholesaler') + 's', d.totals.wholesalers)}${kpi(t('r_retailer') + 's', d.totals.retailers)}${kpi(t('d_products'), d.totals.products)}${kpi(t('d_links'), d.totals.links)}
    </div>
    <p class="sub center">${t('d_updated', { t: clock(d.now) })}</p>`;
}

/* ---------------- Ask ---------------- */
const EX = ['Total orders of Rahul Auto Spares in last 4 months', 'Top wholesalers last 30 days', 'Active users in last 2 hours', 'Kal kitne order aaye', 'Top products last 7 days', 'Pending verification'];
const cell = (v) => (v && typeof v === 'object' && v.ts ? clock(v.ts) : v);

function answerView(a) {
  return html`<div class="bubble them ans"><div class="txt">${a.text}</div>
    ${a.table && a.table.rows.length ? html`<div class="tblwrap"><table class="tbl"><thead><tr>${a.table.cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
      <tbody>${a.table.rows.map((r) => html`<tr>${r.map((c) => html`<td>${cell(c)}</td>`)}</tr>`)}</tbody></table></div>` : ''}
    ${a.examples ? html`<div class="quick wrap">${a.examples.map((x) => btn(x, 'askq', x, 'chip'))}</div>` : ''}
    ${a.ms != null ? html`<div class="meta">${t('ask_ms', { n: a.ms })}</div>` : ''}</div>`;
}

export function askView() {
  const thread = S.ask || [];
  return html`<h2>${t('t_ask')}</h2>
    <p class="sub">${t('ask_sub')}</p>
    <div class="thread" id="thread">
      ${thread.length ? thread.map((m) => html`<div class="bubble me"><div class="txt">${m.q}</div></div>${m.a ? answerView(m.a) : html`<div class="bubble them"><div class="txt">…</div></div>`}`)
        : html`<div class="quick wrap">${EX.map((x) => btn(x, 'askq', x, 'chip'))}</div>`}
    </div>
    <div class="composer">
      <textarea id="askmsg" data-f="askmsg" rows="1" maxlength="300" placeholder="${t('ask_ph')}" aria-label="${t('ask_ph')}">${S.form.askmsg || ''}</textarea>
      <button class="btn pri send" data-act="asksend" aria-label="${t('send')}" ${S.busy ? 'disabled' : ''}>${icon('send')}</button>
    </div>`;
}

const scrollDown = () => requestAnimationFrame(() => { const el = document.getElementById('thread'); if (el) el.scrollTop = el.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });

async function ask(text) {
  const qq = (text ?? S.form.askmsg ?? '').trim();
  if (!qq || S.busy) return;
  S.ask = [...(S.ask || []), { q: qq, a: null }].slice(-30);
  if (text == null) S.form.askmsg = '';
  S.busy = true; app.render(); scrollDown();
  try { S.ask[S.ask.length - 1].a = await api('POST', '/api/admin/ask', { q: qq }); }
  catch (e) { S.ask[S.ask.length - 1].a = { text: e.message === 'rate_limited' ? t('chat_slow') : errText(e) }; }
  finally { S.busy = false; app.render(); scrollDown(); }
}

export const insightActions = {
  dashrange: (r) => { S.dashRange = r; S.d.dash = null; app.render(); app.load(true); },
  askq: (x) => ask(x),
  asksend: () => ask(),
};

document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'askmsg' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
});
