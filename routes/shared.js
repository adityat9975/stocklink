'use strict';
// Authenticated media, payment proof and live-update stream.
const { fail } = require('../lib/auth');
const { securityHeaders } = require('../lib/security');

module.exports = function registerShared(ctx, route) {
  const { cfg, q, clients, connApproved } = ctx;
  /* ----- shared ----- */
  route('GET', '/api/media/:id', 'any', async (c) => {
    const m = (await q('SELECT m.mime,m.data,p.shop_id,p.status FROM media m JOIN products p ON p.id=m.product_id WHERE m.id=?').get(Number(c.params.id)));
    let ok = false;
    if (m) {
      if (c.user.role === 'admin') ok = true;
      else if (c.shop && c.shop.id === m.shop_id) ok = true;
      else if (c.user.role === 'retailer' && m.status !== 'archived' && await connApproved(m.shop_id, c.shop.id)) ok = true;
    }
    if (!ok) fail(404, 'not_found');
    return { raw: Buffer.from(m.data), mime: m.mime };
  });
  route('GET', '/api/orders/:id/proof', 'any', async (c) => {
    const o = (await q('SELECT * FROM orders WHERE id=?').get(Number(c.params.id)));
    let ok = false;
    if (o && o.proof_data) ok = c.user.role === 'admin' || (c.shop && (c.shop.id === o.wholesaler_shop_id || c.shop.id === o.retailer_shop_id));
    if (!ok) fail(404, 'not_found');
    return { raw: Buffer.from(o.proof_data), mime: o.proof_mime };
  });
  route('GET', '/api/stream', 'any', async (c) => {
    const mine = [...clients].filter(x => x.userId === c.user.id).length;
    if (mine >= 5) fail(429, 'too_many_streams');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...securityHeaders(cfg) });
    c.res.write('retry: 4000\nevent: hello\ndata: {}\n\n');
    const cl = { res: c.res, userId: c.user.id, role: c.user.role, shopId: c.shop ? c.shop.id : null };
    clients.add(cl);
    const hb = setInterval(() => { try { c.res.write(': hb\n\n'); } catch (_) {} }, 25000);
    c.req.on('close', () => { clearInterval(hb); clients.delete(cl); });
    return { streaming: true };
  });
};
