'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* Reads KEY=value lines from the private .env file next to server.js (if it exists).
   Values already set in the real environment (e.g. on Render) win, so the file is only for your own PC. */
function loadDotEnv(file = path.join(__dirname, '..', '.env')) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (/^[A-Z_][A-Z0-9_]*$/.test(k) && process.env[k] === undefined && v !== '') process.env[k] = v;
  }
  return true;
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000), host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    dbPath: env.DB_PATH || path.join(__dirname, 'data', 'stocklink.db'),
    demo: env.DEMO_MODE === '1', prod: env.NODE_ENV === 'production', trustProxy: env.TRUST_PROXY === '1',
    // Super Admin must use a second factor (authenticator code). Only demo mode skips it, so its public demo login works.
    admin2fa: env.DEMO_MODE !== '1',
    secret: env.SESSION_SECRET || null,
    admin: { phone: env.ADMIN_PHONE || null, password: env.ADMIN_PASSWORD || null, name: env.ADMIN_NAME || 'Platform Admin' },
    currency: env.CURRENCY || '₹',
    // Web Push keys. Optional: generated once and stored in the database when not set.
    vapid: { publicKey: env.VAPID_PUBLIC_KEY || null, privateKey: env.VAPID_PRIVATE_KEY || null, subject: env.VAPID_SUBJECT || null }
  };
}
function getSecret(cfg) {
  if (cfg.secret) return cfg.secret;
  if (cfg.databaseUrl) throw new Error('SESSION_SECRET is required when DATABASE_URL is set (a file on a hosted server would be lost on redeploy)');
  const f = path.join(path.dirname(cfg.dbPath), 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

module.exports = { loadConfig, getSecret, loadDotEnv };
