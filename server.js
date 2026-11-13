#!/usr/bin/env node
'use strict';
/* StockLink entry point. Node >= 22.5. SQLite by default; set DATABASE_URL to use Postgres (Supabase). */
const { loadConfig, getSecret, loadDotEnv } = require('./lib/config');
const { open } = require('./lib/db');
const { createServices } = require('./lib/services');
const { createHttpServer } = require('./lib/http');
const { createNotifier } = require('./lib/notify');
const demo = require('./lib/demo');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = ['auth', 'admin', 'wholesaler', 'retailer', 'shared', 'notify', 'chat', 'insights', 'plans'];

async function createApp(cfg) {
  const secret = getSecret(cfg);
  if (!cfg.databaseUrl) fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = await open(cfg);
  await demo.ensureAdmin(db, cfg);
  if (cfg.demo) await demo.seedDemoIfEmpty(db, cfg);

  const services = createServices({ db, cfg, secret });
  services.notify = createNotifier({ db, cfg, clients: services.clients });
  await services.notify.init();
  const routes = [];
  const route = (method, pattern, auth, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, re, keys, auth, handler, big: !!opts.big, perm: opts.perm || null });
  };
  for (const name of ROUTES) require('./routes/' + name)(services, route);

  const server = createHttpServer({ cfg, routes, services });
  const expTimer = setInterval(() => { services.expireOrders().catch((e) => console.error('expire error', e.message)); }, 60000);
  expTimer.unref();
  return { server, db, cfg, expireOrders: services.expireOrders, notify: services.notify,
    close: async () => { clearInterval(expTimer); for (const c of services.clients) { try { c.res.end(); } catch (_) {} } await new Promise((r) => server.close(r)); await db.close(); } };
}

if (require.main === module) {
  if (loadDotEnv()) console.log('Settings loaded from .env');
  const cfg = loadConfig();
  createApp(cfg).then((app) => {
    app.server.listen(cfg.port, cfg.host, () => console.log(`StockLink running on http://localhost:${cfg.port} using ${cfg.databaseUrl ? 'Postgres (Supabase)' : 'SQLite'}${cfg.demo ? '  (DEMO MODE: sample data and public demo logins)' : ''}`));
    for (const sg of ['SIGINT', 'SIGTERM']) process.on(sg, () => app.close().then(() => process.exit(0)));
  }).catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
}
module.exports = { createApp, loadConfig };
