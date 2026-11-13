'use strict';
// Chat between a wholesaler and a retailer who are connected (approved or waiting for approval).
// One conversation per shop pair. Messages can point at one of the pair's orders.
const A = require('../lib/auth');
const { fail } = A;

const OPEN = ['approved', 'pending'];

module.exports = function registerChat(ctx, route) {
  const { q, now, emit, notify } = ctx;

  // Resolves "the other shop" for the signed-in shop and checks they may talk.
  async function pairFor(c, otherId) {
    if (!c.shop || (c.user.role !== 'wholesaler' && c.user.role !== 'retailer')) fail(403, 'forbidden');
    const wid = c.user.role === 'wholesaler' ? c.shop.id : otherId;
    const rid = c.user.role === 'retailer' ? c.shop.id : otherId;
    const cn = await q('SELECT status FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=?').get(wid, rid);
    if (!cn || !OPEN.includes(cn.status)) fail(404, 'not_found');
    const other = await q('SELECT id,name,city FROM shops WHERE id=?').get(otherId);
    return { wid, rid, other, status: cn.status };
  }

  route('GET', '/api/chat/unread', 'any', async (c) => {
    if (!c.shop || c.user.role === 'admin') return { n: 0 };
    const col = c.user.role === 'wholesaler' ? 'wholesaler_shop_id' : 'retailer_shop_id';
    return { n: Number((await q(`SELECT COUNT(*) n FROM messages WHERE ${col}=? AND sender_user_id<>? AND read_at IS NULL`).get(c.shop.id, c.user.id)).n) || 0 };
  });

  route('GET', '/api/chat', 'any', async (c) => {
    if (!c.shop || c.user.role === 'admin') fail(403, 'forbidden');
    const w = c.user.role === 'wholesaler';
    const rows = await q(`SELECT * FROM (SELECT c.status, s.id other_id, s.name, s.city,
        (SELECT body FROM messages m WHERE m.wholesaler_shop_id=c.wholesaler_shop_id AND m.retailer_shop_id=c.retailer_shop_id ORDER BY m.id DESC LIMIT 1) last_body,
        (SELECT created_at FROM messages m WHERE m.wholesaler_shop_id=c.wholesaler_shop_id AND m.retailer_shop_id=c.retailer_shop_id ORDER BY m.id DESC LIMIT 1) last_at,
        (SELECT sender_user_id FROM messages m WHERE m.wholesaler_shop_id=c.wholesaler_shop_id AND m.retailer_shop_id=c.retailer_shop_id ORDER BY m.id DESC LIMIT 1) last_sender,
        (SELECT COUNT(*) FROM messages m WHERE m.wholesaler_shop_id=c.wholesaler_shop_id AND m.retailer_shop_id=c.retailer_shop_id AND m.sender_user_id<>? AND m.read_at IS NULL) unread
      FROM connections c JOIN shops s ON s.id=${w ? 'c.retailer_shop_id' : 'c.wholesaler_shop_id'}
      WHERE ${w ? 'c.wholesaler_shop_id' : 'c.retailer_shop_id'}=? AND c.status IN ('approved','pending')) x
      ORDER BY (last_at IS NULL), last_at DESC, name LIMIT 300`).all(c.user.id, c.shop.id);
    return { chats: rows.map((r) => ({ other_id: r.other_id, name: r.name, city: r.city, status: r.status, last_body: r.last_body || null,
      last_at: r.last_at || null, last_from_me: r.last_sender === c.user.id, unread: Number(r.unread) || 0 })) };
  });

  route('GET', '/api/chat/:id', 'any', async (c) => {
    const p = await pairFor(c, Number(c.params.id));
    const msgs = (await q(`SELECT id,from_role,sender_user_id,body,order_id,created_at,read_at FROM messages
      WHERE wholesaler_shop_id=? AND retailer_shop_id=? ORDER BY id DESC LIMIT 100`).all(p.wid, p.rid)).reverse();
    const r = await q('UPDATE messages SET read_at=? WHERE wholesaler_shop_id=? AND retailer_shop_id=? AND sender_user_id<>? AND read_at IS NULL').run(now(), p.wid, p.rid, c.user.id);
    if (r.changes) emit({ kind: 'chat', wid: p.wid, rid: p.rid, data: { read: true } });
    return { other: p.other, status: p.status, messages: msgs.map((m) => ({ id: m.id, mine: m.sender_user_id === c.user.id, from_role: m.from_role, body: m.body,
      order_id: m.order_id, order_no: null, created_at: m.created_at, read: !!m.read_at })) };
  });

  route('POST', '/api/chat/:id', 'any', async (c) => {
    if (!A.hit('chat:' + c.user.id, 20, 60000)) fail(429, 'rate_limited');
    const p = await pairFor(c, Number(c.params.id));
    const body = A.str(c.body.body, 'body', 1, 1000).trim();
    if (!body) fail(400, 'invalid_body');
    let orderId = null;
    if (c.body.order_id != null) {
      orderId = A.int(c.body.order_id, 'order_id', 1, 1e12);
      if (!await q('SELECT 1 FROM orders WHERE id=? AND wholesaler_shop_id=? AND retailer_shop_id=?').get(orderId, p.wid, p.rid)) fail(404, 'not_found');
    }
    const id = Number((await q('INSERT INTO messages(wholesaler_shop_id,retailer_shop_id,sender_user_id,from_role,body,order_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(p.wid, p.rid, c.user.id, c.user.role, body, orderId, now())).lastInsertRowid);
    emit({ kind: 'chat', wid: p.wid, rid: p.rid, data: { id } });
    notify.shop(p.other.id, 'chat_msg', { shop: c.shop.name, text: body.slice(0, 120) }, 'chat');
    return { id };
  });
};
