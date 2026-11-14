'use strict';
// Super-admin: shop verification, audit log, stats.
const A = require('../lib/auth');
const GST = require('../lib/gstin');
const seed = require('../lib/demo');
const { tx, audit, verifyAudit } = require('../lib/db');
const { fail } = require('../lib/auth');

module.exports = function registerAdmin(ctx, route) {
  const { db, q, cfg, emit, notify } = ctx;
  /* ----- admin ----- */
  route('GET', '/api/admin/stats', 'admin', async () => ({
    users: (await q('SELECT role,COUNT(*) n FROM users GROUP BY role').all()),
    shops: (await q('SELECT type,verification,COUNT(*) n FROM shops GROUP BY type,verification').all()),
    orders: (await q('SELECT status,COUNT(*) n, COALESCE(SUM(subtotal_paise),0) paise FROM orders GROUP BY status').all()) }));
  route('GET', '/api/admin/shops', 'admin', async (c) => {
    const st = c.query.get('status');
    const rows = (await q(`SELECT s.id,s.type,s.name,s.city,s.gstin,s.verification,s.reject_reason,s.created_at,u.name owner,u.phone,u.status user_status,u.deleted_at
      FROM shops s JOIN users u ON u.id=s.owner_id ${st ? 'WHERE s.verification=?' : ''} ORDER BY s.id DESC LIMIT 200`).all(...(st ? [st] : [])));
    return { shops: rows.map(r => ({ ...r, gstin_state: GST.stateOf(r.gstin), gstin_valid: r.gstin ? GST.validate(r.gstin).ok : null })) };
  });
  route('POST', '/api/admin/shops/:id/verify', 'admin', async (c) => {
    const act = A.oneOf(c.body.action, 'action', ['approve', 'reject', 'suspend', 'reinstate']);
    const reason = act === 'reject' || act === 'suspend' ? A.str(c.body.reason, 'reason', 3, 200) : null;
    const map = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'approved' };
    const shop = await tx(db, async () => {
      const s = (await q('SELECT * FROM shops WHERE id=?').get(Number(c.params.id)));
      if (!s) fail(404, 'not_found');
      if (map[act] === 'approved' && (await q('SELECT deleted_at FROM users WHERE id=?').get(s.owner_id)).deleted_at) fail(409, 'account_deleted');
      await q('UPDATE shops SET verification=?, reject_reason=? WHERE id=?').run(map[act], reason, s.id);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'shop_' + act, entity: 'shop', entityId: s.id, detail: s.name + (reason ? ' / ' + reason : ''), ip: c.ip });
      return s;
    });
    emit({ kind: 'catalog', wid: shop.id, scope: 'catalog', data: {} });
    if (map[act] === 'approved' && shop.verification !== 'approved' && shop.type === 'wholesaler') notify.shop(shop.id, 'shop_verified', {}, 'today');
    return { ok: true, verification: map[act] };
  });
  route('GET', '/api/admin/audit', 'admin', async (c) => {
    const limit = Math.min(200, Number(c.query.get('limit')) || 100), before = Number(c.query.get('before')) || 9e15;
    return { logs: (await q('SELECT id,ts,actor_user_id,actor_label,action,entity,entity_id,detail,ip FROM audit_logs WHERE id<? ORDER BY id DESC LIMIT ?').all(before, limit)) };
  });
  route('GET', '/api/admin/audit/verify', 'admin', async () => await verifyAudit(db));
  route('POST', '/api/admin/reset-demo', 'admin', async (c) => {
    if (!cfg.demo) fail(403, 'not_available');
    seed.resetDemo(db, cfg); return { ok: true };
  });
};
