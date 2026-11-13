'use strict';
// Notification feed and phone (Web Push) subscriptions for the signed-in user.
const A = require('../lib/auth');
const { fail } = A;

module.exports = function registerNotify(ctx, route) {
  const { q, notify, now } = ctx;

  route('GET', '/api/notifications', 'any', async (c) => {
    const items = await q('SELECT id,kind,title,body,tab,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(c.user.id);
    const unread = (await q('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(c.user.id)).n;
    return { items, unread: Number(unread) };
  });
  route('POST', '/api/notifications/read', 'any', async (c) => {
    await q('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), c.user.id);
    return { ok: true };
  });

  route('GET', '/api/push/key', 'any', async () => ({ key: notify.publicKey }));
  route('POST', '/api/push/subscribe', 'any', async (c) => {
    const b = c.body, keys = (b && typeof b.keys === 'object' && b.keys) || {};
    if (!notify.publicKey) fail(503, 'push_unavailable');
    if (!notify.allowedEndpoint(b.endpoint)) fail(400, 'invalid_subscription');
    for (const [k, max] of [['p256dh', 200], ['auth', 60]]) {
      if (typeof keys[k] !== 'string' || keys[k].length < 8 || keys[k].length > max || !notify.B64URL.test(keys[k])) fail(400, 'invalid_subscription');
    }
    if (!A.hit('push-sub:' + c.user.id, 20, 3600000)) fail(429, 'rate_limited');
    // A device's subscription belongs to whoever is signed in on it now.
    await q('DELETE FROM push_subs WHERE endpoint=?').run(b.endpoint);
    await q('INSERT INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)').run(c.user.id, b.endpoint, keys.p256dh, keys.auth, now());
    // at most 5 phones/browsers per user
    const extra = await q('SELECT id FROM push_subs WHERE user_id=? ORDER BY id DESC LIMIT 100 OFFSET 5').all(c.user.id);
    for (const r of extra) await q('DELETE FROM push_subs WHERE id=?').run(r.id);
    return { ok: true };
  });
  route('POST', '/api/push/unsubscribe', 'any', async (c) => {
    if (typeof c.body.endpoint === 'string') await q('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(c.body.endpoint, c.user.id);
    return { ok: true };
  });
  route('POST', '/api/push/test', 'any', async (c) => {
    if (!A.hit('push-test:' + c.user.id, 5, 600000)) fail(429, 'rate_limited');
    notify.user(c.user.id, 'test', {}, null);
    return { ok: true };
  });
};
