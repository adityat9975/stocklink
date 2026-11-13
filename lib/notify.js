'use strict';
// Notifications: stored in-app feed + live SSE ping + Web Push to phones (works when the app is closed).
// web-push is optional at runtime: without it (npm install not run) the app still starts; only phone alerts are off.
let webpush = null;
try { webpush = require('web-push'); } catch (_) { webpush = null; }
const isUnique = (e) => !!e && (e.code === '23505' || /UNIQUE constraint/i.test(String(e.message)));

// Server-side text, in the receiving user's language. {x} placeholders are filled from vars.
const MSG = {
  en: {
    order_new: ['New order {no}', '{shop} ordered {total}. Tap to confirm.'],
    payment_sent: ['Payment to verify', '{shop} sent UTR for {no} ({total}).'],
    conn_request: ['New retailer request', '{shop} wants to see your stock.'],
    order_cancelled_r: ['Order {no} cancelled', '{shop} cancelled the order.'],
    order_status: ['Order {no}: {status}', '{shop} updated your order.'],
    order_cancelled_w: ['Order {no} cancelled', '{shop} cancelled your order. {reason}'],
    conn_approved: ['You are connected', '{shop} approved you. Their stock is open to you now.'],
    product_new: ['New at {shop}', '{name} is now available.'],
    back_in_stock: ['Back in stock at {shop}', '{name}: {n} available.'],
    shop_verified: ['Your shop is verified', 'Retailers you approve can now see your stock.'],
    test: ['Notifications are on', 'You will get order and stock alerts on this phone.'],
    chat_msg: ['Message from {shop}', '{text}'],
    plan_changed: ['Your plan: {plan}', 'Open StockLink to see your plan and dates.'],
    plan_renewed: ['Plan renewed', 'Thank you. Your plan now runs until {date}.'],
    s_paid: 'payment confirmed', s_packed: 'packed', s_dispatched: 'on the way', s_ready: 'ready for pickup', s_completed: 'completed',
  },
  hi: {
    order_new: ['Naya order {no}', '{shop} ne {total} ka order diya. Confirm karne ke liye tap karein.'],
    payment_sent: ['Payment check karein', '{shop} ne {no} ({total}) ka UTR bheja.'],
    conn_request: ['Naya retailer request', '{shop} aapka stock dekhna chahte hain.'],
    order_cancelled_r: ['Order {no} cancel', '{shop} ne order cancel kiya.'],
    order_status: ['Order {no}: {status}', '{shop} ne aapka order update kiya.'],
    order_cancelled_w: ['Order {no} cancel', '{shop} ne aapka order cancel kiya. {reason}'],
    conn_approved: ['Aap jud gaye', '{shop} ne aapko approve kiya. Ab unka stock dikhega.'],
    product_new: ['{shop} par naya maal', '{name} ab available hai.'],
    back_in_stock: ['{shop} par stock wapas', '{name}: {n} available.'],
    shop_verified: ['Aapki dukaan verified hai', 'Aapke approve kiye retailer ab stock dekh sakte hain.'],
    test: ['Notifications chalu hain', 'Is phone par order aur stock alert aayenge.'],
    chat_msg: ['{shop} ka message', '{text}'],
    plan_changed: ['Aapka plan: {plan}', 'Plan aur tareekh dekhne ke liye StockLink kholiye.'],
    plan_renewed: ['Plan renew ho gaya', 'Dhanyavaad. Aapka plan ab {date} tak chalega.'],
    s_paid: 'payment confirm', s_packed: 'pack ho gaya', s_dispatched: 'raste mein', s_ready: 'pickup ke liye taiyaar', s_completed: 'poora hua',
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : String(v[k]))).trim();

// Only real browser push services may be stored, so the server can never be made to POST to an arbitrary URL (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
function allowedEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 1000) return false;
  let u; try { u = new URL(raw); } catch (_) { return false; }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function createNotifier({ db, cfg, clients }) {
  const q = (sql) => db.q(sql);
  const n = {
    publicKey: null,
    send: (sub, payload, opts) => (webpush ? webpush.sendNotification(sub, payload, opts) : Promise.resolve()), // replaced in tests
    allowedEndpoint, B64URL,
  };

  // VAPID keys: from env if given, else generated once and kept in the database (same keys on every restart/instance).
  n.init = async () => {
    if (!webpush) { console.warn('Phone alerts are off: run "npm install" in the StockLink folder, then restart.'); return; }
    let pub = cfg.vapid && cfg.vapid.publicKey, priv = cfg.vapid && cfg.vapid.privateKey;
    if (!pub || !priv) {
      const row = await q("SELECT v FROM settings WHERE k='vapid'").get();
      if (row) ({ pub, priv } = JSON.parse(row.v));
      else {
        const k = webpush.generateVAPIDKeys();
        try { await q("INSERT INTO settings(k,v) VALUES('vapid',?)").run(JSON.stringify({ pub: k.publicKey, priv: k.privateKey })); ({ pub, priv } = { pub: k.publicKey, priv: k.privateKey }); }
        catch (e) { if (!isUnique(e)) throw e; ({ pub, priv } = JSON.parse((await q("SELECT v FROM settings WHERE k='vapid'").get()).v)); }
      }
    }
    webpush.setVapidDetails((cfg.vapid && cfg.vapid.subject) || 'mailto:admin@stocklink.app', pub, priv);
    n.publicKey = pub;
  };

  async function toUser(userId, key, vars = {}, tab = null) {
    const u = await q("SELECT id, lang, status FROM users WHERE id=?").get(userId);
    if (!u || u.status !== 'active') return;
    const m = MSG[u.lang] || MSG.en, base = m[key] || MSG.en[key];
    const v = { ...vars }; if (v.status) v.status = m['s_' + v.status] || v.status;
    const title = fill(base[0], v).slice(0, 120), body = fill(base[1], v).slice(0, 240), ts = Date.now();
    const id = Number((await q('INSERT INTO notifications(user_id,kind,title,body,tab,created_at) VALUES(?,?,?,?,?,?)').run(userId, key, title, body, tab, ts)).lastInsertRowid);
    // keep the feed small: last 100 per user
    const cut = await q('SELECT id FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1 OFFSET 100').get(userId);
    if (cut) await q('DELETE FROM notifications WHERE user_id=? AND id<=?').run(userId, cut.id);
    const data = { id, title, body, tab, ts };
    const line = `event: notify\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) if (c.userId === userId) { try { c.res.write(line); } catch (_) { /* closed */ } }
    const subs = await q('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id=?').all(userId);
    await Promise.all(subs.map(async (s) => {
      try {
        await n.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(data), { TTL: 43200, timeout: 5000, urgency: key.startsWith('order') || key === 'payment_sent' ? 'high' : 'normal' });
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await q('DELETE FROM push_subs WHERE id=?').run(s.id); // phone unsubscribed
        else console.error('push failed', e && (e.statusCode || e.message));
      }
    }));
  }

  // Fire-and-forget wrappers: a notification problem must never fail the business action that caused it.
  const later = (p) => { p.catch((e) => console.error('notify error', e.message)); };
  n.user = (userId, key, vars, tab) => later(toUser(userId, key, vars, tab));
  n.shop = (shopId, key, vars, tab) => later((async () => {
    for (const m of await q('SELECT user_id FROM memberships WHERE shop_id=?').all(shopId)) await toUser(m.user_id, key, vars, tab);
  })());
  // every retailer approved by this (verified) wholesaler
  n.retailersOf = (wid, key, vars, tab) => later((async () => {
    const rows = await q(`SELECT DISTINCT m.user_id FROM connections c JOIN shops w ON w.id=c.wholesaler_shop_id JOIN memberships m ON m.shop_id=c.retailer_shop_id
      WHERE c.wholesaler_shop_id=? AND c.status='approved' AND w.verification='approved'`).all(wid);
    for (const r of rows) await toUser(r.user_id, key, vars, tab);
  })());
  n.money = (p) => (cfg.currency || '₹') + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  n.MSG = MSG;
  return n;
}

module.exports = { createNotifier, allowedEndpoint };
