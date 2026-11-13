const { chromium } = require('playwright');
const base = process.env.BASE || 'http://localhost:3111';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async () => { const ctx = await b.newContext({ viewport: { width: 400, height: 800 } }); const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); return p; };
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const login = async (p, phone) => { await p.goto(base); await p.click('[data-act=fill][data-id="' + phone + '"]'); await p.click('form button[type=submit]'); await p.waitForSelector('.nav'); };
  const skipTut = async (p) => { if (await p.$('[data-act=tutskip]')) await p.click('[data-act=tutskip]'); await p.waitForSelector('.modal', { state: 'detached' }); };
  // wholesaler
  const w = await mk(); await login(w, '9000000002'); ok(!!(await w.$('.modal')), 'wholesaler tutorial shows on first login'); await skipTut(w);
  // retailer not connected
  const r = await mk(); await login(r, '9000000006'); await skipTut(r);
  ok((await r.textContent('.page')).includes('Catalog locked'), 'unconnected retailer sees locked catalog');
  await r.fill('#code', 'k7qm-3xrp'); await r.click('[data-act=join]'); await r.waitForSelector('.banner.info');
  ok(true, 'retailer joined via code (pending)');
  // wholesaler approves (live)
  await w.click('[data-act=tab][data-id=retailers]'); await w.waitForSelector('[data-act=conn][data-id$=":approve"]');
  const approves = await w.$$('[data-act=conn][data-id$=":approve"]'); ok(approves.length >= 2, 'wholesaler sees pending requests: ' + approves.length);
  const card = await w.$('.card:has-text("Kulkarni Machinery")'); await (await card.$('[data-act=conn]')).click();
  await r.waitForSelector('[data-act=tab][data-id=catalog]', { timeout: 8000 }); await r.click('[data-act=tab][data-id=catalog]'); await r.waitForSelector('.prod', { timeout: 8000 }); ok(true, 'retailer catalog unlocked live via SSE after approval');
  // order
  await r.click('[data-act=cart][data-id$=":1"]'); await r.click('[data-act=cart][data-id$=":1"]'); await r.click('[data-act=review]');
  await r.click('[data-act=place]'); await r.waitForSelector('text=Order SL-', { timeout: 5000 }).catch(() => {});
  await r.click('[data-act=tab][data-id=orders]'); await r.waitForSelector('.track');
  const txt = await r.textContent('.page'); ok(/SL-10\d\d/.test(txt) && txt.includes('Pickup code'), 'order placed with pickup code');
  await w.waitForSelector('.bell .dot', { timeout: 5000 }).catch(() => {}); ok(!!(await w.$('.bell .dot')), 'wholesaler bell shows the new order live');
  await w.click('[data-act=bell]'); await w.waitForSelector('.note-item'); ok((await w.textContent('.sheet')).includes('New order'), 'notification feed lists "New order"');
  await w.click('.sheet [data-act=closemodal]');
  const swOk = await w.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 4000))]));
  ok(swOk, 'service worker installed (app can be added to home screen and opens offline)');
  const man = await w.evaluate(() => fetch('/manifest.webmanifest').then(r => r.json()).then(j => j.display + ':' + j.icons.length).catch(e => 'ERR ' + e.message));
  ok(man === 'standalone:3', 'web app manifest served (' + man + ')');
  // pay UPI
  await r.fill('[id^=utr_]', 'UTR998877665544'); await r.click('[data-act=paysubmit]'); await r.waitForSelector('text=UTR998877665544');
  ok(true, 'UTR submitted');
  await w.click('[data-act=tab][data-id=orders]'); await w.waitForSelector('[data-act=adv]');
  for (const label of ['Payment verified', 'Mark packed', 'Dispatch', 'Ready for pickup']) { const btn = await w.$('[data-act=adv]:has-text("' + label + '")'); if (btn) { await btn.click(); await w.waitForTimeout(500); } }
  const code = (await r.textContent('.pick')).trim();
  await r.waitForTimeout(800); ok(code.length === 6, 'pickup code is 6 chars');
  await w.fill('[id^=pc_]', 'WRONG1'); await w.click('[data-act=adv]'); await w.waitForTimeout(500);
  ok(!!(await w.$('[id^=pc_]')), 'wrong pickup code rejected (order still waiting)');
  await w.fill('[id^=pc_]', code); await w.click('[data-act=adv]'); await w.waitForTimeout(700);
  ok(!(await w.$('[id^=pc_]')), 'order leaves the active list after correct pickup code');
  await w.click('[data-act=ordtab][data-id=past]'); ok(!!(await w.$('.badge.good:has-text("Completed")')), 'completed order shows under Past');
  // hinglish toggle
  await r.click('[data-act=menu]'); await r.click('[data-act=lang][data-id=hi]'); await r.click('[data-act=closemodal]'); ok((await r.textContent('.nav')).includes('Catalog'), 'language toggles');
  // XSS check: product name
  const w2 = w; await w2.click('[data-act=tab][data-id=stock]'); await w2.click('[data-act=addform]'); await w2.fill('#pname', '<img src=x onerror=window.__x=1>'); await w2.fill('#pprice', '10'); await w2.fill('#pstock', '3'); await w2.click('[data-act=addp]'); await w2.waitForTimeout(800);
  ok(!(await w2.evaluate(() => window.__x)), 'XSS payload not executed');
  ok((await w2.textContent('.page')).includes('<img src=x'), 'payload rendered as text');
  await w2.click('[data-act=addform]'); await w2.fill('#pname', 'Gasket kit'); await w2.fill('#pprice', '120'); await w2.fill('#pstock', '4'); await w2.click('[data-act=punit][data-id=set]'); await w2.fill('#ppack', '6');
  await w2.screenshot({ path: '/tmp/sl_e2e/addsheet.png' }); await w2.click('[data-act=addp]'); await w2.waitForTimeout(800);
  ok((await w2.textContent('.page')).includes('Set of 6 pcs'), 'product listed as a set of 6 pieces');
  await w2.click('[data-act=addform]'); await w2.fill('#pname', 'Polo set'); await w2.fill('#pprice', '1800'); await w2.fill('#pstock', '5'); await w2.click('[data-act=punit][data-id=set]'); await w2.click('[data-act=pmode][data-id=sizes]');
  await w2.fill('[data-sz="0:label"]', 'L'); await w2.fill('[data-sz="0:qty"]', '6'); await w2.click('[data-act=sizeadd][data-id=XL]'); await w2.fill('[data-sz="1:qty"]', '6'); await w2.click('[data-act=sizeadd][data-id=XXL]'); await w2.fill('[data-sz="2:qty"]', '6');
  ok((await w2.textContent('#sztotal')) === '18', 'size rows add up to 18 pieces live');
  await w2.screenshot({ path: '/tmp/sl_e2e/sizesheet.png' }); await w2.click('[data-act=addp]'); await w2.waitForTimeout(800);
  ok((await w2.textContent('.page')).includes('L 6 · XL 6 · XXL 6'), 'size assortment shown on the stock list');
  // admin
  const a = await mk(); await login(a, '9000000001'); await skipTut(a); ok((await a.textContent('.page')).includes('Patel'), 'admin sees pending shop');
  await a.click('[data-act=tab][data-id=audit]'); await a.click('[data-act=verifychain]'); await a.waitForSelector('.banner'); ok((await a.textContent('.banner')).includes('intact'), 'audit chain verified in UI');
  await w.screenshot({ path: '/tmp/sl_e2e/w.png' }); await r.screenshot({ path: '/tmp/sl_e2e/r.png' });
  console.log('console errors:', errs.filter(e => !/Failed to load resource/.test(e)));
  await b.close();
})().catch(e => { console.error('E2E CRASH', e.message); process.exit(1); });
