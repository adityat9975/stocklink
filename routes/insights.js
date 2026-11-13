'use strict';
// Super-admin insights: live dashboard with time filters, and an "Ask" assistant that answers business questions
// in plain English / Hinglish. The assistant never runs free-form SQL: it maps a question to a fixed set of safe,
// parameterised reports, so it is instant, free and cannot leak or change data.
const A = require('../lib/auth');
const { fail } = A;

const H = 3600000, D = 24 * H;
const RANGES = { '1h': H, '2h': 2 * H, '6h': 6 * H, '24h': D, '7d': 7 * D, '30d': 30 * D, '90d': 90 * D, all: null };
const LIVE = "status NOT IN ('cancelled','expired')"; // orders that count as business
const LIVE_O = 'o.' + LIVE;
const rs = (p) => Math.round(Number(p || 0)) / 100;

module.exports = function registerInsights(ctx, route) {
  const { q, clients } = ctx;
  const now = () => Date.now();

  /* ---------------- dashboard ---------------- */
  route('GET', '/api/admin/dashboard', 'admin', async (c) => {
    if (!A.hit('dash:' + c.user.id, 120, 60000)) fail(429, 'rate_limited');
    const rq = c.query.get('range'); const range = Object.prototype.hasOwnProperty.call(RANGES, rq) ? rq : '24h';
    const t = now(), since = RANGES[range] ? t - RANGES[range] : 0;

    const onlineIds = [...new Set([...clients].map((x) => x.userId).filter(Boolean))];
    const roleCount = async (sql, ...p) => { const o = { wholesaler: 0, retailer: 0, admin: 0 }; for (const r of await q(sql).all(...p)) o[r.role] = Number(r.n); o.total = o.wholesaler + o.retailer; return o; };
    const active = await roleCount('SELECT role, COUNT(*) n FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at>=? GROUP BY role', since);
    const activeList = await q(`SELECT u.id, u.name, u.role, u.phone, u.last_seen_at, s.name shop, s.city FROM users u LEFT JOIN shops s ON s.owner_id=u.id
      WHERE u.last_seen_at IS NOT NULL AND u.last_seen_at>=? AND u.role<>'admin' ORDER BY u.last_seen_at DESC LIMIT 30`).all(since);
    const signups = await roleCount('SELECT role, COUNT(*) n FROM users WHERE created_at>=? GROUP BY role', since);

    const o = await q(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN ${LIVE} THEN subtotal_paise ELSE 0 END),0) v,
      COALESCE(SUM(CASE WHEN ${LIVE} THEN 1 ELSE 0 END),0) live, COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) cancelled
      FROM orders WHERE created_at>=?`).get(since);
    const group = (col) => q(`SELECT ${col} k, COUNT(*) n, COALESCE(SUM(subtotal_paise),0) v FROM orders WHERE created_at>=? GROUP BY ${col} ORDER BY n DESC`).all(since);
    const top = (side) => q(`SELECT s.id, s.name, s.city, COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v FROM orders o JOIN shops s ON s.id=o.${side}_shop_id
      WHERE o.created_at>=? AND ${LIVE_O} GROUP BY s.id, s.name, s.city ORDER BY v DESC LIMIT 5`).all(since);

    const span = since ? t - since : Math.max(D, t - Number((await q('SELECT MIN(created_at) m FROM orders').get()).m || t));
    const bucket = span <= 2 * H ? 10 * 60000 : span <= D ? H : D;
    const start = since ? since - (since % bucket) : t - span - ((t - span) % bucket);
    const sRows = await q(`SELECT (created_at/${bucket}) b, COUNT(*) n, COALESCE(SUM(subtotal_paise),0) v FROM orders WHERE created_at>=? AND ${LIVE} GROUP BY (created_at/${bucket})`).all(start);
    const byB = new Map(sRows.map((r) => [Number(r.b), r]));
    const series = [];
    for (let b = Math.floor(start / bucket); b <= Math.floor(t / bucket) && series.length < 120; b++) { const r = byB.get(b); series.push({ t: b * bucket, n: r ? Number(r.n) : 0, v: r ? rs(r.v) : 0 }); }

    const one = async (sql, ...p) => Number(Object.values((await q(sql).get(...p)) || { n: 0 })[0]) || 0;
    return {
      range, since, now: t, bucket,
      online_now: onlineIds.length,
      active, active_list: activeList.map((u) => ({ name: u.name, role: u.role, phone: u.phone, shop: u.shop || null, city: u.city || null, last_seen: Number(u.last_seen_at), online: onlineIds.includes(u.id) })),
      signups,
      orders: { count: Number(o.n), live: Number(o.live), cancelled: Number(o.cancelled), value: rs(o.v), avg: Number(o.live) ? rs(Number(o.v) / Number(o.live)) : 0 },
      by_status: (await group('status')).map((r) => ({ k: r.k, n: Number(r.n), v: rs(r.v) })),
      by_payment: (await group('payment_mode')).map((r) => ({ k: r.k, n: Number(r.n), v: rs(r.v) })),
      by_fulfilment: (await group('fulfilment')).map((r) => ({ k: r.k, n: Number(r.n), v: rs(r.v) })),
      top_wholesalers: (await top('wholesaler')).map((r) => ({ name: r.name, city: r.city, n: Number(r.n), v: rs(r.v) })),
      top_retailers: (await top('retailer')).map((r) => ({ name: r.name, city: r.city, n: Number(r.n), v: rs(r.v) })),
      messages: await one('SELECT COUNT(*) n FROM messages WHERE created_at>=?', since),
      pending_verification: await one("SELECT COUNT(*) n FROM shops WHERE type='wholesaler' AND verification='pending'"),
      totals: {
        wholesalers: await one("SELECT COUNT(*) n FROM shops WHERE type='wholesaler'"),
        retailers: await one("SELECT COUNT(*) n FROM shops WHERE type='retailer'"),
        products: await one("SELECT COUNT(*) n FROM products WHERE status='active'"),
        links: await one("SELECT COUNT(*) n FROM connections WHERE status='approved'"),
      },
      series,
    };
  });

  /* ---------------- Ask assistant ---------------- */
  const NUMW = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, chhe: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, barah: 12, twelve: 12 };
  const UNIT = [[/^(min|mins|minute|minutes|minat)$/, 60000, 'minute'], [/^(h|hr|hrs|hour|hours|ghanta|ghante|ghanton)$/, H, 'hour'], [/^(d|day|days|din|dino|dinon)$/, D, 'day'],
    [/^(w|wk|week|weeks|hafta|hafte|haftey|hafton)$/, 7 * D, 'week'], [/^(m|mo|month|months|mahina|mahine|mahino|mahinon)$/, 30 * D, 'month'], [/^(y|yr|year|years|saal|sal)$/, 365 * D, 'year']];
  const startOfDay = (t) => { const d = new Date(t + 5.5 * H); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 5.5 * H; }; // India time

  function parseWindow(text, t) {
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const n = /^\d+$/.test(words[i]) ? Number(words[i]) : NUMW[words[i]];
      if (n == null || !words[i + 1]) continue;
      const u = UNIT.find(([re]) => re.test(words[i + 1]));
      if (u && n > 0 && n <= 1000) return { since: t - n * u[1], label: `last ${n} ${u[2]}${n > 1 ? 's' : ''}` };
    }
    if (/\b(today|aaj|aj)\b/.test(text)) return { since: startOfDay(t), label: 'today' };
    if (/\b(yesterday|kal)\b/.test(text)) return { since: startOfDay(t) - D, until: startOfDay(t), label: 'yesterday' };
    if (/\b(this|is) (week|hafte|hafta)\b/.test(text)) return { since: t - 7 * D, label: 'last 7 days' };
    if (/\b(this|is) (month|mahine|mahina)\b/.test(text)) { const d = new Date(t + 5.5 * H); return { since: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 5.5 * H, label: 'this month' }; }
    if (/\b(this|is) (year|saal)\b/.test(text)) { const d = new Date(t + 5.5 * H); return { since: Date.UTC(d.getUTCFullYear(), 0, 1) - 5.5 * H, label: 'this year' }; }
    if (/\b(hour|ghanta|ghante)\b/.test(text)) return { since: t - H, label: 'last 1 hour' };
    if (/\b(week|hafta|hafte)\b/.test(text)) return { since: t - 7 * D, label: 'last 7 days' };
    if (/\b(month|mahina|mahine)\b/.test(text)) return { since: t - 30 * D, label: 'last 30 days' };
    return { since: 0, label: 'all time' };
  }

  const STOP = new Set(['the', 'of', 'and', 'to', 'in', 'for', 'from', 'by', 'ka', 'ki', 'ke', 'ko', 'se', 'ne', 'me', 'mein', 'shop', 'store', 'traders', 'trader', 'and', 'co', 'enterprises', 'stores', 'agency', 'agencies', 'pvt', 'ltd']);
  async function findShop(text) {
    const phone = (text.match(/\b(\d{10})\b/) || [])[1];
    if (phone) { const s = await q('SELECT s.id, s.name, s.type, s.city FROM shops s JOIN users u ON u.id=s.owner_id WHERE u.phone=?').get(phone); if (s) return s; }
    const shops = await q('SELECT id, name, type, city FROM shops ORDER BY id LIMIT 20000').all();
    let best = null, bestScore = 0;
    for (const s of shops) {
      const n = s.name.toLowerCase();
      if (n.length >= 3 && text.includes(n)) { const sc = 100 + n.length; if (sc > bestScore) { best = s; bestScore = sc; } continue; }
      const toks = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
      if (!toks.length) continue;
      const hit = toks.filter((w) => new RegExp('\\b' + w + '\\b').test(text)).length;
      const sc = hit ? (hit / toks.length) * 50 + hit : 0;
      if (hit && sc > bestScore) { best = s; bestScore = sc; }
    }
    return bestScore >= 25 ? best : null;
  }

  const inr = (v) => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const when = (w) => w.label;
  const timeSql = (w, col = 'o.created_at') => (w.until ? ` AND ${col}>=? AND ${col}<?` : ` AND ${col}>=?`);
  const timeArgs = (w) => (w.until ? [w.since, w.until] : [w.since]);
  const HELP = ['Total orders of Rahul Auto Spares in last 4 months', 'Sharma Traders sales this month', 'Top wholesalers last 30 days',
    'Active users in last 2 hours', 'New retailers this week', 'Pending verification', 'Top products last 7 days', 'Cancelled orders today',
    'Payment modes last month', 'Kal kitne order aaye'];

  async function answer(raw) {
    const text = ' ' + raw.toLowerCase().replace(/[’']/g, '') + ' ';
    const t = now(), w = parseWindow(text, t);
    const has = (re) => re.test(text);

    if (has(/\b(help|madad|kya pooch|what can)\b/) || text.trim().length < 3) return { text: 'Ask me about orders, sales, shops and activity. For example:', examples: HELP };

    if (has(/\b(online|active|live|chal rahe|dekh rahe)\b/) && !has(/\border/)) {
      const since = w.since || t - D, lbl = w.since ? when(w) : 'last 24 hours';
      const rows = await q(`SELECT u.name, u.role, u.phone, u.last_seen_at, s.name shop, s.city FROM users u LEFT JOIN shops s ON s.owner_id=u.id
        WHERE u.last_seen_at>=? AND u.role<>'admin' ORDER BY u.last_seen_at DESC LIMIT 50`).all(since);
      const online = new Set([...clients].map((x) => x.userId)).size;
      const w8 = rows.filter((r) => r.role === 'wholesaler').length;
      return { text: `${rows.length} ${rows.length === 1 ? 'person was' : 'people were'} active in the ${lbl} (${w8} wholesaler${w8 === 1 ? '' : 's'}, ${rows.length - w8} retailer${rows.length - w8 === 1 ? '' : 's'}). ${online} have the app open right now.`,
        table: { cols: ['Name', 'Shop', 'Role', 'Last active'], rows: rows.map((r) => [r.name, r.shop || '–', r.role, { ts: Number(r.last_seen_at) }]) } };
    }

    if (has(/\b(pending|verification|verify|approve|approval)\b/)) {
      const rows = await q("SELECT s.name, s.city, s.gstin, s.created_at, u.phone FROM shops s JOIN users u ON u.id=s.owner_id WHERE s.type='wholesaler' AND s.verification='pending' ORDER BY s.created_at LIMIT 100").all();
      return { text: rows.length ? `${rows.length} wholesaler${rows.length > 1 ? 's are' : ' is'} waiting for verification. Open the Shops tab to approve.` : 'No wholesalers are waiting for verification.',
        table: rows.length ? { cols: ['Shop', 'City', 'Phone', 'Signed up'], rows: rows.map((r) => [r.name, r.city, r.phone, { ts: Number(r.created_at) }]) } : null };
    }

    if (has(/\b(new|naye|naya|nayi|joined|signup|signups|sign up|registered|register)\b/) && !has(/\border/)) {
      const type = has(/wholesal/) ? 'wholesaler' : has(/retail|dukan|customer/) ? 'retailer' : null;
      const since = w.since || t - 7 * D, lbl = w.since ? when(w) : 'last 7 days';
      const rows = await q(`SELECT s.name, s.type, s.city, s.created_at, u.phone FROM shops s JOIN users u ON u.id=s.owner_id WHERE s.created_at>=?${type ? ' AND s.type=?' : ''} ORDER BY s.created_at DESC LIMIT 100`).all(...[since, ...(type ? [type] : [])]);
      return { text: `${rows.length} new ${type ? type + 's' : 'shops'} joined in the ${lbl}.`, table: rows.length ? { cols: ['Shop', 'Type', 'City', 'Joined'], rows: rows.map((r) => [r.name, r.type, r.city, { ts: Number(r.created_at) }]) } : null };
    }

    if (has(/\b(product|products|item|items|maal|best sell|selling|bikne|bika|bikta)\b/)) {
      const shop = await findShop(text);
      const where = shop ? ` AND o.${shop.type}_shop_id=?` : '';
      const rows = await q(`SELECT oi.name_snapshot n, SUM(oi.qty) qty, SUM(oi.qty*oi.unit_price_paise) v FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE ${LIVE_O}${timeSql(w)}${where} GROUP BY oi.name_snapshot ORDER BY v DESC LIMIT 10`).all(...timeArgs(w), ...(shop ? [shop.id] : []));
      return { text: rows.length ? `Top products${shop ? ' for ' + shop.name : ''}, ${when(w)}:` : `No products were ordered${shop ? ' for ' + shop.name : ''} in ${when(w)}.`,
        table: rows.length ? { cols: ['Product', 'Qty', 'Value'], rows: rows.map((r) => [r.n, Number(r.qty), inr(rs(r.v))]) } : null };
    }

    if (has(/\b(message|messages|chat|chats|baat)\b/)) {
      const n = Number((await q(`SELECT COUNT(*) n FROM messages o WHERE 1=1${timeSql(w)}`).get(...timeArgs(w))).n);
      return { text: `${n} chat message${n === 1 ? '' : 's'} were sent, ${when(w)}.` };
    }

    if (has(/\b(payment|payments|upi|cash|credit|udhaar|udhar|cod|mode|modes)\b/) && !(await findShop(text))) {
      const rows = await q(`SELECT o.payment_mode k, COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v FROM orders o WHERE ${LIVE_O}${timeSql(w)} GROUP BY o.payment_mode ORDER BY v DESC`).all(...timeArgs(w));
      const name = { upi: 'UPI', credit: 'Credit', cod: 'Cash' };
      return { text: `Orders by payment mode, ${when(w)}:`, table: { cols: ['Mode', 'Orders', 'Value'], rows: rows.map((r) => [name[r.k] || r.k, Number(r.n), inr(rs(r.v))]) } };
    }

    const cancelled = has(/\b(cancel|cancelled|canceled|radd|expired)\b/);
    const topW = has(/\btop\b|\bbest\b|\bsabse\b|\bbade\b|\bbiggest\b/) && has(/wholesal/);
    const topR = has(/\btop\b|\bbest\b|\bsabse\b|\bbade\b|\bbiggest\b/) && has(/retail|customer|dukan/);
    if (topW || topR) {
      const side = topW ? 'wholesaler' : 'retailer';
      const rows = await q(`SELECT s.name, s.city, COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v FROM orders o JOIN shops s ON s.id=o.${side}_shop_id
        WHERE ${LIVE_O}${timeSql(w)} GROUP BY s.id, s.name, s.city ORDER BY v DESC LIMIT 10`).all(...timeArgs(w));
      return { text: rows.length ? `Top ${side}s by order value, ${when(w)}:` : `No orders in ${when(w)}.`, table: rows.length ? { cols: [side === 'wholesaler' ? 'Wholesaler' : 'Retailer', 'City', 'Orders', 'Value'], rows: rows.map((r) => [r.name, r.city, Number(r.n), inr(rs(r.v))]) } : null };
    }

    // Orders / sales (default). With a shop: split by the other side (retailer -> per wholesaler, wholesaler -> per retailer).
    const shop = await findShop(text);
    const statusSql = cancelled ? " AND o.status IN ('cancelled','expired')" : ` AND ${LIVE_O}`;
    if (shop) {
      const other = shop.type === 'retailer' ? 'wholesaler' : 'retailer';
      const rows = await q(`SELECT s.name, s.city, COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v, MAX(o.created_at) last FROM orders o JOIN shops s ON s.id=o.${other}_shop_id
        WHERE o.${shop.type}_shop_id=?${statusSql}${timeSql(w)} GROUP BY s.id, s.name, s.city ORDER BY v DESC LIMIT 50`).all(shop.id, ...timeArgs(w));
      const n = rows.reduce((a, r) => a + Number(r.n), 0), v = rows.reduce((a, r) => a + Number(r.v), 0);
      const verb = cancelled ? 'cancelled orders' : 'orders';
      if (!n) return { text: `${shop.name} (${shop.type}, ${shop.city}) has no ${verb} in ${when(w)}.` };
      return { text: `${shop.name} (${shop.type}, ${shop.city}): ${n} ${verb} worth ${inr(rs(v))}, ${when(w)}, ${shop.type === 'retailer' ? 'from' : 'to'} ${rows.length} ${other}${rows.length > 1 ? 's' : ''}.`,
        table: { cols: [other === 'wholesaler' ? 'Wholesaler' : 'Retailer', 'Orders', 'Value', 'Last order'], rows: rows.map((r) => [r.name + ' · ' + r.city, Number(r.n), inr(rs(r.v)), { ts: Number(r.last) }]) } };
    }
    if (has(/\b(order|orders|sale|sales|business|gmv|revenue|bikri|kitne|kitna|total|value)\b/) || cancelled) {
      const r = await q(`SELECT COUNT(*) n, COALESCE(SUM(o.subtotal_paise),0) v FROM orders o WHERE 1=1${statusSql}${timeSql(w)}`).get(...timeArgs(w));
      const n = Number(r.n), v = rs(r.v);
      return { text: cancelled ? `${n} orders were cancelled or expired, ${when(w)} (${inr(v)}).` : `${n} orders worth ${inr(v)}, ${when(w)}${n ? `. Average order ${inr(v / n)}` : ''}.` };
    }
    return { text: "I couldn't match that to a report. Try one of these:", examples: HELP };
  }

  route('POST', '/api/admin/ask', 'admin', async (c) => {
    if (!A.hit('ask:' + c.user.id, 60, 60000)) fail(429, 'rate_limited');
    const question = A.str(c.body.q, 'q', 1, 300);
    const t0 = now(); const out = await answer(question);
    return { ...out, ms: now() - t0 };
  });
};
