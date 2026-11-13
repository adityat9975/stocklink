'use strict';
// Shared building blocks used by every route: query helper, presenters, order helpers, live-update fan-out, sessions.
const A = require('./auth');
const { fail } = A;
const { tx, audit } = require('./db');

const DAY = 86400000;

const { createPlans } = require('./plans');
function createServices({ db, cfg, secret }) {
  const clients = new Set();
  const q = (sql) => db.q(sql);
  const now = () => Date.now();
  const plans = createPlans((sql) => db.q(sql));
  const isUnique = (e) => !!e && (e.code === '23505' || /UNIQUE constraint/i.test(String(e.message)));

  /* ---------- helpers ---------- */
  async function connApproved(wid, rid) {
    return !!(await q(`SELECT 1 FROM connections c JOIN shops w ON w.id=c.wholesaler_shop_id JOIN users u ON u.id=w.owner_id
      WHERE c.wholesaler_shop_id=? AND c.retailer_shop_id=? AND c.status='approved' AND w.verification='approved' AND u.status='active'`).get(wid, rid));
  }
  function emit(ev) { emitAsync(ev).catch(e => console.error('emit error', e.message)); }
  async function emitAsync(ev) {
    const payload = `event: ${ev.kind}\ndata: ${JSON.stringify(ev.data || {})}\n\n`;
    for (const c of clients) {
      let ok = c.shopId === ev.wid || (ev.rid && c.shopId === ev.rid);
      if (!ok && ev.scope === 'catalog' && c.role === 'retailer') ok = await connApproved(ev.wid, c.shopId);
      if (ok) { try { c.res.write(payload); } catch (_) {} }
    }
  }
  const phoneOf = (v) => {
    if (typeof v !== 'string') fail(400, 'invalid_phone');
    const s = v.replace(/[\s-]/g, '');
    if (!/^\+?[0-9]{8,15}$/.test(s)) fail(400, 'invalid_phone');
    return s;
  };
  const rupeesToPaise = (v) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1000000) fail(400, 'invalid_price');
    return Math.round(n * 100);
  };
  // pack_detail is stored as JSON text: [{label,qty}] for size/variant assortments, else ''
  const parseDetail = (j) => { try { return j ? JSON.parse(j) : []; } catch (_) { return []; } };
  const mediaIds = async (pid) => (await q('SELECT id FROM media WHERE product_id=? ORDER BY sort,id').all(pid)).map(r => r.id);
  async function productOut(p, owner) {
    const o = { id: p.id, shop_id: p.shop_id, name: p.name, spec: p.spec, price_paise: p.price_paise, unit: p.unit, pack_qty: p.pack_qty || 1, pack_detail: parseDetail(p.pack_detail), moq: p.moq,
      category: p.category || '', status: p.status, is_new: !!p.is_new, available: p.on_hand - p.reserved, verified_at: p.stock_verified_at, media: await mediaIds(p.id) };
    if (owner) { o.on_hand = p.on_hand; o.reserved = p.reserved; o.price_b_paise = p.price_b_paise ?? null; o.price_c_paise = p.price_c_paise ?? null; }
    return o;
  }
  /* Stock ledger (blueprint 8.1): call right after the UPDATE that changed on_hand, inside the same transaction. */
  async function logStock(productId, delta, reason, ctx = {}) {
    await q(`INSERT INTO stock_movements(shop_id, product_id, delta, reason, on_hand_after, order_id, actor_user_id, note, ts)
      SELECT shop_id, id, ?, ?, on_hand, ?, ?, ?, ? FROM products WHERE id = ?`).run(delta, reason, ctx.orderId || null, ctx.actorId || null, ctx.note || null, now(), productId);
  }
  /* The price a connected retailer pays: their special price, else their tier's price (B/C), else the list price (A). */
  async function buyerPricing(wid, rid) {
    const cn = await q('SELECT tier FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=?').get(wid, rid);
    const special = new Map((await q('SELECT bp.product_id, bp.price_paise FROM buyer_prices bp JOIN products p ON p.id = bp.product_id WHERE p.shop_id=? AND bp.retailer_shop_id=?').all(wid, rid)).map((r) => [Number(r.product_id), Number(r.price_paise)]));
    const tier = (cn && cn.tier) || 'A';
    return { tier, priceOf: (p) => special.get(Number(p.id)) ?? ((v) => (v === null || v === undefined ? null : Number(v)))(tier === 'B' ? p.price_b_paise : tier === 'C' ? p.price_c_paise : null) ?? Number(p.price_paise),
      rateOf: (p) => (special.has(Number(p.id)) ? 'special' : tier) };
  }
  async function orderOut(o, who) {
    const items = (await q('SELECT product_id,name_snapshot AS name,unit,pack_qty,pack_detail,unit_price_paise,qty FROM order_items WHERE order_id=?').all(o.id)).map((i) => ({ ...i, pack_detail: parseDetail(i.pack_detail) }));
    const history = (await q('SELECT status,note,ts FROM order_history WHERE order_id=? ORDER BY id').all(o.id));
    const r = (await q('SELECT name,city FROM shops WHERE id=?').get(o.retailer_shop_id));
    const w = (await q('SELECT name,city,upi_id FROM shops WHERE id=?').get(o.wholesaler_shop_id));
    const out = { id: o.id, no: o.no, status: o.status, fulfilment: o.fulfilment, address: o.address, payment_mode: o.payment_mode,
      utr: o.utr, has_proof: !!o.proof_mime, subtotal_paise: o.subtotal_paise, created_at: o.created_at, updated_at: o.updated_at,
      cancel_reason: o.cancel_reason, reserve_expires_at: o.reserve_expires_at, wholesaler_shop_id: o.wholesaler_shop_id, retailer_shop_id: o.retailer_shop_id,
      items, history, retailer: r, wholesaler: w };
    const pr = await q("SELECT id,lines,note,created_at FROM order_proposals WHERE order_id=? AND status='pending' ORDER BY id DESC LIMIT 1").get(o.id);
    if (pr && o.status === 'received') {
      const lines = JSON.parse(pr.lines).map((l) => { const it = items.find((i) => Number(i.product_id) === l.product_id) || {}; return { ...l, name: it.name, old_qty: it.qty, old_price_paise: it.unit_price_paise }; });
      out.proposal = { id: pr.id, note: pr.note, created_at: pr.created_at, lines, subtotal_paise: lines.reduce((a, l) => a + l.qty * l.unit_price_paise, 0) };
    }
    if (who === 'retailer') out.pickup_code = o.pickup_code;
    return out;
  }
  async function releaseItems(orderId) {
    for (const it of (await q('SELECT product_id,qty FROM order_items WHERE order_id=?').all(orderId))) {
      const r = (await q('UPDATE products SET reserved=reserved-? WHERE id=? AND reserved>=?').run(it.qty, it.product_id, it.qty));
      if (r.changes !== 1) throw new Error('reservation_mismatch');
    }
  }
  const setStatus = async (o, status, actorId, note) => {
    await q('UPDATE orders SET status=?, updated_at=? WHERE id=?').run(status, now(), o.id);
    await q('INSERT INTO order_history(order_id,status,actor_user_id,note,ts) VALUES(?,?,?,?,?)').run(o.id, status, actorId ?? null, note ?? null, now());
  };
  const emitStockFor = async (orderId) => {
    const o = (await q('SELECT wholesaler_shop_id FROM orders WHERE id=?').get(orderId));
    for (const it of (await q('SELECT product_id FROM order_items WHERE order_id=?').all(orderId))) {
      const p = (await q('SELECT id,on_hand,reserved FROM products WHERE id=?').get(it.product_id));
      emit({ kind: 'stock', wid: o.wholesaler_shop_id, scope: 'catalog', data: { product_id: p.id, available: p.on_hand - p.reserved } });
    }
  };

  /* ---------- sessions ---------- */
  async function startSession(res, user, ctx, opts = {}) {
    const token = A.newToken();
    (await q('INSERT INTO sessions(id,user_id,created_at,expires_at,ip,ua,mfa_ok) VALUES(?,?,?,?,?,?,?)')
      .run(A.sha256(token), user.id, now(), now() + (user.role === 'admin' ? DAY : 7 * DAY), ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200), opts.mfa ? 1 : 0));
    res.setHeader('Set-Cookie', `sl_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${cfg.prod ? '; Secure' : ''}`);
  }
  async function sessionUser(req) {
    const m = /(?:^|;\s*)sl_sid=([A-Za-z0-9_-]{20,64})/.exec(req.headers.cookie || '');
    if (!m) return null;
    const row = (await q(`SELECT u.*, s.id AS session_id, s.active_shop_id, s.mfa_ok FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.status='active'`).get(A.sha256(m[1]), now()));
    // "Last active" for the admin dashboard: written at most once a minute per person.
    if (row && (!row.last_seen_at || now() - row.last_seen_at > 60000)) { row.last_seen_at = now(); try { await q('UPDATE users SET last_seen_at=? WHERE id=?').run(row.last_seen_at, row.id); } catch (_) {} }
    return row || null;
  }


  /* ---------- reservation expiry ---------- */
  async function expireOrders() {
    const rows = (await q(`SELECT id FROM orders WHERE status='received' AND reserve_expires_at IS NOT NULL AND reserve_expires_at<?`).all(now()));
    for (const r of rows) {
      let o;
      try {
        o = await tx(db, async () => {
          const cur = (await q('SELECT * FROM orders WHERE id=? FOR UPDATE').get(r.id));
          if (cur.status !== 'received') return null;
          await releaseItems(cur.id); await setStatus(cur, 'expired', null, 'Reservation expired');
          await audit(db, { actorLabel: 'system', action: 'order_expired', entity: 'order', entityId: cur.id, detail: cur.no });
          return cur;
        });
      } catch (e) { console.error('expire failed', e.message); }
      if (o) { await emitStockFor(o.id); emit({ kind: 'order', wid: o.wholesaler_shop_id, rid: o.retailer_shop_id, data: { order_id: o.id, status: 'expired' } }); }
    }
    return rows.length;
  }
  

  async function cancelOrder(c, o, who, reason) {
    const r = await tx(db, async () => {
      const cur = (await q('SELECT * FROM orders WHERE id=? FOR UPDATE').get(o.id));
      const allowed = who === 'wholesaler' ? ['received', 'paid', 'packed'] : ['received'];
      if (!allowed.includes(cur.status)) fail(409, 'bad_state');
      await releaseItems(cur.id);
      await q('UPDATE orders SET cancel_reason=? WHERE id=?').run(reason, cur.id);
      await setStatus(cur, 'cancelled', c.user.id, reason);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'order_cancelled', entity: 'order', entityId: cur.id, detail: cur.no + ' by ' + who + ': ' + reason, ip: c.ip });
      return (await q('SELECT * FROM orders WHERE id=?').get(cur.id));
    });
    await emitStockFor(r.id); emit({ kind: 'order', wid: r.wholesaler_shop_id, rid: r.retailer_shop_id, data: { order_id: r.id, status: r.status } });
    return r;
  }

  return { logStock, buyerPricing, plans, db, cfg, secret, cancelOrder, q, now, isUnique, clients, DAY, connApproved, emit, phoneOf, rupeesToPaise, mediaIds, productOut, orderOut,
    releaseItems, setStatus, emitStockFor, startSession, sessionUser, expireOrders };
}
module.exports = { createServices, DAY };
