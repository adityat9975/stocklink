'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','wholesaler','retailer')),
  pass_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK(lang IN ('en','hi')), tutorial_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shops(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('wholesaler','retailer')), name TEXT NOT NULL, city TEXT NOT NULL,
  gstin TEXT, upi_id TEXT,
  verification TEXT NOT NULL DEFAULT 'pending' CHECK(verification IN ('pending','approved','rejected','suspended')),
  reject_reason TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shops_owner ON shops(owner_id);
CREATE TABLE IF NOT EXISTS memberships(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), shop_id INTEGER NOT NULL REFERENCES shops(id),
  role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')), added_by INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(user_id, shop_id));
CREATE INDEX IF NOT EXISTS memberships_shop ON memberships(shop_id);
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_paise INTEGER,
  period_days INTEGER NOT NULL DEFAULT 30 CHECK(period_days BETWEEN 1 AND 3660), trial_days INTEGER NOT NULL DEFAULT 0 CHECK(trial_days BETWEEN 0 AND 365),
  grace_days INTEGER NOT NULL DEFAULT 7 CHECK(grace_days BETWEEN 0 AND 90),
  max_products INTEGER, max_retailers INTEGER, max_staff INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','retired')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL UNIQUE REFERENCES shops(id), plan_id INTEGER NOT NULL REFERENCES plans(id),
  kind TEXT NOT NULL CHECK(kind IN ('trial','paid')), paid_until INTEGER NOT NULL, grace_days INTEGER NOT NULL,
  suspended_at INTEGER, suspend_reason TEXT, cancelled_at INTEGER, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscription_events(
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id), kind TEXT NOT NULL, detail TEXT, actor_user_id INTEGER, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, ip TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invite_codes(
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id), code_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
  auto_approve INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS code_attempts(
  id INTEGER PRIMARY KEY, user_id INTEGER, ip TEXT, ok INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS code_attempts_ts ON code_attempts(ts);
CREATE TABLE IF NOT EXISTS connections(
  id INTEGER PRIMARY KEY, wholesaler_shop_id INTEGER NOT NULL REFERENCES shops(id),
  retailer_shop_id INTEGER NOT NULL REFERENCES shops(id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked','blocked')),
  source TEXT NOT NULL CHECK(source IN ('invite_code','request')), invite_code_id INTEGER,
  credit_allowed INTEGER NOT NULL DEFAULT 0, requested_at INTEGER NOT NULL, decided_at INTEGER,
  UNIQUE(wholesaler_shop_id, retailer_shop_id));
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', price_paise INTEGER NOT NULL CHECK(price_paise > 0),
  unit TEXT NOT NULL DEFAULT 'pc', pack_qty INTEGER NOT NULL DEFAULT 1 CHECK(pack_qty >= 1), pack_detail TEXT NOT NULL DEFAULT '', moq INTEGER NOT NULL DEFAULT 1 CHECK(moq >= 1),
  on_hand INTEGER NOT NULL CHECK(on_hand >= 0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  is_new INTEGER NOT NULL DEFAULT 0, stock_verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  CHECK(reserved <= on_hand));
CREATE INDEX IF NOT EXISTS products_shop ON products(shop_id, status);
CREATE TABLE IF NOT EXISTS media(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), mime TEXT NOT NULL,
  data BLOB NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS media_product ON media(product_id);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, no TEXT NOT NULL UNIQUE,
  wholesaler_shop_id INTEGER NOT NULL REFERENCES shops(id), retailer_shop_id INTEGER NOT NULL REFERENCES shops(id),
  placed_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('received','paid','packed','dispatched','completed','cancelled','expired')),
  fulfilment TEXT NOT NULL CHECK(fulfilment IN ('pickup','home')), address TEXT, pickup_code TEXT NOT NULL,
  payment_mode TEXT NOT NULL CHECK(payment_mode IN ('upi','credit','cod')), utr TEXT,
  proof_mime TEXT, proof_data BLOB, subtotal_paise INTEGER NOT NULL, idem_key TEXT NOT NULL,
  reserve_expires_at INTEGER, cancel_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(retailer_shop_id, idem_key));
CREATE UNIQUE INDEX IF NOT EXISTS orders_utr ON orders(wholesaler_shop_id, utr) WHERE utr IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_w ON orders(wholesaler_shop_id, status, created_at);
CREATE INDEX IF NOT EXISTS orders_r ON orders(retailer_shop_id, created_at);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pc', pack_qty INTEGER NOT NULL DEFAULT 1, pack_detail TEXT NOT NULL DEFAULT '',
  unit_price_paise INTEGER NOT NULL, qty INTEGER NOT NULL CHECK(qty > 0));
CREATE TABLE IF NOT EXISTS order_history(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), status TEXT NOT NULL,
  actor_user_id INTEGER, note TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor_user_id INTEGER, actor_label TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, tab TEXT, created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS push_subs(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, wholesaler_shop_id INTEGER NOT NULL REFERENCES shops(id), retailer_shop_id INTEGER NOT NULL REFERENCES shops(id),
  sender_user_id INTEGER NOT NULL REFERENCES users(id), from_role TEXT NOT NULL CHECK(from_role IN ('wholesaler','retailer')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000), order_id INTEGER REFERENCES orders(id),
  created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(wholesaler_shop_id, retailer_shop_id, id);
CREATE INDEX IF NOT EXISTS messages_sender_ts ON messages(sender_user_id, created_at);
`;


const als = new AsyncLocalStorage();
const toPgSchema = (sql) => sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY').replace(/INTEGER PRIMARY KEY/g, 'BIGSERIAL PRIMARY KEY').replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bBLOB\b/g, 'BYTEA');
const toPgParams = (sql) => { let n = 0; return sql.replace(/\?/g, () => '$' + (++n)); };

// Columns added after the first release: [table, column, definition]. Applied on start to older databases.
const COLUMN_UPGRADES = [
  ['products', 'pack_qty', 'INTEGER NOT NULL DEFAULT 1 CHECK(pack_qty >= 1)'],
  ['products', 'pack_detail', "TEXT NOT NULL DEFAULT ''"],
  ['order_items', 'unit', "TEXT NOT NULL DEFAULT 'pc'"],
  ['order_items', 'pack_qty', 'INTEGER NOT NULL DEFAULT 1'],
  ['order_items', 'pack_detail', "TEXT NOT NULL DEFAULT ''"],
  ['shops', 'allow_cash', 'INTEGER NOT NULL DEFAULT 1'],
  ['users', 'last_seen_at', 'INTEGER'],
  ['products', 'category', "TEXT NOT NULL DEFAULT ''"],
  ['sessions', 'active_shop_id', 'INTEGER'],
  ['sessions', 'mfa_ok', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'totp_secret', 'TEXT'],
  ['users', 'totp_on', 'INTEGER NOT NULL DEFAULT 0'],
  ['shops', 'allow_home', 'INTEGER NOT NULL DEFAULT 1'],
];

// Every shop owner is also an 'owner' member of that shop (one login can run several businesses).
const BACKFILL_OWNERS = `INSERT INTO memberships(user_id, shop_id, role, created_at)
  SELECT s.owner_id, s.id, 'owner', s.created_at FROM shops s
  WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = s.owner_id AND m.shop_id = s.id)`;

/* Databases created before multi-business support had UNIQUE(owner_id) on shops. SQLite cannot drop a
   constraint, so the table is rebuilt once (the documented 12-step procedure), keeping every row and id. */
function sqliteManyShopsPerOwner(raw) {
  const uniq = raw.prepare("PRAGMA index_list('shops')").all().find((i) => i.unique && i.origin === 'u' &&
    raw.prepare(`PRAGMA index_info('${i.name}')`).all().map((c) => c.name).join() === 'owner_id');
  if (!uniq) return;
  const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='shops'").get().sql;
  const fresh = sql.replace(/^CREATE TABLE "?shops"?/i, 'CREATE TABLE shops__new').replace(/owner_id INTEGER NOT NULL UNIQUE/i, 'owner_id INTEGER NOT NULL');
  const cols = raw.prepare("PRAGMA table_info('shops')").all().map((c) => c.name).join(',');
  raw.exec('PRAGMA foreign_keys=OFF');
  try {
    raw.exec('BEGIN');
    raw.exec(fresh);
    raw.exec(`INSERT INTO shops__new(${cols}) SELECT ${cols} FROM shops`);
    raw.exec('DROP TABLE shops');
    raw.exec('ALTER TABLE shops__new RENAME TO shops');
    raw.exec('CREATE INDEX IF NOT EXISTS shops_owner ON shops(owner_id)');
    const bad = raw.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error('foreign key check failed after shops migration');
    raw.exec('COMMIT');
  } catch (e) { try { raw.exec('ROLLBACK'); } catch (_) {} throw e; }
  finally { raw.exec('PRAGMA foreign_keys=ON'); }
}

/* ---------- SQLite backend (zero setup: local demo and tests) ---------- */
function openSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  raw.exec(SCHEMA);
  // upgrade databases created before these columns existed
  for (const [table, col, ddl] of COLUMN_UPGRADES) {
    if (!raw.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === col)) raw.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + ddl);
  }
  sqliteManyShopsPerOwner(raw);
  raw.exec(BACKFILL_OWNERS);
  // One connection: a transaction must not be interleaved with other requests' statements, so it holds a lock.
  let locked = false; const waiters = [];
  const acquire = () => new Promise(r => { if (!locked) { locked = true; r(); } else waiters.push(r); });
  const release = () => { const n = waiters.shift(); if (n) n(); else locked = false; };
  const run = async (sql, args, mode) => {
    const inTx = als.getStore();
    if (!inTx) await acquire();
    try {
      const st = raw.prepare(sql.replace(/\s+FOR UPDATE( OF \w+)?/gi, ''));
      if (mode === 'get') return st.get(...args);
      if (mode === 'all') return st.all(...args);
      const r = st.run(...args); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    } finally { if (!inTx) release(); }
  };
  return {
    kind: 'sqlite',
    q: (sql) => ({ get: (...a) => run(sql, a, 'get'), all: (...a) => run(sql, a, 'all'), run: (...a) => run(sql, a, 'run') }),
    async tx(fn) {
      if (als.getStore()) return fn();
      await acquire();
      raw.exec('BEGIN IMMEDIATE');
      try { const r = await als.run({ sqlite: true }, fn); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch (_) {} throw e; }
      finally { release(); }
    },
    async execScript(sql) { await acquire(); try { raw.exec(sql); } finally { release(); } },
    async close() { raw.close(); }
  };
}

/* ---------- Postgres backend (Supabase or any Postgres) ---------- */
async function openPg(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); types.setTypeParser(1700, (v) => Number(v)); // BIGINT and COUNT(*) come back as numbers
  const local = /@(localhost|127\.0\.0\.1)|host=\/|sslmode=disable/.test(url);
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, ssl: local ? false : { rejectUnauthorized: false } });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  const exec = async (sql, args, mode) => {
    const client = als.getStore();
    let text = toPgParams(sql);
    if (mode === 'run' && /^\s*INSERT/i.test(text) && !/\bRETURNING\b/i.test(text) && !/INSERT INTO (sessions|settings)\b/i.test(text)) text += ' RETURNING id';
    const r = await (client || pool).query(text, args);
    if (mode === 'get') return r.rows[0];
    if (mode === 'all') return r.rows;
    return { changes: r.rowCount, lastInsertRowid: r.rows && r.rows[0] ? Number(r.rows[0].id) : 0 };
  };
  const db = {
    kind: 'pg',
    q: (sql) => ({ get: (...a) => exec(sql, a, 'get'), all: (...a) => exec(sql, a, 'all'), run: (...a) => exec(sql, a, 'run') }),
    async tx(fn) {
      if (als.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await als.run(client, fn);
        await client.query('COMMIT'); return r;
      } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
      finally { client.release(); }
    },
    async execScript(sql) { await pool.query(sql); },
    async close() { await pool.end(); }
  };
  // Create tables once; the transaction-scoped lock is safe with Supabase poolers and several instances starting together.
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(7002)'); await c.query(toPgSchema(SCHEMA));
    for (const [table, col, ddl] of COLUMN_UPGRADES) await c.query('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + col + ' ' + ddl.replace('INTEGER', 'BIGINT'));
    await c.query('ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_owner_id_key');
    await c.query(BACKFILL_OWNERS);
    // Supabase exposes every table in the public schema through its REST API. RLS with no policies blocks that
    // door completely (anon and authenticated roles get nothing); this server connects as the owner and is unaffected.
    for (const t of ['users', 'shops', 'sessions', 'invite_codes', 'code_attempts', 'connections', 'products', 'media', 'orders', 'order_items', 'order_history', 'audit_logs', 'notifications', 'push_subs', 'settings', 'messages', 'memberships', 'plans', 'subscriptions', 'subscription_events']) await c.query('ALTER TABLE ' + t + ' ENABLE ROW LEVEL SECURITY');
    await c.query('COMMIT'); }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
  return db;
}

/* cfg: { databaseUrl } for Postgres/Supabase, otherwise { dbPath } for SQLite */
async function open(cfg) {
  if (typeof cfg === 'string') cfg = { dbPath: cfg };
  return cfg.databaseUrl ? openPg(cfg.databaseUrl) : openSqlite(cfg.dbPath);
}
const tx = (db, fn) => db.tx(fn);

const ZERO = '0'.repeat(64);
function auditHash(prev, r) {
  return crypto.createHash('sha256').update(JSON.stringify([prev, r.ts, r.actor_user_id ?? '', r.actor_label ?? '', r.action, r.entity ?? '', r.entity_id ?? '', r.detail ?? '', r.ip ?? ''])).digest('hex');
}
async function audit(db, a) {
  return db.tx(async () => {
  if (db.kind === 'pg') await db.q('SELECT pg_advisory_xact_lock(7001)').get(); // keeps the hash chain linear under concurrency
  const prev = await db.q('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1').get();
  const prevHash = prev ? prev.hash : ZERO;
  const row = { ts: Date.now(), actor_user_id: a.actorId ?? null, actor_label: a.actorLabel ?? null, action: a.action,
    entity: a.entity ?? null, entity_id: a.entityId != null ? String(a.entityId) : null, detail: a.detail ?? null, ip: a.ip ?? null };
  const hash = auditHash(prevHash, row);
  await db.q('INSERT INTO audit_logs(ts,actor_user_id,actor_label,action,entity,entity_id,detail,ip,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(row.ts, row.actor_user_id, row.actor_label, row.action, row.entity, row.entity_id, row.detail, row.ip, prevHash, hash);
  });
}
async function verifyAudit(db) {
  let prev = ZERO, n = 0;
  for (const r of await db.q('SELECT * FROM audit_logs ORDER BY id ASC').all()) {
    n++;
    if (r.prev_hash !== prev || auditHash(prev, r) !== r.hash) return { ok: false, checked: n, broken_at: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: n, broken_at: null };
}
module.exports = { open, tx, audit, verifyAudit };
