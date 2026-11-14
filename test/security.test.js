'use strict';
// Run: npm test   (starts its own server on a temp DB, no network needed)
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-sec-'));
const { createApp, loadConfig } = require('../server');
const A = require('../lib/auth');
const { verifyAudit } = require('../lib/db');
const cfg = loadConfig({ DB_PATH: path.join(dir, 't.db'), DEMO_MODE: '1', PORT: '0', HOST: '127.0.0.1', SESSION_SECRET: 'test-secret-' + 'x'.repeat(32) });
const PW = 'Demo@1234', PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; failures.push(m); console.log('  FAIL ' + m); } };
let base;
async function call(method, url, { body, jar, headers, raw, noCsrf } = {}) {
  const h = { ...(noCsrf ? {} : { 'X-Requested-With': 'StockLink' }), ...(headers || {}) };
  if (jar && jar.c) h.Cookie = jar.c;
  if (body !== undefined && !raw) { h['Content-Type'] = 'application/json'; }
  const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (jar && sc) jar.c = sc.split(';')[0];
  let j = null; const ct = r.headers.get('content-type') || ''; if (ct.includes('json')) { try { j = await r.json(); } catch (_) {} } else await r.arrayBuffer();
  return { s: r.status, j, h: r.headers, sc };
}
async function login(phone, pw = PW) { A.resetLimits(); const jar = {}; const r = await call('POST', '/api/login', { body: { phone, password: pw }, jar }); if (r.s !== 200) throw new Error('login ' + phone + ' ' + r.s); return jar; }
const sec = (n) => console.log('\n' + n);

(async () => {
  if (process.env.TEST_DATABASE_URL) { const { Pool } = require('pg'); const p = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: /localhost|127\.0\.0\.1|host=\//.test(process.env.TEST_DATABASE_URL) ? false : { rejectUnauthorized: false } }); await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await p.end(); cfg.databaseUrl = process.env.TEST_DATABASE_URL; console.log('Running against Postgres'); }
  const app = await createApp(cfg); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
  const seed = require('../lib/demo'); await seed.seedDemoIfEmpty(app.db, cfg);
    const sharma = await login('9000000002'), rahul = await login('9000000004'), kul = await login('9000000006'), verma = await login('9000000005'), admin = await login('9000000001'), patel = await login('9000000003');
  const WID = (await app.db.q("SELECT id FROM shops WHERE name='Sharma Traders'").get()).id;
  const prodRow = async (n) => (await app.db.q('SELECT * FROM products WHERE name LIKE ?').get(n + '%'));

  sec('0b. Admin dashboard and Ask');
  {
    A.resetLimits();
    await call('GET', '/api/me', { jar: rahul });
    const d = await call('GET', '/api/admin/dashboard?range=24h', { jar: admin });
    ok(d.s === 200 && d.j.active.total >= 1 && typeof d.j.orders.value === 'number' && Array.isArray(d.j.series) && d.j.series.length > 0, 'admin dashboard returns active people, orders and a time series');
    ok((await call('GET', '/api/admin/dashboard?range=all', { jar: admin })).j.range === 'all', 'all-time range works');
    ok((await call('GET', '/api/admin/dashboard?range=evil', { jar: admin })).j.range === '24h', 'unknown range falls back to 24 hours');
    ok((await call('GET', '/api/admin/dashboard', { jar: sharma })).s === 403, 'wholesaler cannot open the admin dashboard');
    ok((await call('GET', '/api/admin/dashboard', {})).s === 401, 'logged-out user cannot open the admin dashboard');
    const a1 = await call('POST', '/api/admin/ask', { jar: admin, body: { q: 'total orders of Rahul Auto Spares in last 4 months' } });
    ok(a1.s === 200 && /Rahul Auto Spares/.test(a1.j.text) && /last 4 months/.test(a1.j.text) && a1.j.table && a1.j.table.cols[0] === 'Wholesaler', 'Ask: retailer orders split by wholesaler for a time window');
    const a2 = await call('POST', '/api/admin/ask', { jar: admin, body: { q: 'Sharma Traders ke pichhle 2 hafte ke order' } });
    ok(a2.s === 200 && /Sharma Traders/.test(a2.j.text) && /last 2 weeks/.test(a2.j.text), 'Ask: Hinglish question with a wholesaler name');
    const a3 = await call('POST', '/api/admin/ask', { jar: admin, body: { q: "'; DROP TABLE orders; --" } });
    ok(a3.s === 200 && (await app.db.q('SELECT COUNT(*) n FROM orders').get()).n > 0, 'Ask cannot run SQL from the question');
    ok((await call('POST', '/api/admin/ask', { jar: rahul, body: { q: 'top wholesalers' } })).s === 403, 'retailer cannot use the admin assistant');
    ok((await call('POST', '/api/admin/ask', { jar: admin, body: { q: 'x'.repeat(301) } })).s === 400, 'over-long question refused');
    ok((await app.db.q("SELECT last_seen_at FROM users WHERE phone='9000000004'").get()).last_seen_at > 0, 'last active time is recorded');
    A.resetLimits();
  }

  sec('0c. Product categories and wholesaler home');
  {
    A.resetLimits();
    const cp = await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Denim jeans 32', price: 650, on_hand: 20, category: '  Jeans ' } });
    ok(cp.s === 200, 'wholesaler adds a product with a category');
    const pid = cp.j.id || (await app.db.q("SELECT id FROM products WHERE name='Denim jeans 32'").get()).id;
    const cat = await call('GET', '/api/r/catalog/' + WID, { jar: rahul });
    ok(cat.j.products.find((p) => p.id === pid).category === 'Jeans', 'retailer catalog shows the trimmed category');
    ok((await call('POST', '/api/w/products/' + pid + '/update', { jar: sharma, body: { category: 'Denim' } })).s === 200 && (await app.db.q('SELECT category FROM products WHERE id=?').get(pid)).category === 'Denim', 'category can be changed later');
    ok((await call('POST', '/api/w/products/' + pid + '/update', { jar: sharma, body: { category: 'x'.repeat(31) } })).s === 400, 'over-long category refused');
    ok((await call('POST', '/api/w/products/' + pid + '/update', { jar: patel, body: { category: 'Hack' } })).s === 404, 'another wholesaler cannot change the category');
    const d = await call('GET', '/api/w/dashboard', { jar: sharma });
    ok(d.s === 200 && d.j.collect && typeof d.j.collect.total === 'number' && Array.isArray(d.j.top_products) && Array.isArray(d.j.top_retailers) && d.j.week.length === 7, 'wholesaler home returns money to collect, best sellers, top retailers');
    await app.db.q("UPDATE products SET status='archived' WHERE id=?").run(pid);
    A.resetLimits();
  }

  sec('0d. One login, several businesses (M1)');
  {
    A.resetLimits();
    const GSTL = require('../lib/gstin');
    const g14 = '27ABCDE' + String(Date.now()).slice(-4) + 'F1Z'; const gstin = g14 + GSTL.checkChar(g14);
    const ownerJar = await login('9000000004'); // Rahul: owns a retail shop
    const RET = (await call('GET', '/api/me', { jar: ownerJar })).j.shop.id;
    const nb = await call('POST', '/api/businesses', { jar: ownerJar, body: { type: 'wholesaler', shop_name: 'Rahul Distributors', city: 'Nashik', gstin } });
    ok(nb.s === 200 && nb.j.businesses.length === 2 && nb.j.shop.type === 'wholesaler' && nb.j.user.role === 'wholesaler', 'one login adds a wholesale business and switches to it');
    const WB = nb.j.shop.id;
    ok((await call('GET', '/api/w/products', { jar: ownerJar })).s === 200, 'session now acts as the new wholesale business');
    ok((await call('GET', '/api/r/wholesalers', { jar: ownerJar, headers: { 'X-Business': String(RET) } })).s === 200, 'same login acts as its retail shop when the page names it');
    ok((await call('GET', '/api/w/products', { jar: ownerJar, headers: { 'X-Business': String(WID) } })).s === 403, 'naming a business you are not a member of is refused');
    ok((await call('POST', '/api/me/business', { jar: ownerJar, body: { shop_id: WID } })).s === 403, 'cannot switch to a business you do not belong to');
    const sw = await call('POST', '/api/me/business', { jar: ownerJar, body: { shop_id: RET } });
    ok(sw.s === 200 && sw.j.shop.id === RET && sw.j.user.role === 'retailer', 'switch back to the retail shop');
    // team roles in Sharma Traders
    const staffJar = await login('9000000005'), staffMe = (await call('GET', '/api/me', { jar: staffJar })).j;
    ok((await call('POST', '/api/b/members', { jar: sharma, body: { phone: '9000000005', role: 'staff' } })).s === 200, 'owner adds an existing user as staff');
    ok((await call('POST', '/api/b/members', { jar: sharma, body: { phone: '9000000005', role: 'staff' } })).s === 409, 'same person cannot be added twice');
    ok((await call('POST', '/api/b/members', { jar: sharma, body: { phone: '9999999999', role: 'staff' } })).s === 404, 'unknown phone cannot be added');
    const asStaff = { 'X-Business': String(WID) };
    const spRow = await app.db.q("SELECT id, price_paise FROM products WHERE shop_id=? AND status='active' ORDER BY id LIMIT 1").get(WID), sp = spRow.id;
    ok((await call('GET', '/api/w/orders', { jar: staffJar, headers: asStaff })).s === 200, 'staff can see orders');
    ok((await call('POST', '/api/w/products/' + sp + '/stock', { jar: staffJar, headers: asStaff, body: { delta: 1 } })).s === 200, 'staff can adjust stock');
    ok((await call('POST', '/api/w/products/' + sp + '/update', { jar: staffJar, headers: asStaff, body: { price: 1 } })).s === 403, 'staff cannot change a price');
    ok((await call('POST', '/api/w/invites', { jar: staffJar, headers: asStaff, body: {} })).s === 403, 'staff cannot create invite codes');
    ok((await call('POST', '/api/w/options', { jar: staffJar, headers: asStaff, body: { allow_cash: false } })).s === 403, 'staff cannot change payment options');
    ok((await call('GET', '/api/b/members', { jar: staffJar, headers: asStaff })).s === 403, 'staff cannot see or change the team');
    ok((await call('GET', '/api/me', { jar: staffJar })).j.businesses.length === staffMe.businesses.length + 1, 'staff sees the new business in the switcher');
    const verUid = (await app.db.q("SELECT id FROM users WHERE phone='9000000005'").get()).id;
    await app.db.q("UPDATE memberships SET role='manager' WHERE user_id=? AND shop_id=?").run(verUid, WID);
    ok((await call('POST', '/api/w/products/' + sp + '/update', { jar: staffJar, headers: asStaff, body: { price: 2 } })).s === 200, 'manager can change a price');
    ok((await call('POST', '/api/w/options', { jar: staffJar, headers: asStaff, body: { allow_cash: true } })).s === 403, 'manager cannot change owner-only settings');
    const sharmaUid = (await app.db.q("SELECT owner_id FROM shops WHERE id=?").get(WID)).owner_id;
    ok((await call('POST', '/api/b/members/' + sharmaUid + '/remove', { jar: sharma, body: {} })).s === 400, 'the owner cannot be removed');
    ok((await call('POST', '/api/b/members/' + verUid + '/remove', { jar: sharma, body: {} })).s === 200, 'owner removes a team member');
    ok((await call('GET', '/api/w/orders', { jar: staffJar, headers: asStaff })).s === 403, 'removed member loses access at once');
    // restore fixture: price back, Rahul's extra business closed off
    await app.db.q('UPDATE products SET price_paise=? WHERE id=?').run(spRow.price_paise, sp);
    await call('POST', '/api/me/business', { jar: rahul, body: { shop_id: RET } });
    A.resetLimits();
  }

  sec('0e. Single-use invitation codes (M2)');
  {
    A.resetLimits();
    const made = await call('POST', '/api/w/invites', { jar: sharma, body: { max_uses: 50, days: 2 } });
    ok(made.s === 200, 'wholesaler creates a code');
    ok((await app.db.q("SELECT max_uses FROM invite_codes WHERE shop_id=? ORDER BY id DESC LIMIT 1").get(WID)).max_uses === 1, 'a new code is single-use even if more uses are asked for');
    // 20 fresh retailers redeem the same code at the same moment
    const jars = [];
    await app.db.tx(async () => { for (let i = 0; i < 20; i++) {
      const uid = Number((await app.db.q("INSERT INTO users(phone,name,role,pass_hash,tutorial_done,created_at) VALUES(?,?,?,?,1,?)").run('96000000' + String(10 + i), 'Joiner ' + i, 'retailer', A.hashPasswordSync(PW), Date.now())).lastInsertRowid);
      const sid = Number((await app.db.q("INSERT INTO shops(owner_id,type,name,city,verification,created_at) VALUES(?,?,?,?,?,?)").run(uid, 'retailer', 'Joiner Shop ' + i, 'Pune', 'approved', Date.now())).lastInsertRowid);
      await app.db.q("INSERT INTO memberships(user_id,shop_id,role,created_at) VALUES(?,?,'owner',?)").run(uid, sid, Date.now());
    } });
    for (let i = 0; i < 20; i++) jars.push(await login('96000000' + String(10 + i)));
    A.resetLimits();
    const res = await Promise.all(jars.map((j) => call('POST', '/api/r/join', { jar: j, body: { code: made.j.code } })));
    const wins = res.filter((r) => r.s === 200).length, generic = res.filter((r) => r.s === 400 && r.j.error === 'invalid_code').length;
    ok(wins === 1 && generic === 19, '20 parallel redemptions of one code: exactly 1 connection, 19 get the generic error (' + wins + '/' + generic + ')');
    ok((await app.db.q("SELECT COUNT(*) n FROM connections c JOIN invite_codes i ON i.id=c.invite_code_id WHERE i.shop_id=? AND i.max_uses=1 AND i.id=(SELECT MAX(id) FROM invite_codes WHERE shop_id=?)").get(WID, WID)).n === 1, 'database holds exactly one connection for that code');
    const wrong = await call('POST', '/api/r/join', { jar: jars[0], body: { code: 'ZZZZ-ZZZZ' } });
    ok(wrong.s === 400 && wrong.j.error === 'invalid_code', 'a wrong code and a used code give the same answer');
    const inv = (await call('GET', '/api/w/invites', { jar: sharma })).j.invites[0];
    ok(inv.uses === 1 && inv.active === false, 'the used code shows as used and inactive');
    await app.db.q('DELETE FROM code_attempts').run(); // this section's own 20 attempts would otherwise lock the test IP
    A.resetLimits();
  }

  sec('0f. Plans, trials, grace and admin second factor (M3)');
  {
    A.resetLimits();
    const DAYMS = 86400000;
    const RID3 = (await app.db.q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000004' ORDER BY s.id LIMIT 1").get()).id;
    const PAT = (await app.db.q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000003'").get()).id;
    // Rahul gets a second, unrelated supplier (fixture): Patel, verified and approved
    const patVer = (await app.db.q('SELECT verification FROM shops WHERE id=?').get(PAT)).verification;
    await app.db.q("UPDATE shops SET verification='approved' WHERE id=?").run(PAT);
    await app.db.q("INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,requested_at,decided_at) VALUES(?,?,'approved','request',?,?)").run(PAT, RID3, Date.now(), Date.now());
    ok((await call('GET', '/api/w/plan', { jar: sharma })).j.state === 'none', 'a wholesaler with no plan keeps full access');
    const pl = await call('POST', '/api/admin/plans', { jar: admin, body: { name: 'Pilot', price: null, period_days: 30, trial_days: 14, grace_days: 7, max_products: 500 } });
    ok(pl.s === 200, 'Super Admin creates a plan with no price set');
    ok((await call('POST', '/api/admin/plans', { jar: sharma, body: { name: 'Hack' } })).s === 403, 'a wholesaler cannot create plans');
    ok((await call('POST', '/api/admin/shops/' + WID + '/plan', { jar: admin, body: { plan_id: pl.j.id, start: 'trial' } })).s === 200, 'Super Admin starts a 14-day trial');
    const tr = (await call('GET', '/api/w/plan', { jar: sharma })).j;
    ok(tr.state === 'trial' && tr.days_left === 14 && tr.plan.name === 'Pilot', 'wholesaler sees trial with 14 days left');
    ok((await call('GET', '/api/me', { jar: sharma })).j.shop.plan.state === 'trial', '/api/me carries the plan state for the banner');
    // trial ends -> grace (no charge, no conversion)
    await app.db.q('UPDATE subscriptions SET paid_until=? WHERE shop_id=?').run(Date.now() - 2 * DAYMS, WID);
    const gr = (await call('GET', '/api/w/plan', { jar: sharma })).j;
    ok(gr.state === 'grace' && gr.days_left === 5, 'trial end moves to the 7-day grace period');
    ok((await app.db.q('SELECT kind FROM subscriptions WHERE shop_id=?').get(WID)).kind === 'trial', 'trial is never converted to paid by itself');
    ok((await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).s === 200, 'during grace retailers still see the catalogue');
    // after grace -> expired
    await app.db.q('UPDATE subscriptions SET paid_until=? WHERE shop_id=?').run(Date.now() - 9 * DAYMS, WID);
    ok((await call('GET', '/api/w/plan', { jar: sharma })).j.state === 'expired', 'after grace the plan is expired');
    const cat = await call('GET', '/api/r/catalog/' + WID, { jar: rahul });
    ok(cat.s === 403 && cat.j.error === 'supplier_inactive', 'expired supplier: its catalogue closes for retailers');
    ok((await call('GET', '/api/r/catalog/' + PAT, { jar: rahul })).s === 200, 'the same retailer still sees its other supplier');
    const anyP = (await app.db.q("SELECT id, moq FROM products WHERE shop_id=? AND status='active' AND on_hand-reserved>=moq ORDER BY id LIMIT 1").get(WID));
    const blocked = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: anyP.id, qty: anyP.moq }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'expired-' + Date.now() } });
    ok(blocked.s === 403 && blocked.j.error === 'supplier_inactive', 'no new orders to an expired supplier');
    ok((await call('GET', '/api/r/orders', { jar: rahul })).j.orders.some((o) => o.wholesaler_shop_id === WID), 'old orders with the expired supplier stay visible');
    ok((await call('GET', '/api/w/orders', { jar: sharma })).s === 200, 'expired wholesaler still sees its orders');
    const ws = (await call('GET', '/api/r/wholesalers', { jar: rahul })).j.connections;
    ok(ws.find((x) => x.shop_id === WID).supplier_active === false && ws.find((x) => x.shop_id === PAT).supplier_active === true, 'supplier list marks only the expired supplier as paused');
    ok((await call('POST', '/api/w/invites', { jar: sharma, body: {} })).j.error === 'plan_inactive', 'expired wholesaler cannot make new codes');
    ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'New thing', price: 10, on_hand: 1 } })).j.error === 'plan_inactive', 'expired wholesaler cannot add products');
    ok((await app.db.q('SELECT COUNT(*) n FROM orders WHERE wholesaler_shop_id=?').get(WID)).n > 0, 'expiry deletes nothing');
    // payment recorded -> active again
    ok((await call('POST', '/api/admin/shops/' + WID + '/payment', { jar: admin, body: {} })).s === 400, 'a payment needs a reference');
    const paid = await call('POST', '/api/admin/shops/' + WID + '/payment', { jar: admin, body: { reference: 'UPI 4421 test' } });
    ok(paid.s === 200 && Math.round((paid.j.paid_until - Date.now()) / DAYMS) === 30, 'recorded payment opens a 30-day period from today');
    ok((await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).s === 200, 'catalogue opens again after payment');
    // suspend / resume
    ok((await call('POST', '/api/admin/shops/' + WID + '/subscription/suspend', { jar: admin, body: {} })).s === 400, 'suspension needs a reason');
    ok((await call('POST', '/api/admin/shops/' + WID + '/subscription/suspend', { jar: admin, body: { reason: 'Payment dispute test' } })).s === 200 && (await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).j.error === 'supplier_inactive', 'suspended supplier closes its catalogue');
    ok((await call('POST', '/api/admin/shops/' + WID + '/subscription/resume', { jar: admin, body: { reason: 'Resolved' } })).s === 200 && (await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).s === 200, 'resume reopens it');
    ok((await app.db.q("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('plan_created','plan_assigned','plan_payment_recorded','plan_suspended','plan_resumed')").get()).n >= 5, 'every plan action is in the audit log');
    // product limit
    const cnt = Number((await app.db.q("SELECT COUNT(*) n FROM products WHERE shop_id=? AND status<>'archived'").get(WID)).n);
    await call('POST', '/api/admin/plans/' + pl.j.id, { jar: admin, body: { max_products: cnt } });
    const lim = await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Over limit', price: 10, on_hand: 1 } });
    ok(lim.s === 403 && lim.j.error === 'plan_limit' && lim.j.what === 'products', 'plan product limit is enforced');
    // tidy fixture
    await app.db.q('DELETE FROM subscriptions WHERE shop_id=?').run(WID);
    await app.db.q('DELETE FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=?').run(PAT, RID3);
    await app.db.q('UPDATE shops SET verification=? WHERE id=?').run(patVer, PAT);
    // Super Admin second factor
    const TOTP = require('../lib/totp');
    app.cfg.admin2fa = true;
    const adm2 = await login('9000000001');
    ok((await call('GET', '/api/admin/stats', { jar: adm2 })).j.error === 'mfa_required', 'with 2FA required, admin pages are closed until the second factor is set up');
    ok((await call('GET', '/api/me', { jar: adm2 })).j.user.mfa_needed === true, 'the page is told to show 2FA setup');
    const setup = (await call('GET', '/api/admin/2fa', { jar: adm2 })).j;
    ok(setup.on === false && /^[A-Z2-7]{32}$/.test(setup.secret) && setup.uri.startsWith('otpauth://totp/'), 'setup gives a secret for an authenticator app');
    ok((await call('POST', '/api/admin/2fa/enable', { jar: adm2, body: { otp: '000000' } })).j.error === 'invalid_otp', 'a wrong code does not enable 2FA');
    ok((await call('POST', '/api/admin/2fa/enable', { jar: adm2, body: { otp: TOTP.code(setup.secret, Math.floor(Date.now() / 30000)) } })).s === 200, 'the right code enables 2FA');
    ok((await call('GET', '/api/admin/stats', { jar: adm2 })).s === 200, 'admin pages open after the second factor');
    A.resetLimits();
    const noOtp = await call('POST', '/api/login', { body: { phone: '9000000001', password: PW } });
    ok(noOtp.s === 401 && noOtp.j.error === 'otp_required' && !noOtp.sc, 'admin login without the code is refused and makes no session');
    ok((await call('POST', '/api/login', { body: { phone: '9000000001', password: PW, otp: '123456' } })).j.error === 'invalid_otp', 'admin login with a wrong code is refused');
    const adm3 = {}; const withOtp = await call('POST', '/api/login', { jar: adm3, body: { phone: '9000000001', password: PW, otp: TOTP.code(setup.secret, Math.floor(Date.now() / 30000)) } });
    ok(withOtp.s === 200 && (await call('GET', '/api/admin/stats', { jar: adm3 })).s === 200, 'admin login with password + code works');
    ok((await call('GET', '/api/admin/stats', { jar: admin })).j.error === 'mfa_required', 'an older admin session without the second factor is closed');
    // tidy: back to the demo setting
    app.cfg.admin2fa = false; await app.db.q("UPDATE users SET totp_on=0, totp_secret=NULL WHERE phone='9000000001'").run();
    A.resetLimits();
  }

  sec('0g. Rates per buyer, proposed changes and the stock ledger (M4)');
  {
    A.resetLimits();
    const q = app.db.q;
    const RID = (await q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000004' ORDER BY s.id LIMIT 1").get()).id;
    const other = await q("SELECT c.retailer_shop_id rid, u.phone FROM connections c JOIN shops s ON s.id=c.retailer_shop_id JOIN users u ON u.id=s.owner_id WHERE c.wholesaler_shop_id=? AND c.status='approved' AND c.retailer_shop_id<>? ORDER BY c.id LIMIT 1").get(WID, RID);
    const p = await q("SELECT * FROM products WHERE shop_id=? AND status='active' AND on_hand-reserved>=moq*3 ORDER BY id LIMIT 1").get(WID);
    const cn = await q('SELECT id FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=?').get(WID, RID);
    const list = Number(p.price_paise), rateB = Math.max(100, list - 500);
    ok((await call('POST', '/api/w/products/' + p.id + '/update', { jar: sharma, body: { price_b: rateB / 100 } })).s === 200, 'wholesaler sets a Rate B price');
    const set = await call('POST', '/api/w/connections/' + cn.id, { jar: sharma, body: { action: 'tier', tier: 'B' } });
    ok(set.s === 200, 'wholesaler puts a retailer on Rate B');
    ok((await call('POST', '/api/w/connections/' + cn.id, { jar: sharma, body: { action: 'tier', tier: 'Z' } })).s === 400, 'unknown rate is refused');
    const catB = (await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).j;
    const seenB = catB.products.find((x) => x.id === p.id);
    ok(catB.tier === 'B' && seenB.price_paise === rateB && seenB.rate === 'B', 'Rate B retailer sees the Rate B price');
    ok(!JSON.stringify(catB).includes('price_b_paise') && !JSON.stringify(catB).includes('price_c_paise'), 'other rates are never sent to a retailer');
    if (other) {
      const oj = await login(other.phone);
      const seenA = (await call('GET', '/api/r/catalog/' + WID, { jar: oj })).j.products.find((x) => x.id === p.id);
      ok(seenA.price_paise === list && seenA.rate === 'A', 'a Rate A retailer of the same shop still sees the list price');
    }
    const special = Math.max(100, rateB - 300);
    ok((await call('POST', '/api/w/products/' + p.id + '/buyer-price', { jar: sharma, body: { retailer_shop_id: 999999, price: 1 } })).j.error === 'not_connected', 'special price only for a connected retailer');
    ok((await call('POST', '/api/w/products/' + p.id + '/buyer-price', { jar: patel, body: { retailer_shop_id: RID, price: 1 } })).s === 404, 'another wholesaler cannot price this product');
    ok((await call('POST', '/api/w/products/' + p.id + '/buyer-price', { jar: sharma, body: { retailer_shop_id: RID, price: special / 100 } })).s === 200, 'wholesaler sets a special price for one retailer');
    const seenS = (await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).j.products.find((x) => x.id === p.id);
    ok(seenS.price_paise === special && seenS.rate === 'special', 'special price wins over the rate');
    ok((await call('GET', '/api/w/products/' + p.id + '/buyer-prices', { jar: sharma })).j.prices.some((x) => x.retailer_shop_id === RID), 'wholesaler can list special prices');
    // order snapshot uses the buyer's price
    const mk = async (qty, k) => call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p.id, qty }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: k + Date.now() } });
    const o1 = await mk(p.moq, 'm4a-');
    ok(o1.s === 200 && o1.j.items[0].unit_price_paise === special && o1.j.subtotal_paise === special * p.moq, 'order saves the buyer\'s own price');
    await call('POST', '/api/w/products/' + p.id + '/buyer-price', { jar: sharma, body: { retailer_shop_id: RID, price: null } });
    ok((await call('POST', '/api/w/products/' + p.id + '/update', { jar: sharma, body: { price: (list + 1000) / 100 } })).s === 200, 'list price changed after the order');
    ok((await call('GET', '/api/r/orders', { jar: rahul })).j.orders.find((o) => o.id === o1.j.id).items[0].unit_price_paise === special, 'later price changes do not touch placed orders');
    await call('POST', '/api/w/products/' + p.id + '/update', { jar: sharma, body: { price: list / 100, price_b: null } });
    await call('POST', '/api/w/connections/' + cn.id, { jar: sharma, body: { action: 'tier', tier: 'A' } });
    // proposed changes
    const before = await q('SELECT reserved FROM products WHERE id=?').get(p.id);
    const newQty = p.moq * 2, newPrice = special + 200;
    ok((await call('POST', '/api/w/orders/' + o1.j.id + '/propose', { jar: sharma, body: { lines: [{ product_id: p.id, qty: p.moq }] } })).j.error === 'nothing_changed', 'a proposal must change something');
    ok((await call('POST', '/api/w/orders/' + o1.j.id + '/propose', { jar: patel, body: { lines: [{ product_id: p.id, qty: 1 }] } })).s === 404, 'another wholesaler cannot propose changes');
    const prop = await call('POST', '/api/w/orders/' + o1.j.id + '/propose', { jar: sharma, body: { lines: [{ product_id: p.id, qty: newQty, price: newPrice / 100 }], note: 'Rate badla' } });
    ok(prop.s === 200 && prop.j.proposal && prop.j.proposal.subtotal_paise === newQty * newPrice, 'wholesaler proposes new quantity and price');
    ok((await call('POST', '/api/w/orders/' + o1.j.id + '/propose', { jar: sharma, body: { lines: [{ product_id: p.id, qty: 1 }] } })).j.error === 'awaiting_buyer', 'only one open proposal at a time');
    ok((await call('POST', '/api/w/orders/' + o1.j.id + '/advance', { jar: sharma, body: {} })).j.error === 'awaiting_buyer', 'order cannot move on while the buyer has not answered');
    ok((await call('GET', '/api/r/orders', { jar: rahul })).j.orders.find((o) => o.id === o1.j.id).proposal.lines[0].old_qty === p.moq, 'buyer sees old and new values');
    const acc = await call('POST', '/api/r/orders/' + o1.j.id + '/proposal', { jar: rahul, body: { decision: 'accept' } });
    ok(acc.s === 200 && acc.j.subtotal_paise === newQty * newPrice && acc.j.items[0].qty === newQty && !acc.j.proposal, 'buyer accepts: order total and lines change');
    ok(Number((await q('SELECT reserved FROM products WHERE id=?').get(p.id)).reserved) === Number(before.reserved) + (newQty - p.moq), 'held stock follows the new quantity');
    ok((await call('POST', '/api/r/orders/' + o1.j.id + '/proposal', { jar: rahul, body: { decision: 'accept' } })).j.error === 'no_proposal', 'a proposal cannot be accepted twice');
    const o2 = await mk(p.moq, 'm4b-');
    await call('POST', '/api/w/orders/' + o2.j.id + '/propose', { jar: sharma, body: { lines: [{ product_id: p.id, qty: p.moq, price: 1 }] } });
    const r0 = Number((await q('SELECT reserved FROM products WHERE id=?').get(p.id)).reserved);
    const dec = await call('POST', '/api/r/orders/' + o2.j.id + '/proposal', { jar: rahul, body: { decision: 'decline' } });
    ok(dec.s === 200 && dec.j.status === 'cancelled' && Number((await q('SELECT reserved FROM products WHERE id=?').get(p.id)).reserved) === r0 - p.moq, 'buyer declines: order cancelled and stock released');
    await call('POST', '/api/w/orders/' + o1.j.id + '/cancel', { jar: sharma, body: { reason: 'Test tidy up' } });
    // stock ledger: every change is a movement; on hand equals the sum of movements
    const s0 = Number((await q('SELECT on_hand FROM products WHERE id=?').get(p.id)).on_hand);
    ok((await call('POST', '/api/w/products/' + p.id + '/stock', { jar: sharma, body: { set: s0 + 7, reason: 'Recount' } })).s === 200, 'stock set by the wholesaler');
    const mv = await q('SELECT delta, reason FROM stock_movements WHERE product_id=? ORDER BY id DESC LIMIT 1').get(p.id);
    ok(Number(mv.delta) === 7, 'stock change is written to the ledger');
    const bad = await q('SELECT p.id, p.on_hand, COALESCE(SUM(m.delta),0) s FROM products p LEFT JOIN stock_movements m ON m.product_id=p.id GROUP BY p.id, p.on_hand HAVING p.on_hand <> COALESCE(SUM(m.delta),0)').all();
    ok(bad.length === 0, 'on hand equals the sum of stock movements for every product' + (bad.length ? ' ' + JSON.stringify(bad.slice(0, 3)) : ''));
    await call('POST', '/api/w/products/' + p.id + '/stock', { jar: sharma, body: { set: s0 } });
    A.resetLimits();
  }

  sec('0h. Delete my account');
  {
    A.resetLimits();
    const q = app.db.q, PH = '9555500001', PWD = 'Passw0rd!del';
    const jar = {};
    const su = await call('POST', '/api/signup', { jar, body: { role: 'retailer', name: 'Del Tester', phone: PH, password: PWD, shop_name: 'Del Shop', city: 'Pune' } });
    ok(su.s === 200, 'test retailer signs up');
    const rid = Number((await q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone=?").get(PH)).id);
    await q("INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,requested_at,decided_at) VALUES(?,?,'approved','request',?,?)").run(WID, rid, Date.now(), Date.now());
    const p = await q("SELECT id, moq FROM products WHERE shop_id=? AND status='active' AND on_hand-reserved>=moq ORDER BY id LIMIT 1").get(WID);
    const o = await call('POST', '/api/r/orders', { jar, body: { shop_id: WID, items: [{ product_id: p.id, qty: p.moq }], fulfilment: 'pickup', payment_mode: 'cod', idem_key: 'del-' + Date.now() } });
    ok(o.s === 200, 'test retailer places an order');
    const blocked = await call('POST', '/api/me/delete', { jar, body: { password: PWD, confirm: 'DELETE' } });
    ok(blocked.s === 409 && blocked.j.error === 'open_orders' && blocked.j.n === 1, 'cannot delete while an order is open');
    await call('POST', '/api/r/orders/' + o.j.id + '/cancel', { jar, body: {} });
    ok((await call('POST', '/api/me/delete', { jar, body: { password: PWD } })).j.error === 'confirm_required', 'must type DELETE');
    ok((await call('POST', '/api/me/delete', { jar, body: { password: 'wrong-one-123', confirm: 'DELETE' } })).j.error === 'wrong_password', 'wrong password refused');
    ok((await call('POST', '/api/me/delete', { jar: admin, body: { password: PW, confirm: 'DELETE' } })).s === 403, 'Super Admin cannot delete itself this way');
    const del = await call('POST', '/api/me/delete', { jar, body: { password: PWD, confirm: 'delete' } });
    ok(del.s === 200, 'account deleted with password + DELETE');
    ok((await call('GET', '/api/me', { jar })).s === 401, 'old session stops working at once');
    A.resetLimits();
    ok((await call('POST', '/api/login', { body: { phone: PH, password: PWD } })).s === 401, 'cannot log in after deletion');
    const u = await q("SELECT name, phone, deleted_at FROM users WHERE id=(SELECT owner_id FROM shops WHERE id=?)").get(rid);
    ok(u.name === 'Deleted user' && u.phone !== PH && !!u.deleted_at, 'name and phone removed from the user record');
    ok((await q('SELECT status FROM connections WHERE wholesaler_shop_id=? AND retailer_shop_id=?').get(WID, rid)).status === 'revoked', 'connections ended');
    ok(Number((await q('SELECT COUNT(*) n FROM orders WHERE retailer_shop_id=?').get(rid)).n) === 1, 'past orders kept for the other shop');
    ok((await call('GET', '/api/w/orders', { jar: sharma })).j.orders.some((x) => x.id === o.j.id), 'wholesaler still sees the old order');
    ok(Number((await q("SELECT COUNT(*) n FROM audit_logs WHERE action='account_deleted'").get()).n) >= 1, 'deletion is in the audit log');
    const shopRow = await q('SELECT id FROM shops WHERE id=?').get(rid);
    ok((await call('POST', '/api/admin/shops/' + shopRow.id + '/verify', { jar: admin, body: { action: 'reinstate' } })).j.error === 'account_deleted', 'admin cannot reopen a deleted account\'s shop');
    A.resetLimits();
    ok((await call('POST', '/api/signup', { body: { role: 'retailer', name: 'Back Again', phone: PH, password: PWD, shop_name: 'New Del Shop', city: 'Pune' } })).s === 200, 'same phone can sign up again later');
    A.resetLimits();
  }

  sec('0. Chat and payment options');
  {
    const RID = (await app.db.q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000004'").get()).id;
    const PID2 = (await app.db.q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000003'").get()).id;
    A.resetLimits();
    ok((await call('POST', '/api/chat/' + WID, { jar: rahul, body: { body: 'Kab tak ready hoga?' } })).s === 200, 'connected retailer can message the wholesaler');
    const wl = await call('GET', '/api/chat', { jar: sharma });
    const row = wl.j && wl.j.chats.find((x) => x.other_id === RID);
    ok(wl.s === 200 && row && row.unread === 1 && row.last_body === 'Kab tak ready hoga?', 'wholesaler chat list shows 1 unread with the last message');
    ok((await call('GET', '/api/chat/unread', { jar: sharma })).j.n === 1, 'unread badge count is 1');
    const th = await call('GET', '/api/chat/' + RID, { jar: sharma });
    ok(th.s === 200 && th.j.messages.length === 1 && th.j.messages[0].mine === false, 'wholesaler reads the thread');
    ok((await call('GET', '/api/chat/unread', { jar: sharma })).j.n === 0, 'opening the thread marks it read');
    ok((await call('POST', '/api/chat/' + RID, { jar: sharma, body: { body: 'Aaj 4 baje' } })).s === 200, 'wholesaler can reply');
    const rt = await call('GET', '/api/chat/' + WID, { jar: rahul });
    ok(rt.s === 200 && rt.j.messages.length === 2 && rt.j.messages[0].read === true, 'retailer sees both messages and the read tick');
    ok((await call('GET', '/api/chat/' + RID, { jar: patel })).s === 404, 'another wholesaler cannot open this chat (IDOR blocked)');
    ok((await call('POST', '/api/chat/' + PID2, { jar: rahul, body: { body: 'hello' } })).s === 404, 'retailer cannot message a wholesaler it is not connected to');
    ok((await call('GET', '/api/chat', { jar: admin })).s === 403, 'admin has no chat inbox');
    ok((await call('POST', '/api/chat/' + WID, { jar: rahul, body: { body: '   ' } })).s === 400, 'empty message refused');
    ok((await call('POST', '/api/chat/' + WID, { jar: rahul, body: { body: 'x'.repeat(1001) } })).s === 400, 'over-long message refused');
    const otherOrder = (await app.db.q('SELECT id FROM orders WHERE retailer_shop_id<>? LIMIT 1').get(RID));
    if (otherOrder) ok((await call('POST', '/api/chat/' + WID, { jar: rahul, body: { body: 'about this', order_id: otherOrder.id } })).s === 404, 'cannot attach someone else\'s order to a message');
    A.resetLimits(); let c429 = 0; for (let i = 0; i < 25; i++) if ((await call('POST', '/api/chat/' + WID, { jar: rahul, body: { body: 'spam ' + i } })).s === 429) c429++;
    ok(c429 >= 5, 'chat spam is rate limited (' + c429 + ' of 25 blocked)');
    A.resetLimits();
    const p = await app.db.q("SELECT * FROM products WHERE shop_id=? AND status='active' AND on_hand-reserved>=moq+2 ORDER BY id LIMIT 1").get(WID);
    const place = (extra) => call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p.id, qty: p.moq }], fulfilment: 'pickup', payment_mode: 'cod', idem_key: 'chatopt-' + Math.random().toString(36).slice(2), ...extra } });
    ok((await call('POST', '/api/w/options', { jar: rahul, body: { allow_cash: false } })).s === 403, 'retailer cannot change wholesaler options');
    ok((await call('POST', '/api/w/options', { jar: sharma, body: { allow_cash: false, allow_home: false } })).s === 200, 'wholesaler turns off cash and delivery');
    const nc = await place(); ok(nc.s === 403 && nc.j.error === 'cash_not_allowed', 'cash order refused when the shop does not take cash');
    const nd = await place({ payment_mode: 'upi', fulfilment: 'home', address: 'Shop 4, Main Road' }); ok(nd.s === 403 && nd.j.error === 'delivery_not_allowed', 'delivery order refused when the shop does not deliver');
    await call('POST', '/api/w/options', { jar: sharma, body: { allow_cash: true, allow_home: true } });
    const co = await place(); ok(co.s === 200 && co.j.payment_mode === 'cod' && co.j.fulfilment === 'pickup', 'cash-at-pickup order placed once cash is allowed');
    if (co.s === 200) await call('POST', '/api/r/orders/' + co.j.id + '/cancel', { jar: rahul, body: {} });
    ok((await call('GET', '/api/me', { jar: sharma })).j.shop.allow_cash == 1, '/api/me returns the shop options');
    await app.db.q('DELETE FROM messages').run();
    A.resetLimits();
  }

  sec('1. Authentication & sessions');
  ok((await call('GET', '/api/me')).s === 401, 'unauthenticated /api/me -> 401');
  for (const u of ['/api/w/orders', '/api/r/orders', '/api/admin/stats', '/api/media/1', '/api/stream']) ok((await call('GET', u)).s === 401, 'unauthenticated ' + u + ' -> 401');
  A.resetLimits(); ok((await call('POST', '/api/login', { body: { phone: '9000000002', password: 'wrong' } })).s === 401, 'wrong password -> 401');
  const unknown = await call('POST', '/api/login', { body: { phone: '9111111111', password: 'whatever12' } });
  const known = await call('POST', '/api/login', { body: { phone: '9000000002', password: 'wrong-pass' } });
  ok(unknown.s === known.s && unknown.j.error === known.j.error, 'unknown user and wrong password give identical responses (no user enumeration)');
  const cj = {}; A.resetLimits(); const lr = await call('POST', '/api/login', { body: { phone: '9000000002', password: PW }, jar: cj });
  ok(/HttpOnly/i.test(lr.sc) && /SameSite=Lax/i.test(lr.sc), 'session cookie is HttpOnly + SameSite=Lax');
  const tok = cj.c.split('=')[1]; const stored = (await app.db.q('SELECT id FROM sessions').all()).map(r => r.id);
  ok(!stored.includes(tok) && stored.includes(A.sha256(tok)), 'only SHA-256 of session token is stored');
  const hashes = (await app.db.q('SELECT pass_hash FROM users').all()); ok(hashes.every(h => h.pass_hash.startsWith('scrypt$') || h.pass_hash.includes('$')) && !hashes.some(h => h.pass_hash.includes(PW)), 'passwords stored as salted scrypt hashes');
  A.resetLimits(); const tryLogin = (n) => call('POST', '/api/login', { body: { phone: '9000000006', password: 'bad' + n } });
  let early = 0; for (let i = 0; i < 10; i++) if ((await tryLogin(i)).s === 429) early++;
  const lock1 = await tryLogin(10);
  ok(early === 0 && lock1.s === 429 && lock1.j.error === 'login_locked' && lock1.j.retry_after > 0 && lock1.j.retry_after <= 30, 'login: 10 tries allowed, the 11th is locked for up to 30 s');
  const realNow = Date.now; Date.now = () => realNow() + 31000;
  let second = 0; for (let i = 0; i < 5; i++) if ((await tryLogin(20 + i)).s !== 429) second++;
  const lock2 = await tryLogin(30);
  ok(second === 5 && lock2.s === 429, 'login: after the pause only 5 tries, then locked again');
  Date.now = () => realNow() + 62000;
  let third = 0; for (let i = 0; i < 5; i++) if ((await tryLogin(40 + i)).s !== 429) third++;
  ok(third === 5 && (await tryLogin(50)).s === 429, 'login: the 5-try / 30 s cycle repeats');
  Date.now = realNow;
  A.resetLimits();
  const out = await login('9000000006'); await call('POST', '/api/logout', { jar: out, body: {} }); ok((await call('GET', '/api/me', { jar: out })).s === 401, 'logout invalidates the session server-side');
  (await app.db.q('UPDATE sessions SET expires_at=1 WHERE user_id=(SELECT id FROM users WHERE phone=?)').run('9000000005')); ok((await call('GET', '/api/me', { jar: verma })).s === 401, 'expired session rejected');
  const verma2 = await login('9000000005');
  ok((await call('GET', '/api/me', { jar: { c: 'sl_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })).s === 401, 'forged session cookie rejected');
  A.resetLimits(); const su = await call('POST', '/api/signup', { body: { role: 'admin', name: 'Evil', phone: '9333333331', password: 'Passw0rd!x', shop_name: 'X Shop', city: 'Pune' } });
  ok(su.s === 400, 'cannot sign up as admin (role escalation)');
  const su2 = await call('POST', '/api/signup', { body: { role: 'wholesaler', name: 'New W', phone: '9333333332', password: 'Passw0rd!x', shop_name: 'New Whole', city: 'Pune', gstin: '27AAPFU0939F1ZV', verification: 'approved', status: 'active', is_admin: 1 } });
  ok(su2.s === 200 && (await app.db.q("SELECT s.verification v FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9333333332'").get()).v === 'pending', 'mass assignment ignored: new wholesaler stays pending verification');
  const sg = (o) => call('POST', '/api/signup', { body: { role: 'wholesaler', name: 'G Test', phone: '9444' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), password: 'Passw0rd!x', shop_name: 'G Shop', city: 'Pune', ...o } });
  ok((await sg({})).s === 400, 'wholesaler signup without GSTIN rejected');
  ok((await sg({ gstin: '27AAPFU0939F1ZX' })).s === 400, 'GSTIN with wrong check digit rejected');
  ok((await sg({ gstin: 'NOTAGSTIN123456' })).s === 400, 'malformed GSTIN rejected');
  ok((await sg({ gstin: '27AAPFU0939F1ZV' })).s === 409, 'same GSTIN cannot be registered twice');
  ok((await call('POST', '/api/signup', { body: { role: 'retailer', name: 'No Gst', phone: '9555000001', password: 'Passw0rd!x', shop_name: 'R Shop', city: 'Pune', gstin: '27AAPFU0939F1ZV' } })).s === 200 && (await app.db.q("SELECT s.gstin g FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9555000001'").get()).g === null, 'retailer signs up without GSTIN; any GSTIN sent is ignored');
  ok((await call('POST', '/api/signup', { body: { role: 'retailer', name: 'Weak', phone: '9333333333', password: '123', shop_name: 'W', city: 'Pune' } })).s === 400, 'weak password rejected');

  sec('2. CSRF, content type, headers');
  ok((await call('POST', '/api/me/prefs', { jar: sharma, body: { lang: 'hi' }, noCsrf: true })).s === 403, 'state-changing request without X-Requested-With -> 403');
  ok((await call('POST', '/api/me/prefs', { jar: sharma, body: { lang: 'hi' }, headers: { Origin: 'https://evil.example' } })).s === 403, 'cross-origin Origin header -> 403');
  ok((await call('POST', '/api/me/prefs', { jar: sharma, body: 'lang=hi', raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).s === 415, 'non-JSON content type -> 415');
  const idx = await call('GET', '/'); const hh = idx.h;
  ok(/script-src 'self'/.test(hh.get('content-security-policy')) && !/unsafe-inline|unsafe-eval/.test(hh.get('content-security-policy')), 'CSP forbids inline/eval scripts and styles');
  ok(hh.get('x-content-type-options') === 'nosniff' && hh.get('x-frame-options') === 'DENY' && hh.get('referrer-policy') === 'no-referrer', 'nosniff, frame deny, no-referrer set');
  ok((await call('GET', '/../server.js')).s === 404 && (await call('GET', '/data/stocklink.db')).s === 404 && (await call('GET', '/%2e%2e/server.js')).s === 404 && (await call('GET', '/seed.js')).s === 404, 'no source/db files served (static whitelist)');
  ok((await call('POST', '/api/me/prefs', { jar: sharma, body: 'x'.repeat(40000), raw: true, headers: { 'Content-Type': 'application/json' } })).s === 413, 'oversized body -> 413');
  ok((await call('POST', '/api/me/prefs', { jar: sharma, body: '{bad', raw: true, headers: { 'Content-Type': 'application/json' } })).s === 400, 'malformed JSON -> 400, no crash');

  sec('3. Authorization (roles, tenants, IDOR)');
  ok((await call('GET', '/api/admin/stats', { jar: sharma })).s === 403 && (await call('GET', '/api/admin/stats', { jar: rahul })).s === 403, 'non-admin cannot reach admin API');
  ok((await call('GET', '/api/w/products', { jar: rahul })).s === 403, 'retailer cannot reach wholesaler API');
  ok((await call('GET', '/api/r/orders', { jar: sharma })).s === 403, 'wholesaler cannot reach retailer API');
  ok((await call('POST', '/api/admin/shops/1/verify', { jar: sharma, body: { action: 'approve' } })).s === 403, 'wholesaler cannot self-verify');
  const kc = await call('GET', '/api/r/catalog/' + WID, { jar: kul }); ok(kc.s === 403, 'unapproved retailer cannot read catalog');
  const rc = await call('GET', '/api/r/catalog/' + WID, { jar: rahul }); ok(rc.s === 200 && rc.j.products.length >= 6, 'approved retailer can read catalog');
  const mediaId = rc.j.products.find(p => p.media.length).media[0];
  ok((await call('GET', '/api/media/' + mediaId, { jar: rahul })).s === 200, 'approved retailer can fetch product photo');
  ok((await call('GET', '/api/media/' + mediaId, { jar: kul })).s === 404, 'unapproved retailer gets 404 for product photo (IDOR blocked)');
  ok((await call('GET', '/api/media/' + mediaId, { jar: patel })).s === 404, 'other wholesaler gets 404 for competitor photo');
  const pr = (await prodRow('6205'));
  ok((await call('POST', '/api/r/orders', { jar: kul, body: { shop_id: WID, items: [{ product_id: pr.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'kul-try-0001' } })).s === 403, 'unapproved retailer cannot order');
  const ord = await call('GET', '/api/r/orders', { jar: rahul }); const rahulOrderId = ord.j.orders[0].id;
  ok((await call('POST', '/api/r/orders/' + rahulOrderId + '/cancel', { jar: kul, body: {} })).s === 404, "retailer cannot cancel another retailer's order");
  ok((await call('GET', '/api/orders/' + rahulOrderId + '/proof', { jar: kul })).s === 404, "retailer cannot read another retailer's payment proof");
  ok((await call('POST', '/api/w/orders/' + rahulOrderId + '/advance', { jar: patel, body: {} })).s === 404, "wholesaler cannot advance another wholesaler's order");
  ok((await call('POST', '/api/w/products/' + pr.id + '/stock', { jar: patel, body: { delta: 100 } })).s === 404, "wholesaler cannot change another wholesaler's stock");
  ok((await call('POST', '/api/w/connections/1', { jar: patel, body: { action: 'revoke' } })).s === 404, "wholesaler cannot touch another wholesaler's connections");
  ok((await call('POST', '/api/w/invites', { jar: patel, body: {} })).s === 403, 'unverified wholesaler cannot create invite codes');
  ok((await call('GET', '/api/shops/search?q=Patel', { jar: rahul })).j.shops.length === 0, 'unverified wholesaler hidden from search');
  const wl = await call('GET', '/api/w/retailers', { jar: sharma }); ok(!wl.j.connections.some(c => c.status === 'pending' && c.phone), 'pending retailer phone numbers not exposed to wholesaler');

  sec('4. Invite codes');
  A.resetLimits(); let r429 = 0, lastS = 0; for (let i = 0; i < 8; i++) { const r = await call('POST', '/api/r/join', { jar: kul, body: { code: 'ABCD' + String(1000 + i) } }); lastS = r.s; if (r.s === 429) r429++; }
  ok(r429 >= 3 && lastS === 429, 'invite-code guessing locked after 5 failures (' + r429 + ' blocked)');
  const attemptsKept = (await app.db.q('SELECT COUNT(*) n FROM code_attempts WHERE ok=0').get()).n; ok(attemptsKept >= 5, 'failed attempts persisted (survive restart)');
  const joinKul = await call('POST', '/api/r/join', { jar: verma2, body: { code: 'K7QM-3XRP' } });
  ok(joinKul.s === 200 && joinKul.j.status === 'pending', 'valid code creates PENDING request, not access');
  ok((await call('GET', '/api/r/catalog/' + WID, { jar: verma2 })).s === 403, 'valid code alone does not unlock catalog');
  const codeRow = (await app.db.q('SELECT code_hash FROM invite_codes WHERE shop_id=?').get(WID)); ok(!/K7QM|3XRP/i.test(codeRow.code_hash) && codeRow.code_hash.length >= 40, 'invite code stored only as keyed hash');
  const newCode = await call('POST', '/api/w/invites', { jar: sharma, body: { max_uses: 1, days: 1 } }); ok(newCode.s === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(newCode.j.code), 'wholesaler generates invite code');
  const lst = await call('GET', '/api/w/invites', { jar: sharma }); ok(!JSON.stringify(lst.j).includes(newCode.j.code.replace('-', '')), 'code is never returned again after creation');
  const inv = lst.j.invites[0]; await call('POST', '/api/w/invites/' + inv.id + '/revoke', { jar: sharma, body: {} });
  A.resetLimits(); ok((await call('POST', '/api/r/join', { jar: verma2, body: { code: newCode.j.code } })).s === 400, 'revoked code rejected with generic error');

  sec('5. Orders: stock integrity');
  const rid = async (p) => (await app.db.q('SELECT * FROM products WHERE id=?').get(p));
  const chain = (await rid((await prodRow('Roller chain')).id)); // on_hand 3
  // approve 12 retailers via direct DB (test fixture), then race for last units
  const racers = []; await app.db.tx(async () => {
  for (let i = 0; i < 12; i++) {
    const uid = Number((await app.db.q("INSERT INTO users(phone,name,role,pass_hash,tutorial_done,created_at) VALUES(?,?,?,?,1,?)").run('95000000' + String(10 + i), 'Racer ' + i, 'retailer', A.hashPasswordSync(PW), Date.now())).lastInsertRowid);
    const sid = Number((await app.db.q("INSERT INTO shops(owner_id,type,name,city,verification,created_at) VALUES(?,?,?,?,?,?)").run(uid, 'retailer', 'Racer Shop ' + i, 'Pune', 'approved', Date.now())).lastInsertRowid);
    await app.db.q("INSERT INTO memberships(user_id,shop_id,role,created_at) VALUES(?,?,'owner',?)").run(uid, sid, Date.now());
    (await app.db.q("INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,requested_at,decided_at) VALUES(?,?,?,?,?,?)").run(WID, sid, 'approved', 'request', Date.now(), Date.now()));
    racers.push('95000000' + String(10 + i));
  }
  });
  const jars = []; for (const ph of racers) jars.push(await login(ph));
  const before = (await rid(chain.id)), avail0 = before.on_hand - before.reserved;
  A.resetLimits();
  const results = await Promise.all(jars.map((j, i) => call('POST', '/api/r/orders', { jar: j, body: { shop_id: WID, items: [{ product_id: chain.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'race-' + i + '-abcdefgh' } })));
  const won = results.filter(r => r.s === 200).length, lost = results.filter(r => r.s === 409).length, after = (await rid(chain.id));
  ok(won === avail0 && lost === 12 - avail0, 'race: 12 retailers vs ' + avail0 + ' units -> exactly ' + won + ' succeed, ' + lost + ' rejected');
  ok(after.reserved === before.reserved + won && after.reserved <= after.on_hand, 'reserved count exact, never exceeds on_hand (reserved=' + after.reserved + ' on_hand=' + after.on_hand + ')');
  const p205 = (await prodRow('6205')); const b4 = (await rid(p205.id));
  const idem = { shop_id: WID, items: [{ product_id: p205.id, qty: 2 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'idem-double-0001' };
  const [d1, d2] = await Promise.all([call('POST', '/api/r/orders', { jar: rahul, body: idem }), call('POST', '/api/r/orders', { jar: rahul, body: idem })]);
  ok(d1.s === 200 && d2.s === 200 && d1.j.id === d2.j.id && (await rid(p205.id)).reserved === b4.reserved + 2, 'double-submit with same idempotency key creates ONE order and reserves once');
  const cheat = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1, price_paise: 1, unit_price_paise: 1 }], price: 1, subtotal_paise: 1, fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'price-cheat-0001' } });
  ok(cheat.s === 200 && cheat.j.subtotal_paise === p205.price_paise, 'client-supplied price ignored; server price used (' + cheat.j.subtotal_paise + ')');
  for (const [qty, name] of [[-1, 'negative'], [0, 'zero'], [1.5, 'fractional'], ['5', 'string'], [1e12, 'huge'], [null, 'null']]) {
    const r = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'qty-' + name + '-0001' } });
    ok(r.s === 400 || r.s === 409, 'quantity ' + name + ' rejected (' + r.s + ')');
  }
  const bad = (await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1 }, { product_id: p205.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'dup-item-00001' } })); ok(bad.s === 400, 'duplicate line items rejected');
  const b2 = (await rid((await prodRow('Bearing grease')).id)); const g = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: b2.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'oos-order-00001' } }); ok(g.s === 409 && (await rid(b2.id)).reserved === 0, 'out-of-stock item rejected, nothing reserved');
  ok((await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'bitcoin', idem_key: 'mode-bad-000001' } })).s === 400, 'unknown payment mode rejected');
  const rahulDb = (await app.db.q("SELECT s.id FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone='9000000004'").get()).id;
  (await app.db.q('UPDATE connections SET credit_allowed=0 WHERE retailer_shop_id=?').run(rahulDb));
  ok((await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'credit', idem_key: 'credit-not-0001' } })).s === 403, 'credit refused when wholesaler has not enabled it');
  (await app.db.q('UPDATE connections SET credit_allowed=1 WHERE retailer_shop_id=?').run(rahulDb));
  const mine = await call('GET', '/api/r/orders', { jar: rahul }); const o1 = mine.j.orders.find(o => o.id === d1.j.id);
  const rs0 = (await rid(p205.id)).reserved; const cn = await call('POST', '/api/r/orders/' + o1.id + '/cancel', { jar: rahul, body: {} }); ok(cn.s === 200 && (await rid(p205.id)).reserved === rs0 - 2, 'cancel releases reserved stock exactly');
  ok((await call('POST', '/api/r/orders/' + o1.id + '/cancel', { jar: rahul, body: {} })).s === 409 && (await rid(p205.id)).reserved === rs0 - 2, 'double cancel cannot release stock twice');
  // payment/UTR logic
  const pay = cheat.j; ok((await call('POST', '/api/w/orders/' + pay.id + '/advance', { jar: sharma, body: {} })).s === 409, 'UPI order cannot be marked paid without a UTR');
  ok((await call('POST', '/api/r/orders/' + pay.id + '/payment', { jar: rahul, body: { utr: 'bad utr!' } })).s === 400, 'malformed UTR rejected');
  ok((await call('POST', '/api/r/orders/' + pay.id + '/payment', { jar: rahul, body: { utr: 'UTR412908877151' } })).s === 409, 'UTR already used on another order rejected (fraud: reused reference)');
  ok((await call('POST', '/api/r/orders/' + pay.id + '/payment', { jar: rahul, body: { utr: 'UTR555000111222', proof: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' } })).s === 400, 'HTML disguised as proof image rejected');
  ok((await call('POST', '/api/r/orders/' + pay.id + '/payment', { jar: rahul, body: { utr: 'UTR555000111222', proof: PNG } })).s === 200, 'valid UTR + PNG proof accepted');
  ok((await call('GET', '/api/orders/' + pay.id + '/proof', { jar: sharma })).s === 200 && (await call('GET', '/api/orders/' + pay.id + '/proof', { jar: patel })).s === 404, 'only the two parties can read the proof');
  for (const st of ['paid', 'packed', 'dispatched']) await call('POST', '/api/w/orders/' + pay.id + '/advance', { jar: sharma, body: {} });
  const done = await call('POST', '/api/w/orders/' + pay.id + '/advance', { jar: sharma, body: { pickup_code: 'ZZZZZZ' } }); ok(done.s === 403, 'pickup order cannot complete without the right code');
  const bdisp = (await rid(p205.id)); ok(bdisp.on_hand === b4.on_hand - 1, 'dispatch deducts on_hand (and releases reservation)');
  ok((await app.db.q('SELECT * FROM products WHERE reserved<0 OR on_hand<reserved').all()).length === 0, 'DB invariant: no product has reserved<0 or reserved>on_hand');
  const bumped = await call('POST', '/api/w/products/' + chain.id + '/stock', { jar: sharma, body: { set: 0 } }); ok(bumped.s === 409, 'wholesaler cannot set stock below units reserved by open orders');

  ok((await call('POST', '/api/w/products/' + p205.id + '/stock', { jar: sharma, body: { delta: 5, reason: 'restock' } })).s === 200, 'wholesaler can adjust own stock (+5)');

  sec('6. Input validation, injection, uploads');
  const sqli = ["' OR '1'='1", "'; DROP TABLE users;--", '" OR 1=1 --', 'x%', '_'];
  for (const s of sqli) { const r = await call('GET', '/api/shops/search?q=' + encodeURIComponent(s), { jar: rahul }); ok(r.s === 200 && Array.isArray(r.j.shops), 'search handles injection string safely: ' + s.slice(0, 18)); }
  ok((await app.db.q('SELECT COUNT(*) n FROM users').get()).n > 6, 'users table intact after injection attempts');
  A.resetLimits(); ok((await call('POST', '/api/login', { body: { phone: "9000000002' OR '1'='1", password: "x' OR '1'='1" } })).s === 401, 'SQL injection in login fails');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'T', price: 10, on_hand: 1 } })).s === 400, 'too-short product name rejected');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Neg price', price: -5, on_hand: 1 } })).s === 400, 'negative price rejected');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Bad pack', price: 5, on_hand: 1, unit: 'set', pack_qty: 0 } })).s === 400, 'pack size below 1 rejected');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Bad unit', price: 5, on_hand: 1, unit: '<b>x</b>' } })).s === 400, 'unknown selling unit rejected');
  const setP = await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Gasket set of 6', price: 120, on_hand: 4, unit: 'set', pack_qty: 6 } });
  const setList = (await call('GET', '/api/w/products', { jar: sharma })).j.products.find(x => x.id === setP.j.id);
  ok(setP.s === 200 && setList.unit === 'set' && setList.pack_qty === 6, 'wholesaler can list a product as a set of 6');
  const sizeRows = [{ label: 'L', qty: 6 }, { label: 'XL', qty: 6 }, { label: 'XXL', qty: 6 }];
  const shirt = await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Shirt set L/XL/XXL', price: 2700, on_hand: 5, unit: 'set', pack_detail: sizeRows, pack_qty: 999 } });
  const shirtP = (await call('GET', '/api/w/products', { jar: sharma })).j.products.find(x => x.id === shirt.j.id);
  ok(shirt.s === 200 && shirtP.pack_qty === 18 && shirtP.pack_detail.length === 3, 'size assortment (L6 + XL6 + XXL6) stored; total 18 computed by server, client total ignored');
  for (const [name, detail] of [['zero qty', [{ label: 'L', qty: 0 }]], ['dup size', [{ label: 'L', qty: 1 }, { label: 'l', qty: 1 }]], ['long label', [{ label: 'X'.repeat(13), qty: 1 }]], ['too many', Array.from({ length: 13 }, (_, i) => ({ label: 'S' + i, qty: 1 }))], ['not array', 'L:6'], ['bad row', [5]]]) {
    ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Bad ' + name, price: 5, on_hand: 1, unit: 'set', pack_detail: detail } })).s === 400, 'invalid pack detail rejected: ' + name);
  }
  const shirtOrder = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: shirt.j.id, qty: 2 }], fulfilment: 'pickup', payment_mode: 'cod', idem_key: 'shirt-set-order-01' } });
  const shirtItem = shirtOrder.j.items && shirtOrder.j.items[0];
  ok(shirtOrder.s === 200 && shirtItem.pack_qty === 18 && shirtItem.unit === 'set' && shirtItem.pack_detail.length === 3, 'order keeps a snapshot of the pack contents (2 sets = 36 pcs)');
  await call('POST', '/api/w/products/' + shirt.j.id + '/update', { jar: sharma, body: { pack_detail: [{ label: 'M', qty: 1 }] } });
  const again = (await call('GET', '/api/r/orders', { jar: rahul })).j.orders.find(o => o.id === shirtOrder.j.id);
  ok(again.items[0].pack_qty === 18, 'later edits to a product do not change old orders');

  sec('Notifications and phone push');
  const grease = await prodRow('Bearing grease'); const pushes = []; let pushFail = 0;
  app.notify.send = async (sub, payload) => { if (pushFail) { const e = new Error('gone'); e.statusCode = pushFail; throw e; } pushes.push({ endpoint: sub.endpoint, data: JSON.parse(payload) }); };
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  const goodKeys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  for (const ep of ['http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/push', 'https://evil.example.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x']) {
    ok((await call('POST', '/api/push/subscribe', { jar: sharma, body: { endpoint: ep, keys: goodKeys } })).s === 400, 'push endpoint refused (SSRF guard): ' + ep);
  }
  ok((await call('POST', '/api/push/subscribe', { jar: sharma, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: '<script>', auth: 'x' } } })).s === 400, 'malformed push keys refused');
  ok((await call('POST', '/api/push/subscribe', { jar: sharma, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/sharma-phone', keys: goodKeys } })).s === 200, 'wholesaler phone subscribed to push');
  ok((await call('POST', '/api/push/subscribe', { jar: rahul, body: { endpoint: 'https://web.push.apple.com/rahul-iphone', keys: goodKeys } })).s === 200, 'retailer iPhone subscribed to push');
  ok(typeof (await call('GET', '/api/push/key', { jar: rahul })).j.key === 'string', 'VAPID public key served');
  await call('POST', '/api/notifications/read', { jar: sharma, body: {} });
  const nOrder = await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'cod', idem_key: 'notify-order-0001' } });
  await nap(300);
  const feedW = (await call('GET', '/api/notifications', { jar: sharma })).j;
  ok(nOrder.s === 200 && feedW.unread >= 1 && feedW.items[0].title.includes(nOrder.j.no) && feedW.items[0].tab === 'orders', 'wholesaler gets "New order" in the app feed');
  ok(pushes.some(x => x.endpoint.endsWith('sharma-phone') && x.data.title.includes(nOrder.j.no)), 'wholesaler phone gets a push for the new order');
  ok(!(await call('GET', '/api/notifications', { jar: rahul })).j.items.some(i => i.title.includes('New order')), 'retailer does not see the wholesaler\'s notifications');
  await call('POST', '/api/w/orders/' + nOrder.j.id + '/advance', { jar: sharma, body: {} }); await nap(300);
  ok(pushes.some(x => x.endpoint.endsWith('rahul-iphone') && x.data.title.includes(nOrder.j.no)), 'retailer phone gets a push when the order moves on');
  const pBefore = pushes.length;
  await call('POST', '/api/w/products/' + grease.id + '/stock', { jar: sharma, body: { delta: 10, reason: 'restock' } }); await nap(300);
  ok(pushes.slice(pBefore).some(x => x.endpoint.endsWith('rahul-iphone') && /grease/i.test(x.data.body)), 'connected retailer gets "back in stock" push');
  const pB2 = pushes.length; await call('POST', '/api/w/products/' + grease.id + '/stock', { jar: sharma, body: { delta: 5, reason: 'restock' } }); await nap(300);
  ok(pushes.length === pB2, 'no repeat "back in stock" push when stock was already available');
  await call('POST', '/api/notifications/read', { jar: sharma, body: {} });
  ok((await call('GET', '/api/notifications', { jar: sharma })).j.unread === 0, 'mark all read clears the badge');
  pushFail = 410; await call('POST', '/api/push/test', { jar: sharma, body: {} }); await nap(300); pushFail = 0;
  ok(!(await app.db.q("SELECT 1 FROM push_subs WHERE endpoint LIKE '%sharma-phone'").get()), 'subscription removed when the phone reports it is gone (410)');
  await call('POST', '/api/push/unsubscribe', { jar: rahul, body: { endpoint: 'https://web.push.apple.com/rahul-iphone' } });
  ok(!(await app.db.q("SELECT 1 FROM push_subs WHERE endpoint LIKE '%rahul-iphone'").get()), 'unsubscribe removes the phone');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Neg stock', price: 5, on_hand: -1 } })).s === 400, 'negative stock rejected');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Bad photo', price: 5, on_hand: 1, photos: ['data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+'] } })).s === 400, 'SVG upload rejected (script-capable image type)');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Fake png', price: 5, on_hand: 1, photos: ['data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64')] } })).s === 400, 'file with wrong magic bytes rejected even if labelled PNG');
  const bigImg = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(700 * 1024)]).toString('base64');
  ok([400, 413].includes((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Big photo', price: 5, on_hand: 1, photos: [bigImg] } })).s), 'oversized image rejected');
  ok((await call('POST', '/api/w/products', { jar: sharma, body: { name: 'Five photos', price: 5, on_hand: 1, photos: [PNG, PNG, PNG, PNG, PNG] } })).s === 400, 'more than 4 photos rejected');
  const good = await call('POST', '/api/w/products', { jar: sharma, body: { name: '<script>alert(1)</script>', spec: 'x', price: 12.5, on_hand: 4, photos: [PNG] } }); ok(good.s === 200, 'valid product with photo created (HTML stored as inert text)');
  const gm = (await app.db.q('SELECT id FROM media WHERE product_id=?').get(good.j.id)); const mr = await call('GET', '/api/media/' + gm.id, { jar: sharma });
  ok(mr.s === 200 && mr.h.get('content-type') === 'image/png' && /sandbox/.test(mr.h.get('content-security-policy')) && mr.h.get('x-content-type-options') === 'nosniff', 'media served with real MIME + CSP sandbox + nosniff');
  ok((await call('POST', '/api/w/profile', { jar: sharma, body: { upi_id: 'javascript:alert(1)' } })).s === 400, 'invalid UPI id rejected');
  ok((await call('POST', '/api/w/connections/1', { jar: sharma, body: { action: 'drop_table' } })).s === 400, 'unknown action rejected');
  ok((await call('GET', '/api/nope', { jar: sharma })).s === 404 && (await call('DELETE', '/api/w/orders', { jar: sharma })).s === 404, 'unknown routes/methods -> 404');

  sec('7. Revocation takes effect immediately');
  const sc = new Set(); const ev = await fetch(base + '/api/stream', { headers: { Cookie: rahul.c } }); ok(ev.status === 200 && /event-stream/.test(ev.headers.get('content-type')), 'SSE stream opens for authenticated user');
  const rd = ev.body.getReader(); const kcn = (await app.db.q('SELECT id FROM connections WHERE retailer_shop_id=? AND wholesaler_shop_id=?').get(rahulDb, WID));
  const pending = rd.read(); await call('POST', '/api/w/connections/' + kcn.id, { jar: sharma, body: { action: 'revoke' } });
  ok((await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).s === 403, 'revoked retailer loses catalog access on next request');
  ok((await call('GET', '/api/media/' + mediaId, { jar: rahul })).s === 404, 'revoked retailer loses photo access');
  ok((await call('POST', '/api/r/orders', { jar: rahul, body: { shop_id: WID, items: [{ product_id: p205.id, qty: 1 }], fulfilment: 'pickup', payment_mode: 'upi', idem_key: 'after-revoke-001' } })).s === 403, 'revoked retailer cannot order');
  await rd.cancel().catch(() => {}); await call('POST', '/api/w/connections/' + kcn.id, { jar: sharma, body: { action: 'approve' } });
  const rv = (await app.db.q("SELECT id FROM users WHERE phone='9000000005'").get()).id; (await app.db.q("UPDATE users SET status='suspended' WHERE id=?").run(rv)); ok((await call('GET', '/api/me', { jar: verma2 })).s === 401, 'disabled account session stops working immediately');
  const whDis = (await app.db.q("SELECT owner_id FROM shops WHERE id=?").get(WID)).owner_id; await call('POST', '/api/admin/shops/' + WID + '/verify', { jar: admin, body: { action: 'suspend', reason: 'test suspension' } });
  ok((await call('GET', '/api/r/catalog/' + WID, { jar: rahul })).s === 403, 'suspended wholesaler catalog disappears for retailers');
  await call('POST', '/api/admin/shops/' + WID + '/verify', { jar: admin, body: { action: 'reinstate' } });
  ok((await call('POST', '/api/admin/shops/' + WID + '/verify', { jar: admin, body: { action: 'reject' } })).s === 400, 'admin reject requires a reason');

  sec('8. Audit log integrity');
  const v1 = await verifyAudit(app.db); ok(v1.ok && v1.checked > 20, 'audit chain verifies (' + v1.checked + ' entries)');
  const row = await app.db.q("SELECT id, detail FROM audit_logs WHERE action='order_placed' ORDER BY id LIMIT 1").get();
  await app.db.q("UPDATE audit_logs SET detail='tampered' WHERE id=?").run(row.id);
  const v2 = await verifyAudit(app.db); ok(!v2.ok && v2.broken_at === row.id, 'tampering with an entry is detected at entry ' + row.id);
  await app.db.q("UPDATE audit_logs SET detail=? WHERE id=?").run(row.detail, row.id);
  const acts = (await app.db.q('SELECT DISTINCT action FROM audit_logs').all()).map(r => r.action);
  for (const a of ['login', 'login_failed', 'order_placed', 'invite_created', 'invite_failed', 'shop_suspend', 'connection_revoke', 'stock_adjusted']) ok(acts.includes(a), 'audit has entry type: ' + a);
  ok(!JSON.stringify((await app.db.q('SELECT detail FROM audit_logs').all())).includes(PW), 'no passwords in audit log');

  sec('9. Limits');
  A.resetLimits(); let g429 = 0; for (let i = 0; i < 40; i++) { const r = await call('POST', '/api/signup', { body: { role: 'retailer', name: 'Spam', phone: '97000001' + String(10 + i), password: 'Passw0rd!x', shop_name: 'Spam ' + i, city: 'Pune' } }); if (r.s === 429) g429++; }
  ok(g429 >= 25, 'signup spam rate limited (' + g429 + ' of 40 blocked)');
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
  if (fail) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
