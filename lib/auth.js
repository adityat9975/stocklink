'use strict';
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; }
}
const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

/* ---------- passwords: scrypt, per-user random salt ---------- */
const N = 16384, R = 8, P = 1;
const scryptAsync = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}
function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  const got = await scryptAsync(pw, salt);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const DUMMY_HASH = hashPasswordSync('not-a-real-password-for-timing');

/* ---------- sessions: random token in an HttpOnly cookie, only its SHA-256 is stored ---------- */
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

/* ---------- in-memory sliding-window rate limiter ---------- */
const buckets = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now(), arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}
function peek(key, limit, windowMs) {
  const now = Date.now(), arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  return arr.length < limit;
}
const gc = setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3600000) buckets.delete(k); }, 300000);
gc.unref();
// Staged lockout for password guessing: `first` tries, then a lock of `lockMs`; after each lock only `then` tries,
// then another lock, and so on. A pause of `idleMs` with no tries forgives everything. Returns 0 if the try is
// allowed, else the seconds left on the lock.
const gates = new Map();
function gate(key, { first = 10, then = 5, lockMs = 30000, idleMs = 900000 } = {}) {
  const now = Date.now();
  if (gates.size > 20000) for (const [k, v] of gates) if (now - v.last > idleMs && v.until <= now) gates.delete(k);
  let g = gates.get(key);
  if (!g || (g.until <= now && now - g.last > idleMs)) g = { left: first, until: 0, last: now };
  if (g.until > now) { gates.set(key, g); return Math.ceil((g.until - now) / 1000); }
  if (g.until) { g.left = then; g.until = 0; }
  g.left--; g.last = now;
  if (g.left <= 0) g.until = now + lockMs;
  gates.set(key, g);
  return 0;
}
const gateClear = (key) => { gates.delete(key); };
function resetLimits() { buckets.clear(); gates.clear(); }

/* ---------- validation ---------- */
function str(v, name, min, max) {
  if (typeof v !== 'string') fail(400, 'invalid_' + name);
  const s = v.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (s.length < min || s.length > max) fail(400, 'invalid_' + name);
  return s;
}
function int(v, name, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) fail(400, 'invalid_' + name);
  return v;
}
function oneOf(v, name, list) { if (!list.includes(v)) fail(400, 'invalid_' + name); return v; }

/* ---------- images: validate by magic bytes, never trust the client's mime ---------- */
function parseImage(dataUrl, maxBytes) {
  if (typeof dataUrl !== 'string') fail(400, 'invalid_image');
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) fail(400, 'invalid_image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 64 || buf.length > maxBytes) fail(400, 'image_too_large');
  let mime = null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
  else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') mime = 'image/webp';
  if (!mime) fail(400, 'invalid_image');
  return { mime, buf };
}

/* ---------- invite codes: 8 chars Crockford base32 from a CSPRNG; only an HMAC is stored ---------- */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function makeCode() {
  const b = crypto.randomBytes(8); let c = '';
  for (let i = 0; i < 8; i++) c += ALPHABET[b[i] & 31];
  return c;
}
const normCode = s => String(s).toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
function codeHash(code, secret) { return crypto.createHmac('sha256', secret).update(normCode(code)).digest('hex'); }
const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };


/* What each member role may do inside a business. Owner: everything. Checked on the server for every route that
   declares a permission (route option `perm`), never only by hiding buttons. */
const PERMS = {
  owner: ['*'],
  manager: ['catalog', 'stock', 'orders', 'network', 'chat', 'buy'],
  staff: ['stock', 'orders', 'chat'],
};
function can(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const list = PERMS[user.member_role] || [];
  return list.includes('*') || list.includes(perm);
}
function need(user, perm) { if (!can(user, perm)) fail(403, 'no_permission'); }

module.exports = { PERMS, can, need, HttpError, fail, hashPassword, hashPasswordSync, verifyPassword, DUMMY_HASH, sha256, newToken, hit, peek, gate, gateClear, resetLimits,
  str, int, oneOf, parseImage, makeCode, normCode, codeHash, fmtCode, safeEqual };
