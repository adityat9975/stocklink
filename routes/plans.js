'use strict';
// Super Admin: plans, assigning them to wholesalers, recording payments, suspension. Wholesaler: own plan state.
// No automatic charge: a period is extended only when Super Admin records a payment reference (blueprint 6.3).
const A = require('../lib/auth');
const TOTP = require('../lib/totp');
const { tx, audit } = require('../lib/db');
const { fail } = A;
const DAY = 86400000;

module.exports = function registerPlans(ctx, route) {
  const { db, q, now, plans, notify, rupeesToPaise } = ctx;
  const optInt = (v, name, lo, hi) => (v === undefined || v === null || v === '' ? null : A.int(v, name, lo, hi));
  const planIn = (b, old = {}) => ({
    name: b.name !== undefined ? A.str(b.name, 'name', 2, 40) : old.name,
    description: b.description !== undefined ? A.str(b.description, 'description', 0, 200) : (old.description || ''),
    price_paise: b.price !== undefined ? (b.price === null || b.price === '' ? null : rupeesToPaise(b.price)) : old.price_paise ?? null,
    period_days: b.period_days !== undefined ? A.int(b.period_days, 'period_days', 1, 3660) : (old.period_days || 30),
    trial_days: b.trial_days !== undefined ? A.int(b.trial_days, 'trial_days', 0, 365) : (old.trial_days || 0),
    grace_days: b.grace_days !== undefined ? A.int(b.grace_days, 'grace_days', 0, 90) : (old.grace_days ?? 7),
    max_products: b.max_products !== undefined ? optInt(b.max_products, 'max_products', 1, 1e6) : old.max_products ?? null,
    max_retailers: b.max_retailers !== undefined ? optInt(b.max_retailers, 'max_retailers', 1, 1e6) : old.max_retailers ?? null,
    max_staff: b.max_staff !== undefined ? optInt(b.max_staff, 'max_staff', 0, 1000) : old.max_staff ?? null,
  });
  const event = (shopId, kind, detail, c) => q('INSERT INTO subscription_events(shop_id,kind,detail,actor_user_id,ts) VALUES(?,?,?,?,?)').run(shopId, kind, detail || null, c.user.id, now());
  const reasonOf = (b) => A.str(b.reason, 'reason', 3, 200);

  route('GET', '/api/admin/plans', 'admin', async () => ({ plans: await q('SELECT * FROM plans ORDER BY status, id').all() }));
  route('POST', '/api/admin/plans', 'admin', async (c) => {
    const p = planIn(c.body);
    const id = Number((await q('INSERT INTO plans(name,description,price_paise,period_days,trial_days,grace_days,max_products,max_retailers,max_staff,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(p.name, p.description, p.price_paise, p.period_days, p.trial_days, p.grace_days, p.max_products, p.max_retailers, p.max_staff, 'active', now(), now())).lastInsertRowid);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_created', entity: 'plan', entityId: id, detail: JSON.stringify(p), ip: c.ip });
    return { id };
  });
  route('POST', '/api/admin/plans/:id', 'admin', async (c) => {
    const old = await q('SELECT * FROM plans WHERE id=?').get(Number(c.params.id)); if (!old) fail(404, 'not_found');
    const p = planIn(c.body, old), status = c.body.status !== undefined ? A.oneOf(c.body.status, 'status', ['active', 'paused', 'retired']) : old.status;
    // Changing a plan never rewrites periods already granted; it applies from the next payment or assignment.
    await q('UPDATE plans SET name=?,description=?,price_paise=?,period_days=?,trial_days=?,grace_days=?,max_products=?,max_retailers=?,max_staff=?,status=?,updated_at=? WHERE id=?')
      .run(p.name, p.description, p.price_paise, p.period_days, p.trial_days, p.grace_days, p.max_products, p.max_retailers, p.max_staff, status, now(), old.id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_updated', entity: 'plan', entityId: old.id, detail: status + ' ' + JSON.stringify(p), ip: c.ip });
    return { ok: true };
  });

  route('GET', '/api/admin/subscriptions', 'admin', async () => {
    const rows = await q(`SELECT s.id AS shop_id, s.name, s.city, s.verification, u.phone, sub.plan_id, sub.kind, sub.paid_until, sub.grace_days, sub.suspended_at, sub.suspend_reason, sub.cancelled_at, p.name AS plan_name
      FROM shops s JOIN users u ON u.id = s.owner_id LEFT JOIN subscriptions sub ON sub.shop_id = s.id LEFT JOIN plans p ON p.id = sub.plan_id
      WHERE s.type = 'wholesaler' ORDER BY s.name LIMIT 500`).all();
    return { shops: rows.map((r) => ({ shop_id: r.shop_id, name: r.name, city: r.city, phone: r.phone, verification: r.verification, plan_id: r.plan_id, plan_name: r.plan_name,
      ...plans.stateOf(r.plan_id ? { kind: r.kind, paid_until: r.paid_until, grace_days: r.grace_days, suspended_at: r.suspended_at, suspend_reason: r.suspend_reason, cancelled_at: r.cancelled_at } : null) })) };
  });

  const wholesaler = async (id) => { const s = await q("SELECT id, name FROM shops WHERE id=? AND type='wholesaler'").get(Number(id)); if (!s) fail(404, 'not_found'); return s; };

  // Put a wholesaler on a plan: as a trial (plan's trial days) or paid (needs the payment reference you received).
  route('POST', '/api/admin/shops/:id/plan', 'admin', async (c) => {
    const s = await wholesaler(c.params.id), b = c.body;
    const plan = await q("SELECT * FROM plans WHERE id=? AND status='active'").get(A.int(b.plan_id, 'plan_id', 1, 1e9)); if (!plan) fail(404, 'plan_not_found');
    const start = A.oneOf(b.start, 'start', ['trial', 'paid']);
    if (start === 'trial' && !plan.trial_days) fail(400, 'plan_has_no_trial');
    const ref = start === 'paid' ? A.str(b.reference, 'reference', 3, 80) : null;
    const until = now() + (start === 'trial' ? plan.trial_days : plan.period_days) * DAY;
    await tx(db, async () => {
      await q('DELETE FROM subscriptions WHERE shop_id=?').run(s.id);
      await q('INSERT INTO subscriptions(shop_id,plan_id,kind,paid_until,grace_days,started_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(s.id, plan.id, start, until, plan.grace_days, now(), now());
      await event(s.id, 'assigned', `${plan.name} ${start}${ref ? ' ref ' + ref : ''} until ${new Date(until).toISOString().slice(0, 10)}`, c);
      await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_assigned', entity: 'shop', entityId: s.id, detail: `${plan.name} ${start}${ref ? ' ref ' + ref : ''}`, ip: c.ip });
    });
    notify.shop(s.id, 'plan_changed', { plan: plan.name }, 'today');
    return { ok: true, paid_until: until };
  });
  // A payment the wholesaler made (UPI/bank/cash): adds one period from today or from the current end, whichever is later.
  route('POST', '/api/admin/shops/:id/payment', 'admin', async (c) => {
    const s = await wholesaler(c.params.id), ref = A.str(c.body.reference, 'reference', 3, 80);
    const sub = await plans.subOf(s.id); if (!sub) fail(409, 'no_plan');
    const until = Math.max(now(), Number(sub.paid_until)) + Number(sub.period_days) * DAY;
    await q('UPDATE subscriptions SET kind=?, paid_until=?, cancelled_at=NULL, updated_at=? WHERE shop_id=?').run('paid', until, now(), s.id);
    await event(s.id, 'payment', `ref ${ref}, until ${new Date(until).toISOString().slice(0, 10)}`, c);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_payment_recorded', entity: 'shop', entityId: s.id, detail: 'ref ' + ref, ip: c.ip });
    notify.shop(s.id, 'plan_renewed', { date: new Date(until).toLocaleDateString('en-IN') }, 'today');
    return { ok: true, paid_until: until };
  });
  route('POST', '/api/admin/shops/:id/subscription/suspend', 'admin', async (c) => {
    const s = await wholesaler(c.params.id), reason = reasonOf(c.body);
    const r = await q('UPDATE subscriptions SET suspended_at=?, suspend_reason=?, updated_at=? WHERE shop_id=? AND suspended_at IS NULL').run(now(), reason, now(), s.id);
    if (r.changes !== 1) fail(409, 'bad_state');
    await event(s.id, 'suspended', reason, c);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_suspended', entity: 'shop', entityId: s.id, detail: reason, ip: c.ip });
    return { ok: true };
  });
  route('POST', '/api/admin/shops/:id/subscription/resume', 'admin', async (c) => {
    const s = await wholesaler(c.params.id), reason = reasonOf(c.body);
    const r = await q('UPDATE subscriptions SET suspended_at=NULL, suspend_reason=NULL, updated_at=? WHERE shop_id=? AND suspended_at IS NOT NULL').run(now(), s.id);
    if (r.changes !== 1) fail(409, 'bad_state');
    await event(s.id, 'resumed', reason, c);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: 'plan_resumed', entity: 'shop', entityId: s.id, detail: reason, ip: c.ip });
    return { ok: true };
  });

  // Wholesaler: own plan and history.
  route('GET', '/api/w/plan', 'wholesaler', async (c) => {
    const acc = await plans.access(c.shop.id);
    const events = await q('SELECT kind, detail, ts FROM subscription_events WHERE shop_id=? ORDER BY id DESC LIMIT 20').all(c.shop.id);
    const s = acc.sub;
    return { state: acc.state, days_left: acc.days_left, until: acc.until || null, reason: acc.reason || null,
      plan: s ? { name: s.plan_name, max_products: s.max_products, max_retailers: s.max_retailers, max_staff: s.max_staff } : null, events };
  });

  // Super Admin two-factor setup: generate a secret (shown once), then confirm with a 6-digit code.
  route('GET', '/api/admin/2fa', 'admin', async (c) => {
    const u = await q('SELECT totp_secret, totp_on, phone FROM users WHERE id=?').get(c.user.id);
    if (u.totp_on) return { on: true };
    let secret = u.totp_secret;
    if (!secret) { secret = TOTP.newSecret(); await q('UPDATE users SET totp_secret=? WHERE id=?').run(secret, c.user.id); }
    return { on: false, secret, uri: TOTP.uri(secret, u.phone) };
  });
  route('POST', '/api/admin/2fa/enable', 'admin', async (c) => {
    if (!A.hit('2fa:' + c.user.id, 10, 600000)) fail(429, 'rate_limited');
    const u = await q('SELECT totp_secret, totp_on FROM users WHERE id=?').get(c.user.id);
    if (u.totp_on) fail(409, 'bad_state');
    if (!TOTP.verify(u.totp_secret, String(c.body.otp || ''))) fail(400, 'invalid_otp');
    await q('UPDATE users SET totp_on=1 WHERE id=?').run(c.user.id);
    await q('UPDATE sessions SET mfa_ok=1 WHERE id=?').run(c.user.session_id);
    await audit(db, { actorId: c.user.id, actorLabel: c.user.name, action: '2fa_enabled', entity: 'user', entityId: c.user.id, ip: c.ip });
    return { ok: true };
  });
};
