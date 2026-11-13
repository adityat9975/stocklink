'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx, audit } = require('./db');
const A = require('./auth');

const DEMO_PASSWORD = 'Demo@1234';
const DEMO_CODE = 'K7QM3XRP';
const DAY = 86400000, MIN = 60000;
const IMG = (n) => { try { return fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', n)); } catch (_) { return null; } };

// Phone as typed on the login screen: 10 digits. Accepts "+91 98xxx xxxxx", "091-98...", "9198..." in .env.
const tenDigits = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 && /^(91|0|091)/.test(d) ? d.slice(-10) : d; };

/* Creates the super admin from ADMIN_PHONE / ADMIN_PASSWORD, and keeps its password in step with those settings
   (whoever can change the server settings already controls the server, so they are the source of truth). */
async function ensureAdmin(db, cfg) {
  const { password, name } = cfg.admin || {};
  const phone = tenDigits((cfg.admin || {}).phone);
  if (!phone || !password) return false;
  if (cfg.demo) { console.log('Note: DEMO_MODE is on, so ADMIN_PHONE / ADMIN_PASSWORD are ignored. Open a new window without DEMO_MODE.'); return false; }
  if (!/^\d{10}$/.test(phone)) throw new Error('ADMIN_PHONE must be a 10-digit mobile number');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  const u = await db.q('SELECT id, role, pass_hash, status FROM users WHERE phone=?').get(phone);
  if (u) {
    if (u.role !== 'admin') { console.log(`Warning: ${phone} is already used by a ${u.role} account, so it cannot be the super admin. Use a different ADMIN_PHONE.`); return false; }
    if (!(await A.verifyPassword(password, u.pass_hash)) || u.status !== 'active') {
      await db.q("UPDATE users SET pass_hash=?, status='active' WHERE id=?").run(A.hashPasswordSync(password), u.id);
      await audit(db, { actorLabel: 'system', action: 'admin_password_from_settings', entity: 'user', entityId: u.id });
      console.log('Super admin password updated from settings for', phone);
    } else console.log('Super admin ready:', phone);
    return false;
  }
  await tx(db, async () => {
    const uid = Number((await db.q('INSERT INTO users(phone,name,role,pass_hash,tutorial_done,created_at) VALUES(?,?,?,?,1,?)').run(phone, name || 'Platform Admin', 'admin', A.hashPasswordSync(password), Date.now())).lastInsertRowid);
    await audit(db, { actorLabel: 'system', action: 'admin_created', entity: 'user', entityId: uid });
  });
  console.log('Super admin created for', phone);
  return true;
}

async function seedDemoIfEmpty(db, cfg) {
  if ((await db.q('SELECT COUNT(*) n FROM users').get()).n === 0) await seedDemo(db, cfg);
}
async function resetDemo(db, cfg) {
  await tx(db, async () => {
    const tables = ['order_history', 'order_items', 'orders', 'media', 'products', 'code_attempts', 'invite_codes', 'connections', 'sessions', 'shops', 'users', 'audit_logs'];
    if (db.kind === 'pg') await db.execScript('TRUNCATE ' + tables.join(',') + ' RESTART IDENTITY CASCADE');
    else await db.execScript(tables.map(t => 'DELETE FROM ' + t + ';').join('') + `DELETE FROM sqlite_sequence;`);
  });
  await seedDemo(db, cfg);
}

async function seedDemo(db, cfg) {
  const q = (s) => db.q(s);
  const now = Date.now();
  const hash = A.hashPasswordSync(DEMO_PASSWORD);
  const secretFile = path.join(path.dirname(cfg.dbPath), 'secret.key');
  let secret = cfg.secret || (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : null);
  if (!secret) { secret = require('node:crypto').randomBytes(32).toString('hex'); fs.mkdirSync(path.dirname(secretFile), { recursive: true }); fs.writeFileSync(secretFile, secret, { mode: 0o600 }); }
  await tx(db, async () => {
    const user = async (phone, name, role) => Number((await q('INSERT INTO users(phone,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)').run(phone, name, role, hash, now - 20 * DAY)).lastInsertRowid);
    const shop = async (owner, type, name, city, ver, extra = {}) => {
      const id = Number((await q('INSERT INTO shops(owner_id,type,name,city,gstin,upi_id,verification,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(owner, type, name, city, extra.gstin || null, extra.upi || null, ver, now - 20 * DAY)).lastInsertRowid);
      await q("INSERT INTO memberships(user_id,shop_id,role,created_at) VALUES(?,?,'owner',?)").run(owner, id, now - 20 * DAY);
      return id;
    };
    const uAdmin = await user('9000000001', 'Platform Admin', 'admin');
    await q('UPDATE users SET tutorial_done=0 WHERE id=?').run(uAdmin);
    const uSharma = await user('9000000002', 'Anil Sharma', 'wholesaler');
    const uPatel = await user('9000000003', 'Kiran Patel', 'wholesaler');
    const uRahul = await user('9000000004', 'Rahul Deshmukh', 'retailer');
    const uVerma = await user('9000000005', 'Sanjay Verma', 'retailer');
    const uKul = await user('9000000006', 'Meera Kulkarni', 'retailer');
    const sSharma = await shop(uSharma, 'wholesaler', 'Sharma Traders', 'Pune', 'approved', { gstin: '27ABCDE1234F1Z0', upi: 'sharma.traders@okbank' });
    await shop(uPatel, 'wholesaler', 'Patel Bearings & Tools', 'Ahmedabad', 'pending', { gstin: '24PQRSX5678L1Z2' });
    const sRahul = await shop(uRahul, 'retailer', 'Rahul Auto Spares', 'Nashik', 'approved');
    const sVerma = await shop(uVerma, 'retailer', 'Verma Hardware', 'Pune', 'approved');
    await shop(uKul, 'retailer', 'Kulkarni Machinery', 'Kolhapur', 'approved');
    await q('INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,credit_allowed,requested_at,decided_at) VALUES(?,?,?,?,1,?,?)').run(sSharma, sRahul, 'approved', 'invite_code', now - 15 * DAY, now - 15 * DAY);
    await q('INSERT INTO connections(wholesaler_shop_id,retailer_shop_id,status,source,requested_at) VALUES(?,?,?,?,?)').run(sSharma, sVerma, 'pending', 'request', now - 2 * 3600000);
    if (secret) (await q('INSERT INTO invite_codes(shop_id,code_hash,hint,max_uses,uses,expires_at,auto_approve,created_at) VALUES(?,?,?,?,?,?,0,?)')
      .run(sSharma, A.codeHash(DEMO_CODE, secret), DEMO_CODE.slice(-2), 50, 1, now + 365 * DAY, now - 15 * DAY));

    const defs = [
      ['6205-2RS ball bearing', '25 x 52 x 15 mm, sealed, deep groove', 185, 24, 1, 'pc', 1, 'bearing.jpg', 4 * MIN],
      ['32208 taper roller bearing', '40 x 80 x 24.75 mm', 640, 6, 0, 'pc', 1, 'taper.jpg', 11 * MIN],
      ['B-52 V-belt', 'Section B, 52 in outside length', 210, 40, 2, 'pc', 2, 'belt.jpg', 26 * MIN],
      ['Roller chain 08B-1', 'Pitch 12.7 mm, 3 m length', 1150, 3, 0, 'pc', 1, 'chain.jpg', 52 * MIN],
      ['Bearing grease 400 g', 'Lithium complex, cartridge', 320, 0, 0, 'pc', 1, 'grease.jpg', 95 * MIN],
      ['UCP205 pillow block', 'Cast iron housing with 25 mm bearing', 540, 14, 0, 'pc', 1, 'pillow.jpg', 8 * MIN],
      ['Timing belt HTD 5M-450', 'Width 15 mm, 90 teeth', 380, 22, 0, 'pc', 1, 'timing.jpg', 19 * MIN],
      ['6204-2RS bearing pack', 'Sealed deep groove, pack of 6', 990, 15, 0, 'pack', 1, 'bearing.jpg', 14 * MIN, 6],
      ['Work shirt set', 'Cotton, one set has three sizes', 2700, 8, 0, 'set', 1, null, 22 * MIN, 18, JSON.stringify([{ label: 'L', qty: 6 }, { label: 'XL', qty: 6 }, { label: 'XXL', qty: 6 }])]
    ];
    const CAT = ['Bearings', 'Bearings', 'Belts', 'Chains', 'Lubricants', 'Bearings', 'Belts', 'Bearings', 'Workwear'];
    const pid = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const id = Number((await q('INSERT INTO products(shop_id,name,spec,price_paise,on_hand,reserved,unit,moq,is_new,stock_verified_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(sSharma, d[0], d[1], d[2] * 100, d[3], d[4], d[5], d[6], i < 3 || i === 5 ? 1 : 0, now - d[8], now - (10 - i) * DAY)).lastInsertRowid);
      if (d[9]) await q('UPDATE products SET pack_qty=?, pack_detail=? WHERE id=?').run(d[9], d[10] || '', id);
      await q('UPDATE products SET category=? WHERE id=?').run(CAT[i] || '', id);
      pid.push(id);
      const img = IMG(d[7]); if (img) await q('INSERT INTO media(product_id,mime,data,sort,created_at) VALUES(?,?,?,0,?)').run(id, 'image/jpeg', img, now);
    }
    const order = async (no, rid, uid, status, items, mode, ful, extra = {}) => {
      const sub = items.reduce((s, [pi, qty]) => s + defs[pi][2] * 100 * qty, 0);
      const oid = Number((await q('INSERT INTO orders(no,wholesaler_shop_id,retailer_shop_id,placed_by,status,fulfilment,address,pickup_code,payment_mode,utr,subtotal_paise,idem_key,reserve_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(no, sSharma, rid, uid, status, ful, ful === 'home' ? 'Shop 4, MIDC Road, Nashik 422010' : null, A.makeCode().slice(0, 6), mode, extra.utr || null, sub, 'seed-' + no, extra.exp || null, now - (extra.age || 3600000), now - (extra.age || 3600000) + 600000)).lastInsertRowid);
      for (const [pi, qty] of items) await (q('INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price_paise,qty) VALUES(?,?,?,?,?)').run(oid, pid[pi], defs[pi][0], defs[pi][2] * 100, qty));
      for (const st of (extra.history || [status])) await (q('INSERT INTO order_history(order_id,status,actor_user_id,note,ts) VALUES(?,?,?,?,?)').run(oid, st, uid, null, now - (extra.age || 3600000)));
    };
    await order('SL-1001', sRahul, uRahul, 'paid', [[0, 4]], 'upi', 'home', { utr: 'UTR412908877151', age: 38 * MIN, exp: now + 20 * 3600000, history: ['received', 'paid'] });
    await order('SL-1002', sRahul, uRahul, 'completed', [[1, 2], [3, 1]], 'credit', 'pickup', { age: 6 * DAY, history: ['received', 'paid', 'packed', 'dispatched', 'completed'] });
    await order('SL-1003', sRahul, uRahul, 'received', [[2, 2]], 'credit', 'pickup', { age: 12 * MIN });

    const L = async (actor, label, action, entity, id, detail) => await audit(db, { actorId: actor, actorLabel: label, action, entity, entityId: id, detail, ip: '127.0.0.1' });
    await L(uSharma, 'Anil Sharma', 'signup', 'shop', sSharma, 'wholesaler Sharma Traders');
    await L(uAdmin, 'Platform Admin', 'shop_approve', 'shop', sSharma, 'Sharma Traders');
    await L(uRahul, 'Rahul Deshmukh', 'joined_with_invite', 'shop', sSharma, 'status pending');
    await L(uSharma, 'Anil Sharma', 'connection_approve', 'connection', 1, 'Rahul Auto Spares');
    await L(uSharma, 'Anil Sharma', 'product_created', 'product', pid[0], defs[0][0] + ' stock 24');
    await L(uRahul, 'Rahul Deshmukh', 'order_placed', 'order', 1, 'SL-1001 total 74000 items 1');
    await L(uVerma, 'Sanjay Verma', 'access_requested', 'shop', sSharma, '');
    await L(uPatel, 'Kiran Patel', 'signup', 'shop', 2, 'wholesaler Patel Bearings & Tools');
  });
  console.log('Demo data loaded. Demo password for all accounts:', DEMO_PASSWORD);
}

module.exports = { ensureAdmin, seedDemoIfEmpty, seedDemo, resetDemo, DEMO_PASSWORD, DEMO_CODE };
