'use strict';
// Retailer: join, catalog, orders, payments.
const A = require('../lib/auth');
const { tx, audit } = require('../lib/db');
const { fail } = require('../lib/auth');

module.exports = function registerRetailer(ctx, route) {
  const { buyerPricing, plans, db, q, cancelOrder, now, secret, isUnique, connApproved, emit, productOut, orderOut, emitStockFor, DAY, notify } = ctx;
  /* ----- retailer ----- */
  route('GET', '/api/shops/search', 'retailer', async (c) => {
    const term = String(c.query.get('q') || '').trim().slice(0, 40).replace(/[\\%_]/g, m => '\\' + m);
    if (term.length < 2) return { shops: [] };
    const like = '%' + term + '%';
    return { shops: (await q(`SELECT s.id,s.name,s.city,(SELECT status FROM connections WHERE wholesaler_shop_id=s.id AND retailer_shop_id=?) conn
      FROM shops s JOIN users u ON u.id=s.owner_id WHERE s.type='wholesaler' AND s.verification='approved' AND u.status='active'
      AND (LOWER(s.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.city) LIKE LOWER(?) ESCAPE '\\') ORDER BY s.name LIMIT 20`).all(c.shop.id, like, like)) };
  });
  // Each supplier carries whether its catalogue is open (its plan may have expired or been suspended).
  const withState = async (rows) => Promise.all(rows.map(async (r) => ({ ...r, supplier_active: (await plans.access(r.shop_id)).can_sell })));
  route('GET', '/api/r/wholesalers', 'retailer', async (c) => ({ connections: await withState((await q(`
    SELECT c.id,c.status,c.credit_allowed,s.id shop_id,s.name,s.city,s.verification,
      CASE WHEN c.status='approved' THEN s.upi_id END upi_id
    FROM connections c JOIN shops s ON s.id=c.wholesaler_shop_id WHERE c.retailer_shop_id=? ORDER BY c.requested_at DESC`).all(c.shop.id))) }));
  route('POST', '/api/r/join', 'retailer', async (c) => {
    const uid = c.user.id, since = now() - 3600000;
    const failsUser = (await q('SELECT COUNT(*) n FROM code_attempts WHERE user_id=? AND ok=0 AND ts>?').get(uid, since)).n;
    const failsIp = (await q('SELECT COUNT(*) n FROM code_attempts WHERE ip=? AND ok=0 AND ts>?').get(c.ip, since)).n;
    if (failsUser >= 5 || failsIp >= 20) fail(429, 'too_many_attempts');
    const code = typeof c.body.code === 'string' ? c.body.code.slice(0, 20) : '';
    const bad = async () => {
      await q('INSERT INTO code_attempts(user_id,ip,ok,ts) VALUES(?,?,0,?)').run(uid, c.ip, now());
      await audit(db, { actorId: uid, actorLabel: c.user.name, action: 'invite_failed', entity: 'invite', ip: c.ip });
      fail(400, 'invalid_code');
    };
    if (A.normCode(code).length !== 8) await bad();
    const out = await tx(db, async () => {
      const inv = (await q(`SELECT i.*, s.verification FROM invite_codes i JOIN shops s ON s.id=i.shop_id WHERE i.code_hash=? FOR UPDATE OF i`).get(A.codeHash(code, secret)));
      if (!inv || inv.revoked_at || inv.expires_at <= now() || inv.uses >= inv.max_uses || inv.verification !== 'approved') return null;
      const cn = (await q('SELECT * FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=? FOR UPDATE').get(inv.shop_id, c.shop.id));
      if (cn && cn.status === 'blocked') return null;
      if (cn && cn.status === 'approved') return { already: true, wid: inv.shop_id };
      // Auto-approval only while the supplier's plan allows it (open plan and below its retailer limit); otherwise the request waits.
      let auto = !!inv.auto_approve;
      if (auto) { const a = await plans.access(inv.shop_id); const max = a.sub ? a.sub.max_retailers : null;
        if (!a.can_sell || (max != null && Number((await q("SELECT COUNT(*) n FROM connections WHERE wholesaler_shop_id=? AND status='approved'").get(inv.shop_id)).n) >= max)) auto = false; }
      const status = auto ? 'approved' : 'pending';
      // Consume the code atomically: if a parallel redemption already used it, this one gets the same generic error.
      // A redemption that creates a pending request also uses the code; a declined request does not give it back.
      const used = await q('UPDATE invite_codes SET uses=uses+1 WHERE id=? AND uses<max_uses AND revoked_at IS NULL').run(inv.id);
      if (used.changes !== 1) return null;
      if (cn) (await q('UPDATE connections SET status=?, source=?, invite_code_id=?, requested_at=?, decided_at=? WHERE id=?').run(status, 'invite_code', inv.id, now(), auto ? now() : null, cn.id));
      else (await q('INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,invite_code_id,requested_at,decided_at) VALUES(?,?,?,?,?,?,?)').run(inv.shop_id, c.shop.id, status, 'invite_code', inv.id, now(), auto ? now() : null));
      await audit(db, { actorId: uid, actorLabel: c.user.name, action: 'joined_with_invite', entity: 'shop', entityId: inv.shop_id, detail: 'status ' + status + ', hint ' + inv.hint, ip: c.ip });
      await q('INSERT INTO code_attempts(user_id,ip,ok,ts) VALUES(?,?,1,?)').run(uid, c.ip, now());
      return { status, wid: inv.shop_id };
    });
    if (!out) await bad();
    if (out.already) fail(409, 'already_connected');
    emit({ kind: 'conn', wid: out.wid, rid: c.shop.id, data: {} });
    if (out.status === 'pending') notify.shop(out.wid, 'conn_request', { shop: c.shop.name }, 'retailers');
    return { status: out.status };
  }, { perm: 'network' });
  route('POST', '/api/r/request', 'retailer', async (c) => {
    if (!A.hit('request:' + c.user.id, 10, 3600000)) fail(429, 'rate_limited');
    const wid = A.int(c.body.wholesaler_shop_id, 'wholesaler_shop_id', 1, 1e9);
    const w = (await q(`SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE s.id=? AND s.type='wholesaler' AND s.verification='approved' AND u.status='active'`).get(wid));
    if (!w) fail(404, 'not_found');
    await tx(db, async () => {
      const cn = (await q('SELECT * FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=? FOR UPDATE').get(wid, c.shop.id));
      if (cn && cn.status === 'blocked') fail(403, 'cannot_request');
      if (cn && cn.status === 'approved') fail(409, 'already_connected');
      if (cn && cn.status === 'pending') return;
      if (cn) (await q(`UPDATE connections SET status='pending', source='request', requested_at=?, decided_at=NULL WHERE id=?`).run(now(), cn.id));
      else (await q(`INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,requested_at) VALUES(?,?,'pending','request',?)`).run(wid, c.shop.id, now()));
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'access_requested', entity: 'shop', entityId: wid, ip: c.ip });
    });
    emit({ kind: 'conn', wid, rid: c.shop.id, data: {} });
    notify.shop(wid, 'conn_request', { shop: c.shop.name }, 'retailers');
    return { status: 'pending' };
  }, { perm: 'network' });
  route('GET', '/api/r/catalog/:id', 'retailer', async (c) => {
    const wid = Number(c.params.id);
    if (!await connApproved(wid, c.shop.id)) fail(403, 'not_connected');
    // Blueprint 6.4: an expired or suspended supplier closes only its own catalogue; other suppliers are unaffected.
    if (!(await plans.access(wid)).can_sell) fail(403, 'supplier_inactive');
    const shop = (await q('SELECT id,name,city,upi_id,allow_cash,allow_home FROM shops WHERE id=?').get(wid));
    // Each buyer sees only their own price (special, else their tier, else list). Other tiers are never sent.
    const bp = await buyerPricing(wid, c.shop.id);
    return { shop, tier: bp.tier, products: await Promise.all((await q(`SELECT * FROM products WHERE shop_id=? AND status IN ('active','paused') ORDER BY is_new DESC, id DESC`).all(wid)).map(async (p) => ({ ...(await productOut(p, false)), price_paise: bp.priceOf(p), rate: bp.rateOf(p) }))) };
  });
  route('POST', '/api/r/orders', 'retailer', async (c) => {
    if (!A.hit('order:' + c.user.id, 30, 60000)) fail(429, 'rate_limited');
    const b = c.body;
    const wid = A.int(b.shop_id, 'shop_id', 1, 1e9);
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 20) fail(400, 'invalid_items');
    const seen = new Set();
    const items = b.items.map(x => {
      if (!x || typeof x !== 'object') fail(400, 'invalid_items');
      const pid = A.int(x.product_id, 'product_id', 1, 1e9), qty = A.int(x.qty, 'qty', 1, 100000);
      if (seen.has(pid)) fail(400, 'duplicate_item'); seen.add(pid); return { pid, qty };
    });
    const fulfilment = A.oneOf(b.fulfilment, 'fulfilment', ['pickup', 'home']);
    const address = fulfilment === 'home' ? A.str(b.address, 'address', 5, 300) : null;
    const mode = A.oneOf(b.payment_mode, 'payment_mode', ['upi', 'credit', 'cod']);
    const idem = A.str(b.idem_key, 'idem_key', 8, 64);
    if (!(await plans.access(wid)).can_sell) fail(403, 'supplier_inactive');
    let result;
    try { result = await tx(db, async () => {
      const dup = (await q('SELECT * FROM orders WHERE retailer_shop_id=? AND idem_key=?').get(c.shop.id, idem));
      if (dup) return { order: dup, dup: true };
      const cn = (await q(`SELECT c.credit_allowed, w.allow_cash, w.allow_home FROM connections c JOIN shops w ON w.id=c.wholesaler_shop_id JOIN users u ON u.id=w.owner_id
        WHERE c.wholesaler_shop_id=? AND c.retailer_shop_id=? AND c.status='approved' AND w.verification='approved' AND u.status='active'`).get(wid, c.shop.id));
      if (!cn) fail(403, 'not_connected');
      if (mode === 'credit' && !cn.credit_allowed) fail(403, 'credit_not_allowed');
      if (mode === 'cod' && !cn.allow_cash) fail(403, 'cash_not_allowed');
      if (fulfilment === 'home' && !cn.allow_home) fail(403, 'delivery_not_allowed');
      if ((await q(`SELECT COUNT(*) n FROM orders WHERE retailer_shop_id=? AND wholesaler_shop_id=? AND status='received'`).get(c.shop.id, wid)).n >= 5) fail(429, 'too_many_open_orders');
      let subtotal = 0; const lines = []; const bp = await buyerPricing(wid, c.shop.id);
      for (const it of items) {
        const p = (await q(`SELECT * FROM products WHERE id=? AND shop_id=? AND status='active'`).get(it.pid, wid));
        if (!p) fail(404, 'product_unavailable', { product_id: it.pid });
        if (it.qty < p.moq) fail(400, 'below_moq', { product_id: it.pid, moq: p.moq });
        const r = (await q(`UPDATE products SET reserved=reserved+? WHERE id=? AND shop_id=? AND status='active' AND on_hand-reserved>=?`).run(it.qty, it.pid, wid, it.qty));
        if (r.changes !== 1) fail(409, 'insufficient_stock', { product_id: it.pid, available: Math.max(0, p.on_hand - p.reserved) });
        const price = bp.priceOf(p); subtotal += price * it.qty; lines.push({ p, qty: it.qty, price });
      }
      const oid = Number((await q('INSERT INTO orders(no,wholesaler_shop_id,retailer_shop_id,placed_by,status,fulfilment,address,pickup_code,payment_mode,subtotal_paise,idem_key,reserve_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('PENDING', wid, c.shop.id, c.user.id, 'received', fulfilment, address, A.makeCode().slice(0, 6), mode, subtotal, idem, mode === 'credit' ? null : now() + DAY, now(), now())).lastInsertRowid);
      const no = 'SL-' + String(1000 + oid);
      await q('UPDATE orders SET no=? WHERE id=?').run(no, oid);
      for (const l of lines) (await q('INSERT INTO order_items(order_id,product_id,name_snapshot,unit,pack_qty,pack_detail,unit_price_paise,qty) VALUES(?,?,?,?,?,?,?,?)').run(oid, l.p.id, l.p.name, l.p.unit, l.p.pack_qty || 1, l.p.pack_detail || '', l.price, l.qty));
      await q('INSERT INTO order_history(order_id,status,actor_user_id,note,ts) VALUES(?,?,?,?,?)').run(oid, 'received', c.user.id, null, now());
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'order_placed', entity: 'order', entityId: oid, detail: `${no} total ${subtotal} items ${lines.length}`, ip: c.ip });
      return { order: (await q('SELECT * FROM orders WHERE id=?').get(oid)) };
    }); } catch (e) {
      if (isUnique(e) && /idem_key/.test(String(e.constraint || '') + String(e.message || ''))) result = { order: (await q('SELECT * FROM orders WHERE retailer_shop_id=? AND idem_key=?').get(c.shop.id, idem)), dup: true };
      else throw e;
    }
    if (!result.dup) {
      await emitStockFor(result.order.id); emit({ kind: 'order', wid, rid: c.shop.id, data: { order_id: result.order.id, status: 'received' } });
      notify.shop(wid, 'order_new', { no: result.order.no, shop: c.shop.name, total: notify.money(result.order.subtotal_paise) }, 'orders');
    }
    return { ...(await orderOut(result.order, 'retailer')), duplicate: !!result.dup };
  }, { perm: 'buy' });
  route('GET', '/api/r/orders', 'retailer', async (c) => ({ orders: await Promise.all((await q('SELECT * FROM orders WHERE retailer_shop_id=? ORDER BY id DESC LIMIT 100').all(c.shop.id)).map(o => orderOut(o, 'retailer'))) }));
  route('POST', '/api/r/orders/:id/cancel', 'retailer', async (c) => {
    const o = (await q('SELECT * FROM orders WHERE id=? AND retailer_shop_id=?').get(Number(c.params.id), c.shop.id)); if (!o) fail(404, 'not_found');
    const r = await cancelOrder(c, o, 'retailer', A.str(c.body.reason || 'Cancelled by retailer', 'reason', 3, 200));
    notify.shop(r.wholesaler_shop_id, 'order_cancelled_r', { no: r.no, shop: c.shop.name }, 'orders');
    return await orderOut(r, 'retailer');
  }, { perm: 'buy' });
  // Buyer answers the seller's proposed changes. Accept: quantities and prices change, held stock is adjusted.
  // Decline: the order is cancelled and its held stock released.
  route('POST', '/api/r/orders/:id/proposal', 'retailer', async (c) => {
    const decision = A.oneOf(c.body.decision, 'decision', ['accept', 'decline']);
    const o = await q('SELECT * FROM orders WHERE id=? AND retailer_shop_id=?').get(Number(c.params.id), c.shop.id); if (!o) fail(404, 'not_found');
    const pr0 = await q("SELECT id FROM order_proposals WHERE order_id=? AND status='pending'").get(o.id); if (!pr0) fail(409, 'no_proposal');
    if (decision === 'decline') {
      await q("UPDATE order_proposals SET status='declined', decided_by=?, decided_at=? WHERE id=? AND status='pending'").run(c.user.id, now(), pr0.id);
      const r = await cancelOrder(c, o, 'retailer', 'Buyer declined proposed changes');
      notify.shop(r.wholesaler_shop_id, 'proposal_declined', { no: r.no, shop: c.shop.name }, 'orders');
      return await orderOut(r, 'retailer');
    }
    const r = await tx(db, async () => {
      const cur = await q('SELECT * FROM orders WHERE id=? FOR UPDATE').get(o.id);
      if (cur.status !== 'received') fail(409, 'bad_state');
      const pr = await q("SELECT * FROM order_proposals WHERE id=? AND status='pending'").get(pr0.id); if (!pr) fail(409, 'no_proposal');
      for (const l of JSON.parse(pr.lines)) {
        const it = await q('SELECT id, qty FROM order_items WHERE order_id=? AND product_id=?').get(cur.id, l.product_id); if (!it) continue;
        const d = l.qty - Number(it.qty);
        if (d > 0) {
          const u = await q('UPDATE products SET reserved=reserved+? WHERE id=? AND on_hand-reserved>=?').run(d, l.product_id, d);
          if (u.changes !== 1) fail(409, 'insufficient_stock', { product_id: l.product_id });
        } else if (d < 0) {
          const u = await q('UPDATE products SET reserved=reserved-? WHERE id=? AND reserved>=?').run(-d, l.product_id, -d);
          if (u.changes !== 1) throw new Error('reservation_mismatch');
        }
        if (l.qty === 0) await q('DELETE FROM order_items WHERE id=?').run(it.id);
        else await q('UPDATE order_items SET qty=?, unit_price_paise=? WHERE id=?').run(l.qty, l.unit_price_paise, it.id);
      }
      const sum = (await q('SELECT qty, unit_price_paise FROM order_items WHERE order_id=?').all(cur.id)).reduce((a, x) => a + Number(x.qty) * Number(x.unit_price_paise), 0);
      await q('UPDATE orders SET subtotal_paise=?, updated_at=? WHERE id=?').run(sum, now(), cur.id);
      await q("UPDATE order_proposals SET status='accepted', decided_by=?, decided_at=? WHERE id=?").run(c.user.id, now(), pr.id);
      await q('INSERT INTO order_history(order_id,status,actor_user_id,note,ts) VALUES(?,?,?,?,?)').run(cur.id, 'received', c.user.id, 'changes accepted', now());
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'order_changes_accepted', entity: 'order', entityId: cur.id, detail: cur.no + ' total ' + sum, ip: c.ip });
      return await q('SELECT * FROM orders WHERE id=?').get(cur.id);
    });
    await emitStockFor(r.id); emit({ kind: 'order', wid: r.wholesaler_shop_id, rid: r.retailer_shop_id, data: { order_id: r.id } });
    notify.shop(r.wholesaler_shop_id, 'proposal_accepted', { no: r.no, shop: c.shop.name, total: notify.money(r.subtotal_paise) }, 'orders');
    return await orderOut(r, 'retailer');
  }, { perm: 'buy' });
  route('POST', '/api/r/orders/:id/payment', 'retailer', async (c) => {
    const utr = A.str(c.body.utr, 'utr', 6, 30).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(utr)) fail(400, 'invalid_utr');
    const proof = c.body.proof ? A.parseImage(c.body.proof, 800 * 1024) : null;
    const o = await tx(db, async () => {
      const cur = (await q('SELECT * FROM orders WHERE id=? AND retailer_shop_id=? FOR UPDATE').get(Number(c.params.id), c.shop.id));
      if (!cur) fail(404, 'not_found');
      if (cur.payment_mode !== 'upi' || cur.status !== 'received') fail(409, 'bad_state');
      try { (await q('UPDATE orders SET utr=?, proof_mime=?, proof_data=?, updated_at=? WHERE id=?').run(utr, proof ? proof.mime : null, proof ? proof.buf : null, now(), cur.id)); }
      catch (e) { if (isUnique(e)) fail(409, 'utr_already_used'); throw e; }
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'payment_reference_submitted', entity: 'order', entityId: cur.id, detail: cur.no, ip: c.ip });
      return (await q('SELECT * FROM orders WHERE id=?').get(cur.id));
    });
    emit({ kind: 'order', wid: o.wholesaler_shop_id, rid: o.retailer_shop_id, data: { order_id: o.id, status: o.status } });
    notify.shop(o.wholesaler_shop_id, 'payment_sent', { shop: c.shop.name, no: o.no, total: notify.money(o.subtotal_paise) }, 'orders');
    return await orderOut(o, 'retailer');
  }, { big: true, perm: 'buy' });
};
