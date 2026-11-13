'use strict';
// Time-based one-time passwords (RFC 6238, as used by Google Authenticator / Microsoft Authenticator).
const crypto = require('node:crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function newSecret() { const b = crypto.randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function decode(s) { let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function code(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', decode(secret)).update(buf).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
// Accepts the current 30-second code and one step either side (clock drift).
function verify(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string' || !/^\d{6}$/.test(token.trim())) return false;
  const c = Math.floor(now / 30000), t = token.trim();
  return [c - 1, c, c + 1].some((k) => crypto.timingSafeEqual(Buffer.from(code(secret, k)), Buffer.from(t)));
}
const uri = (secret, label) => `otpauth://totp/${encodeURIComponent('StockLink:' + label)}?secret=${secret}&issuer=StockLink&digits=6&period=30`;
module.exports = { newSecret, verify, code, uri };
