'use strict';
// CLI: `npm run seed` loads demo data into an empty database; `npm run seed -- --reset` wipes and reloads it.
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { open } = require('./lib/db');
const { resetDemo, seedDemoIfEmpty } = require('./lib/demo');

(async () => {
  const cfg = loadConfig(); cfg.demo = true;
  if (!cfg.databaseUrl) fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = await open(cfg);
  if (process.argv.includes('--reset')) await resetDemo(db, cfg); else await seedDemoIfEmpty(db, cfg);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
