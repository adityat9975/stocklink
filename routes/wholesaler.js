'use strict';
// Wholesaler: retailers, invite codes, products, stock, orders.
const A = require('../lib/auth');
const { tx, audit } = require('../lib/db');
const { fail } = require('../lib/auth');

const UNITS = ['pc', 'set', 'box', 'pack', 'dozen'];

// Contents of one pack: either a plain piece count, or a size/variant assortment such as L 6 + XL 6 + XXL 6.
// Returns { packQty, detail } where detail is JSON text ('' when plain).
function readPack(unit, b, fallback) {
  if (unit === 'pc') return { packQty: 1, detail: '' };
  if (b.pack_detail !== undefined && b.pack_detail !== null && !(Array.isArray(b.pack_detail) && b.pack_detail.length === 0)) {
    if (!Array.isArray(b.pack_detail) || b.pack_detail.length > 12) fail(400, 'invalid_pack_detail');
    const seen = new Set();
    const rows = b.pack_detail.map((r) => {
      if (!r || typeof r !== 'object') fail(400, 'invalid_pack_detail');
      const label = A.str(r.label, 'pack_detail', 1, 12);
      if (seen.has(label.toLowerCase())) fail(400, 'invalid_pack_detail');
      seen.add(label.toLowerCase());
      return { label, qty: A.int(r.qty, 'pack_detail', 1, 100000) };
    });
    const total = rows.reduce((a, r) => a + r.qty, 0);
    if (total > 100000) fail(400, 'invalid_pack_detail');
    return { packQty: total, detail: JSON.stringify(rows) };
  }
  if (b.pack_detail !== undefined) return { packQty: b.pack_qty === undefined ? 1 : A.int(b.pack_qty, 'pack_qty', 1, 100000), detail: '' };
  if (b.pack_qty !== undefined) return { packQty: A.int(b.pack_qty, 'pack_qty', 1, 100000), detail: '' };
  return fallback || { packQty: 1, detail: '' };
}

module.exports = function registerWholesaler(ctx, route) {
  const { plans, db, q, cancelOrder, now, secret, emit, rupeesToPaise, productOut, orderOut, setStatus, emitStockFor, DAY, notify } = ctx;
  /* ----- wholesaler ----- */
  const needApproved = (c) => { if (c.shop.verification !== 'approved') fail(403, 'shop_not_verified'); };
  // Restricted mode (blueprint 6.2): when the plan has expired or is suspended, new products, codes and retailer
  // approvals stop; existing orders, stock counts and all history keep working.
  const needPlan = async (c) => { const a = await plans.access(c.shop.id); if (!a.can_sell) fail(403, 'plan_inactive', { state: a.state }); return a; };
  const limit = async (c, what) => {
    const a = await needPlan(c), max = a.sub ? a.sub['max_' + what] : null;
    if (max == null) return;
    const n = what === 'products' ? Number((await q("SELECT COUNT(*) n FROM products WHERE shop_id=? AND status<>'archived'").get(c.shop.id)).n)
      : Number((await q("SELECT COUNT(*) n FROM connections WHERE wholesaler_shop_id=? AND status='approved'").get(c.shop.id)).n);
    if (n >= max) fail(403, 'plan_limit', { what, max });
  };
  route('GET', '/api/w/dashboard', 'wholesaler', async (c) => {
    const sid = c.shop.id;
    const open = (await q(`SELECT COUNT(*) n FROM orders WHERE wholesaler_shop_id=? AND status NOT IN ('completed','cancelled','expired')`).get(sid)).n;
    const pending = (await q(`SELECT COUNT(*) n FROM connections WHERE wholesaler_shop_id=? AND status='pending'`).get(sid)).n;
    const low = (await q(`SELECT COUNT(*) n FROM products WHERE shop_id=? AND status!='archived' AND on_hand-reserved<=5`).get(sid)).n;
    const reserved = (await q('SELECT COALESCE(SUM(reserved),0) n FROM products WHERE shop_id=?').get(sid)).n;
    const sales = (await q(`SELECT COALESCE(SUM(subtotal_paise),0) n FROM orders WHERE wholesaler_shop_id=? AND status IN ('paid','packed','dispatched','completed')`).get(sid)).n;
    const cnt = async (st, extra) => (await q(`SELECT COUNT(*) n FROM orders WHERE wholesaler_shop_id=? AND status=? ${extra || ''}`).get(sid, st)).n;
    // Today and last 7 days (India time) for the home screen.
    const IST = 19800000, DAYMS = 86400000, t0 = Date.now();
    const today0 = Math.floor((t0 + IST) / DAYMS) * DAYMS - IST, week0 = today0 - 6 * DAYMS;
    const LIVE = "status NOT IN ('cancelled','expired')";
    const tday = await q(`SELECT COUNT(*) n, COALESCE(SUM(subtotal_paise),0) v FROM orders WHERE wholesaler_shop_id=? AND ${LIVE} AND created_at>=?`).get(sid, today0);
    const wk = await q(`SELECT ((created_at+${IST})/${DAYMS}) d, COUNT(*) n, COALESCE(SUM(subtotal_paise),0) v FROM orders WHERE wholesaler_shop_id=? AND ${LIVE} AND created_at>=? GROUP BY ((created_at+${IST})/${DAYMS})`).all(sid, week0);
    const byDay = new Map(wk.map((r) => [Number(r.d), r]));
    const week = []; for (let i = 0; i < 7; i++) { const day = week0 + i * DAYMS, k = Math.floor((day + IST) / DAYMS), r = byDay.get(k); week.push({ t: day, n: r ? Number(r.n) : 0, v: r ? Number(r.v) : 0 }); }
    const retailers = Number((await q("SELECT COUNT(*) n FROM connections WHERE wholesaler_shop_id=? AND status='approved'").get(sid)).n);
    // Money not received yet on open orders: cash and credit orders, plus UPI payments waiting to be checked.
    const collectRows = await q(`SELECT payment_mode k, COUNT(*) n, COALESCE(SUM(subtotal_paise),0) v FROM orders WHERE wholesaler_shop_id=? AND status NOT IN ('completed','cancelled','expired')
      AND (payment_mode IN ('cod','credit') OR (payment_mode='upi' AND status='received' AND utr IS NOT NULL)) GROUP BY payment_mode`).all(sid);
    const collect = { cod: { n: 0, v: 0 }, credit: { n: 0, v: 0 }, upi: { n: 0, v: 0 } };
    for (const r of collectRows) collect[r.k] = { n: Number(r.n), v: Number(r.v) };
    collect.total = collect.cod.v + collect.credit.v + collect.upi.v;
    const topRetailers = (await q(`SELECT s.name, s.city, COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v FROM orders o JOIN shops s ON s.id=o.retailer_shop_id
      WHERE o.wholesaler_shop_id=? AND o.status NOT IN ('cancelled','expired') AND o.created_at>=? GROUP BY s.id, s.name, s.city ORDER BY v DESC LIMIT 3`).all(sid, week0)).map((r) => ({ name: r.name, city: r.city, n: Number(r.n), v: Number(r.v) }));
    const topProducts = (await q(`SELECT oi.product_id id, oi.name_snapshot name, SUM(oi.qty) qty, SUM(oi.qty*oi.unit_price_paise) v, (SELECT m.id FROM media m WHERE m.product_id=oi.product_id ORDER BY m.sort,m.id LIMIT 1) media_id
      FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.wholesaler_shop_id=? AND o.status NOT IN ('cancelled','expired') AND o.created_at>=? GROUP BY oi.product_id, oi.name_snapshot ORDER BY qty DESC LIMIT 6`).all(sid, week0)).map((r) => ({ id: r.id, name: r.name, qty: Number(r.qty), v: Number(r.v), media_id: r.media_id }));
    const products = Number((await q("SELECT COUNT(*) n FROM products WHERE shop_id=? AND status='active'").get(sid)).n);
    const lowItems = (await q(`SELECT p.id,p.name,p.price_paise,p.on_hand-p.reserved AS available,(SELECT m.id FROM media m WHERE m.product_id=p.id ORDER BY m.sort,m.id LIMIT 1) media_id FROM products p WHERE p.shop_id=? AND p.status='active' AND p.on_hand-p.reserved<=5 ORDER BY p.on_hand-p.reserved, p.name LIMIT 8`).all(sid));
    return { collect, top_retailers: topRetailers, top_products: topProducts, today_orders: Number(tday.n), today_value_paise: Number(tday.v), week, retailers, products, open_orders: open, pending_requests: pending, low_stock: low, reserved_units: reserved, confirmed_value_paise: sales,
      to_verify: await cnt('received', "AND payment_mode='upi' AND utr IS NOT NULL"), to_confirm: await cnt('received', "AND (payment_mode!='upi')"), to_pack: await cnt('paid'), to_dispatch: await cnt('packed'), to_handover: await cnt('dispatched'), low_items: lowItems };
  });
  route('POST', '/api/w/profile', 'wholesaler', async (c) => {
    const upi = A.str(c.body.upi_id, 'upi_id', 3, 80);
    if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(upi)) fail(400, 'invalid_upi_id');
    await q('UPDATE shops SET upi_id=? WHERE id=?').run(upi, c.shop.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'set_upi_id', entity: 'shop', entityId: c.shop.id, ip: c.ip });
    return { ok: true };
  }, { perm: 'settings' });
  // Which payment and handover options retailers may choose.
  route('POST', '/api/w/options', 'wholesaler', async (c) => {
    const cash = c.body.allow_cash ? 1 : 0, home = c.body.allow_home ? 1 : 0;
    await q('UPDATE shops SET allow_cash=?, allow_home=? WHERE id=?').run(cash, home, c.shop.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'set_order_options', entity: 'shop', entityId: c.shop.id, detail: 'cash ' + cash + ' delivery ' + home, ip: c.ip });
    return { ok: true, allow_cash: !!cash, allow_home: !!home };
  }, { perm: 'settings' });
  route('GET', '/api/w/retailers', 'wholesaler', async (c) => ({ connections: (await q(`
    SELECT c.id,c.status,c.source,c.credit_allowed,c.requested_at,c.decided_at,s.name,s.city,
      CASE WHEN c.status='approved' THEN u.phone END phone
    FROM connections c JOIN shops s ON s.id=c.retailer_shop_id JOIN users u ON u.id=s.owner_id
    WHERE c.wholesaler_shop_id=? ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.requested_at DESC`).all(c.shop.id)) }));
  route('POST', '/api/w/connections/:id', 'wholesaler', async (c) => {
    const act = A.oneOf(c.body.action, 'action', ['approve', 'decline', 'revoke', 'block', 'credit']);
    if (act === 'approve') await limit(c, 'retailers');
    const result = await tx(db, async () => {
      const cn = (await q('SELECT * FROM connections WHERE id=? AND wholesaler_shop_id=? FOR UPDATE').get(Number(c.params.id), c.shop.id));
      if (!cn) fail(404, 'not_found');
      const rs = (await q('SELECT name FROM shops WHERE id=?').get(cn.retailer_shop_id));
      let status = cn.status, detail = rs.name;
      if (act === 'approve') { needApproved(c); if (!['pending', 'revoked', 'rejected'].includes(cn.status)) fail(409, 'bad_state'); status = 'approved'; }
      else if (act === 'decline') { if (cn.status !== 'pending') fail(409, 'bad_state'); status = 'rejected'; }
      else if (act === 'revoke') { if (cn.status !== 'approved') fail(409, 'bad_state'); status = 'revoked'; }
      else if (act === 'block') status = 'blocked';
      if (act === 'credit') {
        const on = c.body.allowed ? 1 : 0; (await q('UPDATE connections SET credit_allowed=? WHERE id=?').run(on, cn.id)); detail += ' credit=' + on;
      } else (await q('UPDATE connections SET status=?, decided_at=? WHERE id=?').run(status, now(), cn.id));
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'connection_' + act, entity: 'connection', entityId: cn.id, detail, ip: c.ip });
      return cn;
    });
    emit({ kind: 'conn', wid: c.shop.id, rid: result.retailer_shop_id, data: {} });
    if (act === 'approve') notify.shop(result.retailer_shop_id, 'conn_approved', { shop: c.shop.name }, 'catalog');
    return { ok: true };
  }, { perm: 'network' });
  route('GET', '/api/w/invites', 'wholesaler', async (c) => ({ invites: (await q('SELECT id,hint,max_uses,uses,expires_at,auto_approve,revoked_at,created_at FROM invite_codes WHERE shop_id=? ORDER BY id DESC LIMIT 20').all(c.shop.id))
    .map(i => ({ ...i, auto_approve: !!i.auto_approve, active: !i.revoked_at && i.expires_at > now() && i.uses < i.max_uses })) }));
  route('POST', '/api/w/invites', 'wholesaler', async (c) => {
    needApproved(c); await needPlan(c);
    // Blueprint 5.3: an invitation code works exactly once. Make one code per retailer.
    const max = 1;
    const days = c.body.days === undefined ? 7 : A.int(c.body.days, 'days', 1, 30);
    const code = A.makeCode();
    await tx(db, async () => {
      if ((await q('SELECT COUNT(*) n FROM invite_codes WHERE shop_id=? AND revoked_at IS NULL AND expires_at>? AND uses<max_uses').get(c.shop.id, now())).n >= 10) fail(409, 'too_many_active_codes');
      const id = Number((await q('INSERT INTO invite_codes(shop_id,code_hash,hint,max_uses,expires_at,auto_approve,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(c.shop.id, A.codeHash(code, secret), code.slice(-2), max, now() + days * DAY, c.body.auto_approve ? 1 : 0, now())).lastInsertRowid);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'invite_created', entity: 'invite', entityId: id, detail: 'hint ' + code.slice(-2) + ' single-use', ip: c.ip });
    });
    return { code: A.fmtCode(code) };
  }, { perm: 'network' });
  route('POST', '/api/w/invites/:id/revoke', 'wholesaler', async (c) => {
    const r = (await q('UPDATE invite_codes SET revoked_at=? WHERE id=? AND shop_id=? AND revoked_at IS NULL').run(now(), Number(c.params.id), c.shop.id));
    if (r.changes !== 1) fail(404, 'not_found');
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'invite_revoked', entity: 'invite', entityId: c.params.id, ip: c.ip });
    return { ok: true };
  }, { perm: 'network' });

  const savePhotos = async (pid, photos) => {
    for (let i = 0; i < photos.length; i++) await q('INSERT INTO media(product_id,mime,data,sort,created_at) VALUES(?,?,?,?,?)').run(pid, photos[i].mime, photos[i].buf, i, now());
  };
  const readPhotos = (arr, max) => {
    if (arr === undefined) return [];
    if (!Array.isArray(arr) || arr.length > max) fail(400, 'too_many_photos');
    return arr.map(x => A.parseImage(x, 600 * 1024));
  };
  route('GET', '/api/w/products', 'wholesaler', async (c) => ({ products: await Promise.all((await q(`SELECT * FROM products WHERE shop_id=? AND status!='archived' ORDER BY id DESC`).all(c.shop.id)).map(p => productOut(p, true))) }));
  route('POST', '/api/w/products', 'wholesaler', async (c) => {
    await limit(c, 'products');
    const b = c.body;
    const name = A.str(b.name, 'name', 2, 100), spec = b.spec ? A.str(b.spec, 'spec', 0, 200) : '';
    const price = rupeesToPaise(b.price), stock = A.int(b.on_hand, 'on_hand', 0, 10000000);
    const unit = b.unit === undefined ? 'pc' : A.oneOf(b.unit, 'unit', UNITS), moq = b.moq === undefined ? 1 : A.int(b.moq, 'moq', 1, 100000);
    const { packQty, detail } = readPack(unit, b);
    const photos = readPhotos(b.photos, 4);
    const category = b.category ? A.str(b.category, 'category', 0, 30).trim() : '';
    const id = await tx(db, async () => {
      const pid = Number((await q('INSERT INTO products(shop_id,name,spec,price_paise,unit,pack_qty,pack_detail,moq,on_hand,is_new,stock_verified_at,created_at,category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(c.shop.id, name, spec, price, unit, packQty, detail, moq, stock, 1, now(), now(), category)).lastInsertRowid);
      await savePhotos(pid, photos);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'product_created', entity: 'product', entityId: pid, detail: name + ' stock ' + stock, ip: c.ip });
      return pid;
    });
    emit({ kind: 'catalog', wid: c.shop.id, scope: 'catalog', data: { product_id: id } });
    if (stock > 0) notify.retailersOf(c.shop.id, 'product_new', { shop: c.shop.name, name }, 'catalog');
    return { id };
  }, { big: true, perm: 'catalog' });
  const ownProduct = async (c) => { const p = (await q('SELECT * FROM products WHERE id=? AND shop_id=? FOR UPDATE').get(Number(c.params.id), c.shop.id)); if (!p) fail(404, 'not_found'); return p; };
  route('POST', '/api/w/products/:id/stock', 'wholesaler', async (c) => {
    let wasOut = false;
    const p = await tx(db, async () => {
      const p = await ownProduct(c);
      wasOut = p.on_hand - p.reserved <= 0;
      let next;
      if (c.body.set !== undefined) next = A.int(c.body.set, 'set', 0, 10000000);
      else { const d = c.body.delta; if (!Number.isInteger(d) || Math.abs(d) > 100000) fail(400, 'invalid_delta'); next = p.on_hand + d; }
      if (next < p.reserved) fail(409, 'below_reserved', { reserved: p.reserved });
      if (next > 10000000) fail(400, 'invalid_stock');
      await q('UPDATE products SET on_hand=?, stock_verified_at=? WHERE id=?').run(next, now(), p.id);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'stock_adjusted', entity: 'product', entityId: p.id, detail: `${p.name}: ${p.on_hand} -> ${next}${c.body.reason ? ' (' + String(c.body.reason).slice(0, 40) + ')' : ''}`, ip: c.ip });
      return (await q('SELECT * FROM products WHERE id=?').get(p.id));
    });
    emit({ kind: 'stock', wid: c.shop.id, scope: 'catalog', data: { product_id: p.id, available: p.on_hand - p.reserved } });
    if (wasOut && p.on_hand - p.reserved > 0 && p.status === 'active') notify.retailersOf(c.shop.id, 'back_in_stock', { shop: c.shop.name, name: p.name, n: p.on_hand - p.reserved }, 'catalog');
    return await productOut(p, true);
  }, { perm: 'stock' });
  route('POST', '/api/w/products/:id/verify', 'wholesaler', async (c) => {
    const p = await ownProduct(c); (await q('UPDATE products SET stock_verified_at=? WHERE id=?').run(now(), p.id));
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'stock_verified', entity: 'product', entityId: p.id, detail: p.name, ip: c.ip });
    emit({ kind: 'stock', wid: c.shop.id, scope: 'catalog', data: { product_id: p.id, available: p.on_hand - p.reserved } });
    return { ok: true };
  }, { perm: 'stock' });
  route('POST', '/api/w/products/:id/status', 'wholesaler', async (c) => {
    const st = A.oneOf(c.body.status, 'status', ['active', 'paused', 'archived']); const p = await ownProduct(c);
    await q('UPDATE products SET status=? WHERE id=?').run(st, p.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'product_' + st, entity: 'product', entityId: p.id, detail: p.name, ip: c.ip });
    emit({ kind: 'catalog', wid: c.shop.id, scope: 'catalog', data: { product_id: p.id } });
    if (st === 'active' && p.status !== 'active' && p.on_hand - p.reserved > 0) notify.retailersOf(c.shop.id, 'back_in_stock', { shop: c.shop.name, name: p.name, n: p.on_hand - p.reserved }, 'catalog');
    return { ok: true };
  }, { perm: 'catalog' });
  route('POST', '/api/w/products/:id/update', 'wholesaler', async (c) => {
    const p = await ownProduct(c), b = c.body;
    const name = b.name !== undefined ? A.str(b.name, 'name', 2, 100) : p.name;
    const spec = b.spec !== undefined ? A.str(b.spec, 'spec', 0, 200) : p.spec;
    const price = b.price !== undefined ? rupeesToPaise(b.price) : p.price_paise;
    const unit = b.unit !== undefined ? A.oneOf(b.unit, 'unit', UNITS) : p.unit;
    const { packQty, detail } = readPack(unit, b, { packQty: p.pack_qty || 1, detail: p.pack_detail || '' });
    const category = b.category !== undefined ? A.str(b.category, 'category', 0, 30).trim() : (p.category || '');
    await q('UPDATE products SET name=?,spec=?,price_paise=?,unit=?,pack_qty=?,pack_detail=?,category=? WHERE id=?').run(name, spec, price, unit, packQty, detail, category, p.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'product_updated', entity: 'product', entityId: p.id, detail: `price ${p.price_paise} -> ${price}`, ip: c.ip });
    emit({ kind: 'catalog', wid: c.shop.id, scope: 'catalog', data: { product_id: p.id } });
    return { ok: true };
  }, { perm: 'catalog' });
  route('POST', '/api/w/products/:id/photos', 'wholesaler', async (c) => {
    const p = await ownProduct(c);
    const have = (await q('SELECT COUNT(*) n FROM media WHERE product_id=?').get(p.id)).n;
    const photos = readPhotos(c.body.photos, 4 - have < 0 ? 0 : 4 - have);
    if (!photos.length) fail(400, 'invalid_image');
    await savePhotos(p.id, photos.map(x => x));
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'photos_added', entity: 'product', entityId: p.id, detail: String(photos.length), ip: c.ip });
    emit({ kind: 'catalog', wid: c.shop.id, scope: 'catalog', data: { product_id: p.id } });
    return { ok: true };
  }, { big: true, perm: 'catalog' });
  route('GET', '/api/w/orders', 'wholesaler', async (c) => ({ orders: await Promise.all((await q('SELECT * FROM orders WHERE wholesaler_shop_id=? ORDER BY id DESC LIMIT 100').all(c.shop.id)).map(o => orderOut(o, 'wholesaler'))) }));

  const FLOW = ['received', 'paid', 'packed', 'dispatched', 'completed'];
  route('POST', '/api/w/orders/:id/advance', 'wholesaler', async (c) => {
    const id = Number(c.params.id);
    const o = await tx(db, async () => {
      const o = (await q('SELECT * FROM orders WHERE id=? AND wholesaler_shop_id=? FOR UPDATE').get(id, c.shop.id));
      if (!o) fail(404, 'not_found');
      const i = FLOW.indexOf(o.status);
      if (i < 0 || i >= FLOW.length - 1) fail(409, 'bad_state');
      const next = FLOW[i + 1];
      if (next === 'paid' && o.payment_mode === 'upi' && !o.utr) fail(409, 'payment_reference_missing');
      if (next === 'dispatched') {
        for (const it of (await q('SELECT product_id,qty FROM order_items WHERE order_id=?').all(o.id))) {
          const r = (await q('UPDATE products SET on_hand=on_hand-?, reserved=reserved-? WHERE id=? AND reserved>=? AND on_hand>=?').run(it.qty, it.qty, it.product_id, it.qty, it.qty));
          if (r.changes !== 1) fail(409, 'stock_mismatch');
        }
      }
      if (next === 'completed' && o.fulfilment === 'pickup' && !A.safeEqual(String(c.body.pickup_code || '').toUpperCase(), o.pickup_code)) fail(403, 'wrong_pickup_code');
      await setStatus(o, next, c.user.id, null);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'order_' + next, entity: 'order', entityId: o.id, detail: o.no, ip: c.ip });
      return (await q('SELECT * FROM orders WHERE id=?').get(o.id));
    });
    await emitStockFor(o.id); emit({ kind: 'order', wid: o.wholesaler_shop_id, rid: o.retailer_shop_id, data: { order_id: o.id, status: o.status } });
    notify.shop(o.retailer_shop_id, 'order_status', { no: o.no, shop: c.shop.name, status: o.status === 'dispatched' && o.fulfilment === 'pickup' ? 'ready' : o.status }, 'orders');
    return await orderOut(o, 'wholesaler');
  }, { perm: 'orders' });
  route('POST', '/api/w/orders/:id/cancel', 'wholesaler', async (c) => {
    const o = (await q('SELECT * FROM orders WHERE id=? AND wholesaler_shop_id=?').get(Number(c.params.id), c.shop.id)); if (!o) fail(404, 'not_found');
    const reason = A.str(c.body.reason || 'Cancelled by wholesaler', 'reason', 3, 200), r = await cancelOrder(c, o, 'wholesaler', reason);
    notify.shop(r.retailer_shop_id, 'order_cancelled_w', { no: r.no, shop: c.shop.name, reason }, 'orders');
    return await orderOut(r, 'wholesaler');
  }, { perm: 'orders' });
};
