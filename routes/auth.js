'use strict';
// Public config, signup, login, logout, profile preferences.
const A = require('../lib/auth');
const GST = require('../lib/gstin');
const TOTP = require('../lib/totp');
const { tx, audit } = require('../lib/db');
const { fail } = require('../lib/auth');

module.exports = function registerAuth(ctx, route) {
  const { db, q, now, cfg, isUnique, phoneOf, startSession, emit } = ctx;
  route('GET', '/api/config', null, async () => ({ demo: cfg.demo, currency: cfg.currency,
    accounts: cfg.demo ? [
      { role: 'retailer', label: 'Retailer (connected)', phone: '9000000004' }, { role: 'wholesaler', label: 'Wholesaler (verified)', phone: '9000000002' },
      { role: 'admin', label: 'Super admin', phone: '9000000001' }, { role: 'retailer', label: 'Retailer (not connected yet)', phone: '9000000006' }] : [],
    demo_password: cfg.demo ? 'Demo@1234' : null, demo_code: cfg.demo ? 'K7QM-3XRP' : null }));

  route('POST', '/api/signup', null, async (c) => {
    if (!A.hit('signup:' + c.ip, 10, 3600000)) fail(429, 'rate_limited');
    const b = c.body;
    const role = A.oneOf(b.role, 'role', ['retailer', 'wholesaler']);
    const name = A.str(b.name, 'name', 2, 60), phone = phoneOf(b.phone);
    if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) fail(400, 'weak_password');
    if (b.password.replace(/\D/g, '') === phone.replace(/\D/g, '')) fail(400, 'weak_password');
    const shopName = A.str(b.shop_name, 'shop_name', 2, 80), city = A.str(b.city, 'city', 2, 60);
    let gstin = null; // GSTIN is required for wholesalers only; retailers are never asked for it
    if (role === 'wholesaler') {
      if (!b.gstin) fail(400, 'gstin_required');
      const g = GST.validate(b.gstin); if (!g.ok) fail(400, 'invalid_gstin');
      gstin = g.gstin;
      if ((await q('SELECT 1 FROM shops WHERE gstin=? AND type=?').get(gstin, 'wholesaler'))) fail(409, 'gstin_taken');
    }
    if ((await q('SELECT 1 FROM users WHERE phone=?').get(phone))) fail(409, 'phone_taken');
    const hash = await A.hashPassword(b.password);
    let user;
    try { user = await tx(db, async () => {
      if ((await q('SELECT 1 FROM users WHERE phone=?').get(phone))) fail(409, 'phone_taken');
      const uid = Number((await q('INSERT INTO users(phone,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)').run(phone, name, role, hash, now())).lastInsertRowid);
      const sid = Number((await q('INSERT INTO shops(owner_id,type,name,city,gstin,verification,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(uid, role, shopName, city, gstin, role === 'retailer' ? 'approved' : 'pending', now())).lastInsertRowid);
      await q("INSERT INTO memberships(user_id,shop_id,role,created_at) VALUES(?,?,'owner',?)").run(uid, sid, now());
      await audit(db, { actorId: uid, actorLabel: name, action: 'signup', entity: 'shop', entityId: sid, detail: role + ' ' + shopName, ip: c.ip });
      return (await q('SELECT * FROM users WHERE id=?').get(uid));
    }); } catch (e) { if (isUnique(e)) fail(409, 'phone_taken'); throw e; }
    await startSession(c.res, user, c);
    return await me(user);
  });

  route('POST', '/api/login', null, async (c) => {
    const phone = typeof c.body.phone === 'string' ? c.body.phone.replace(/[\s-]/g, '') : '';
    const pw = typeof c.body.password === 'string' ? c.body.password.slice(0, 128) : '';
    // 10 tries, 30 s pause, then 5 tries per 30 s pause, repeating (per phone number; wider allowance per IP)
    const wait = Math.max(A.gate('login-phone:' + phone, { first: 10, then: 5 }), A.gate('login-ip:' + c.ip, { first: 40, then: 20 }));
    if (wait) fail(429, 'login_locked', { retry_after: wait });
    const u = (await q('SELECT * FROM users WHERE phone=?').get(phone));
    const ok = await A.verifyPassword(pw, u ? u.pass_hash : A.DUMMY_HASH);
    if (!u || !ok || u.status !== 'active') {
      await audit(db, { actorLabel: 'anonymous', action: 'login_failed', entity: 'user', entityId: u ? u.id : null, ip: c.ip });
      fail(401, 'invalid_credentials');
    }
    // Super Admin with an authenticator: the 6-digit code is part of logging in (no half-signed-in session).
    let mfa = false;
    if (u.role === 'admin' && u.totp_on) {
      if (!c.body.otp) fail(401, 'otp_required');
      if (!TOTP.verify(u.totp_secret, String(c.body.otp))) { await audit(db, { actorId: u.id, actorLabel: u.name, action: 'login_failed_otp', entity: 'user', entityId: u.id, ip: c.ip }); fail(401, 'invalid_otp'); }
      mfa = true;
    }
    A.gateClear('login-phone:' + phone);
    await startSession(c.res, u, c, { mfa });
    u.mfa_ok = mfa ? 1 : 0;
    await audit(db, { actorId: u.id, actorLabel: u.name, action: 'login', entity: 'user', entityId: u.id, ip: c.ip });
    return await me(u);
  });

  route('POST', '/api/logout', 'any', async (c) => {
    const m = /(?:^|;\s*)sl_sid=([A-Za-z0-9_-]{20,64})/.exec(c.req.headers.cookie || '');
    if (m) (await q('DELETE FROM sessions WHERE id=?').run(A.sha256(m[1])));
    c.res.setHeader('Set-Cookie', `sl_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cfg.prod ? '; Secure' : ''}`);
    return { ok: true };
  });

  // The signed-in person, every business they belong to, and the one this page is acting for.
  async function me(u, activeId) {
    if (u.role === 'admin') return { user: { id: u.id, name: u.name, phone: u.phone, role: 'admin', lang: u.lang, tutorial_done: !!u.tutorial_done,
      mfa_needed: !!(cfg.admin2fa && !u.mfa_ok) }, shop: null, businesses: [] };
    const mems = await q(`SELECT m.role AS member_role, s.id, s.type, s.name, s.city, s.gstin, s.upi_id, s.allow_cash, s.allow_home, s.verification, s.reject_reason
      FROM memberships m JOIN shops s ON s.id = m.shop_id WHERE m.user_id = ? ORDER BY m.id`).all(u.id);
    const shop = mems.find((x) => x.id === activeId) || mems[0] || null;
    if (shop && shop.type === 'wholesaler') { const a = await ctx.plans.access(shop.id); shop.plan = { state: a.state, days_left: a.days_left, name: a.sub ? a.sub.plan_name : null }; }
    return { user: { id: u.id, name: u.name, phone: u.phone, role: shop ? shop.type : u.role, member_role: shop ? shop.member_role : null, lang: u.lang, tutorial_done: !!u.tutorial_done },
      shop, businesses: mems.map((x) => ({ id: x.id, type: x.type, name: x.name, city: x.city, verification: x.verification, member_role: x.member_role })) };
  }
  route('GET', '/api/me', 'any', async (c) => await me(c.user, c.shop && c.shop.id));

  // Switch the business this login acts for (the session remembers it for live updates and the next visit).
  route('POST', '/api/me/business', 'any', async (c) => {
    const id = A.int(c.body.shop_id, 'shop_id', 1, 1e12);
    if (!c.user.businesses || !c.user.businesses.some((b) => b.id === id)) fail(403, 'not_member');
    await q('UPDATE sessions SET active_shop_id=? WHERE id=?').run(id, c.user.session_id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'business_switched', entity: 'shop', entityId: id, ip: c.ip });
    return await me(c.user, id);
  });

  // Add another business to the same login (for example a retailer who also starts wholesaling).
  route('POST', '/api/businesses', 'any', async (c) => {
    if (c.user.role === 'admin') fail(403, 'forbidden');
    if (!A.hit('newbiz:' + c.user.id, 5, 3600000)) fail(429, 'rate_limited');
    if ((c.user.businesses || []).filter((b) => b.member_role === 'owner').length >= 10) fail(400, 'too_many_businesses');
    const b = c.body, type = A.oneOf(b.type, 'type', ['retailer', 'wholesaler']);
    const name = A.str(b.shop_name, 'shop_name', 2, 80), city = A.str(b.city, 'city', 2, 60);
    let gstin = null;
    if (type === 'wholesaler') {
      if (!b.gstin) fail(400, 'gstin_required');
      const g = GST.validate(b.gstin); if (!g.ok) fail(400, 'invalid_gstin');
      gstin = g.gstin;
      if ((await q('SELECT 1 FROM shops WHERE gstin=? AND type=?').get(gstin, 'wholesaler'))) fail(409, 'gstin_taken');
    }
    const sid = await tx(db, async () => {
      const id = Number((await q('INSERT INTO shops(owner_id,type,name,city,gstin,verification,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(c.user.id, type, name, city, gstin, type === 'retailer' ? 'approved' : 'pending', now())).lastInsertRowid);
      await q("INSERT INTO memberships(user_id,shop_id,role,added_by,created_at) VALUES(?,?,'owner',?,?)").run(c.user.id, id, c.user.id, now());
      await q('UPDATE sessions SET active_shop_id=? WHERE id=?').run(id, c.user.session_id);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'business_created', entity: 'shop', entityId: id, detail: type + ' ' + name, ip: c.ip });
      return id;
    });
    return await me(c.user, sid);
  });

  // Team: owners add or remove managers and staff (people who already have a StockLink login).
  route('GET', '/api/b/members', 'any', async (c) => {
    if (!c.shop) fail(403, 'forbidden'); A.need(c.user, 'team');
    return { members: (await q(`SELECT u.id, u.name, u.phone, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.shop_id = ? ORDER BY m.id`).all(c.shop.id)) };
  });
  route('POST', '/api/b/members', 'any', async (c) => {
    if (!c.shop) fail(403, 'forbidden'); A.need(c.user, 'team');
    if (!A.hit('team:' + c.user.id, 20, 3600000)) fail(429, 'rate_limited');
    const role = A.oneOf(c.body.role, 'role', ['manager', 'staff']), phone = phoneOf(c.body.phone);
    const u = await q('SELECT id, name, role, status FROM users WHERE phone=?').get(phone);
    if (!u || u.status !== 'active' || u.role === 'admin') fail(404, 'user_not_found');
    if ((await q('SELECT 1 FROM memberships WHERE user_id=? AND shop_id=?').get(u.id, c.shop.id))) fail(409, 'already_member');
    if (c.shop.type === 'wholesaler') { const a = await ctx.plans.access(c.shop.id); const max = a.sub ? a.sub.max_staff : null;
      if (max != null && Number((await q("SELECT COUNT(*) n FROM memberships WHERE shop_id=? AND role<>'owner'").get(c.shop.id)).n) >= max) fail(403, 'plan_limit', { what: 'staff', max }); }
    await q('INSERT INTO memberships(user_id,shop_id,role,added_by,created_at) VALUES(?,?,?,?,?)').run(u.id, c.shop.id, role, c.user.id, now());
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'member_added', entity: 'shop', entityId: c.shop.id, detail: role + ' user ' + u.id, ip: c.ip });
    return { ok: true, member: { id: u.id, name: u.name, role } };
  });
  route('POST', '/api/b/members/:id/remove', 'any', async (c) => {
    if (!c.shop) fail(403, 'forbidden'); A.need(c.user, 'team');
    const uid = Number(c.params.id);
    const m = await q('SELECT role FROM memberships WHERE user_id=? AND shop_id=?').get(uid, c.shop.id);
    if (!m) fail(404, 'not_found');
    if (m.role === 'owner') fail(400, 'cannot_remove_owner');
    await q('DELETE FROM memberships WHERE user_id=? AND shop_id=?').run(uid, c.shop.id);
    await q('UPDATE sessions SET active_shop_id=NULL WHERE user_id=? AND active_shop_id=?').run(uid, c.shop.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'member_removed', entity: 'shop', entityId: c.shop.id, detail: 'user ' + uid, ip: c.ip });
    return { ok: true };
  });
  // Delete my account (Play Store policy + blueprint privacy rules). Orders stay as business records for the other side,
  // but the person's name, phone and login are removed and every shop they own is closed. Cannot be undone.
  route('POST', '/api/me/delete', 'any', async (c) => {
    if (c.user.role === 'admin') fail(403, 'admin_cannot_delete');
    if (!A.hit('delete:' + c.user.id, 5, 600000)) fail(429, 'rate_limited');
    if (String(c.body.confirm || '').trim().toUpperCase() !== 'DELETE') fail(400, 'confirm_required');
    const u0 = await q('SELECT * FROM users WHERE id=?').get(c.user.id);
    if (!(await A.verifyPassword(typeof c.body.password === 'string' ? c.body.password.slice(0, 128) : '', u0.pass_hash))) fail(401, 'wrong_password');
    const owned = (await q('SELECT id, type, name FROM shops WHERE owner_id=?').all(u0.id)).map((s) => ({ ...s, id: Number(s.id) }));
    const ids = owned.map((s) => s.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const open = Number((await q(`SELECT COUNT(*) n FROM orders WHERE status IN ('received','paid','packed','dispatched') AND (wholesaler_shop_id IN (${ph}) OR retailer_shop_id IN (${ph}))`).get(...ids, ...ids)).n);
      if (open > 0) fail(409, 'open_orders', { n: open });
    }
    const t = now();
    await tx(db, async () => {
      for (const s of owned) {
        await q("UPDATE shops SET verification='suspended', reject_reason='Account deleted', upi_id=NULL WHERE id=?").run(s.id);
        await q("UPDATE connections SET status='revoked', decided_at=? WHERE (wholesaler_shop_id=? OR retailer_shop_id=?) AND status IN ('pending','approved')").run(t, s.id, s.id);
        if (s.type === 'wholesaler') {
          await q("UPDATE products SET status='archived' WHERE shop_id=?").run(s.id);
          await q('UPDATE invite_codes SET revoked_at=? WHERE shop_id=? AND revoked_at IS NULL').run(t, s.id);
        }
        await q('DELETE FROM memberships WHERE shop_id=?').run(s.id);
      }
      await q('DELETE FROM memberships WHERE user_id=?').run(u0.id);
      await q('DELETE FROM sessions WHERE user_id=?').run(u0.id);
      await q('DELETE FROM push_subs WHERE user_id=?').run(u0.id);
      await q('DELETE FROM notifications WHERE user_id=?').run(u0.id);
      // The phone number is freed so the person can sign up again later; the old login can never work again.
      await q("UPDATE users SET name='Deleted user', phone=?, pass_hash=?, status='suspended', deleted_at=?, totp_secret=NULL, totp_on=0 WHERE id=?")
        .run('deleted-' + u0.id + '-' + A.newToken().slice(0, 8), await A.hashPassword(A.newToken()), t, u0.id);
      await audit(db, { actorId: u0.id, actorLabel: 'Deleted user #' + u0.id, action: 'account_deleted', entity: 'user', entityId: u0.id, detail: owned.length + ' shop(s) closed', ip: c.ip });
    });
    for (const s of owned) emit({ kind: 'catalog', wid: s.id, scope: 'catalog', data: {} });
    c.res.setHeader('Set-Cookie', `sl_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cfg.prod ? '; Secure' : ''}`);
    return { ok: true };
  });
  route('POST', '/api/me/prefs', 'any', async (c) => {
    if (c.body.lang !== undefined) (await q('UPDATE users SET lang=? WHERE id=?').run(A.oneOf(c.body.lang, 'lang', ['en', 'hi']), c.user.id));
    if (c.body.tutorial_done !== undefined) (await q('UPDATE users SET tutorial_done=? WHERE id=?').run(c.body.tutorial_done ? 1 : 0, c.user.id));
    return { ok: true };
  });
};
