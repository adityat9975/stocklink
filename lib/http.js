'use strict';
// HTTP layer: security headers, static files, CSRF checks, JSON body handling, routing and error mapping.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const A = require('./auth');
const { fail, HttpError } = A;
const { securityHeaders } = require('./security');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', json: 'application/json; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', apk: 'application/vnd.android.package-archive', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', webmanifest: 'application/manifest+json' };

/* Every file under public/ is served; nothing else on disk is reachable. Rescanned per file in dev so edits show on refresh. */
function scanStatics(dir = PUBLIC_DIR, base = '') {
  const map = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name, abs = path.join(dir, e.name);
    if (e.isDirectory()) { for (const [k, v] of scanStatics(abs, rel)) map.set(k, v); continue; }
    const type = TYPES[e.name.split('.').pop()]; if (!type) continue;
    // Text files are gzipped once in memory (most phones are on slow mobile data); every file gets an ETag so repeat visits are a 304.
    const pack = (body) => ({ body, gz: /^(text|application\/(json|xml|manifest))|svg/.test(type) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null,
      etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"' });
    const entry = { type, ...pack(fs.readFileSync(abs)), mtime: fs.statSync(abs).mtimeMs,
      refresh() { try { const m = fs.statSync(abs).mtimeMs; if (m !== entry.mtime) { Object.assign(entry, pack(fs.readFileSync(abs))); entry.mtime = m; } } catch (_) {} } };
    map.set(rel, entry);
  }
  return map;
}

function createHttpServer({ cfg, routes: R, services }) {
  const statics = scanStatics();
  const baseHeaders = () => securityHeaders(cfg);
  function clientIp(req) {
    if (cfg.trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (x.length) return x[x.length - 1].slice(0, 64); }
    return req.socket.remoteAddress || 'unknown';
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0, over = false; const chunks = [];
      req.on('data', (d) => { size += d.length; if (size > limit) { if (!over) { over = true; reject(new HttpError(413, 'body_too_large')); } return; } if (!over) chunks.push(d); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function send(res, status, obj, extra) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...baseHeaders(), ...(extra || {}) });
    res.end(body);
  }


  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req);
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (_) { res.writeHead(400); return res.end(); }
    const p = url.pathname;
    try {
      if (!p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'method_not_allowed');
        if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
        const file = p === '/' ? 'index.html' : p.slice(1).replace(/\/$/, '');
        // Website pages: /download -> download/index.html or download.html
        const hit = statics.get(file) || statics.get(file + '/index.html') || statics.get(file + '.html');
        if (!hit) { res.writeHead(404, { 'Content-Type': 'text/plain', ...baseHeaders() }); return res.end('Not found'); }
        if (!cfg.prod) hit.refresh();
        const h = { 'Content-Type': hit.type, 'Cache-Control': 'no-cache', ETag: hit.etag, Vary: 'Accept-Encoding', ...baseHeaders() };
        if (req.headers['if-none-match'] === hit.etag) { res.writeHead(304, h); return res.end(); }
        const gz = hit.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (gz) h['Content-Encoding'] = 'gzip';
        res.writeHead(200, h);
        return res.end(req.method === 'HEAD' ? undefined : gz ? hit.gz : hit.body);
      }
      if (!A.hit('ip:' + ip, 900, 60000)) fail(429, 'rate_limited');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-requested-with'] !== 'StockLink') fail(403, 'csrf');
        const origin = req.headers.origin;
        if (origin) { let h = null; try { h = new URL(origin).host; } catch (_) {} if (h !== req.headers.host) fail(403, 'csrf'); }
      }
      let matched = null, params = {};
      for (const r of R) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p); if (!m) continue;
        matched = r; r.keys.forEach((k, i) => { params[k] = m[i + 1]; }); break;
      }
      if (!matched) fail(404, 'not_found');
      let user = null, shop = null;
      if (matched.auth) {
        user = await services.sessionUser(req);
        if (!user) fail(401, 'not_authenticated');
        if (user.role !== 'admin') {
          // One login can run several businesses. The page names the business it acts for on every request
          // (X-Business); it must be one the user is a member of. Without it, the session's active business is used.
          const mems = await services.q('SELECT m.role AS member_role, s.* FROM memberships m JOIN shops s ON s.id = m.shop_id WHERE m.user_id = ? ORDER BY m.id').all(user.id);
          const want = req.headers['x-business'] ? Number(req.headers['x-business']) : null;
          if (want) { shop = mems.find((x) => x.id === want) || null; if (!shop) fail(403, 'not_member'); }
          else shop = mems.find((x) => x.id === user.active_shop_id) || mems[0] || null;
          user = { ...user, role: shop ? shop.type : user.role, member_role: shop ? shop.member_role : null,
            businesses: mems.map((x) => ({ id: x.id, type: x.type, name: x.name, city: x.city, verification: x.verification, member_role: x.member_role })) };
        }
        if (matched.auth !== 'any' && user.role !== matched.auth) fail(403, 'forbidden');
        // Super Admin pages need the second factor; only the 2FA setup endpoints are open before it.
        if (user.role === 'admin' && cfg.admin2fa && !user.mfa_ok && !p.startsWith('/api/admin/2fa') && p !== '/api/me' && p !== '/api/logout' && p !== '/api/stream') fail(403, 'mfa_required');
        if (matched.auth !== 'admin' && matched.auth !== 'any' && !shop) fail(403, 'forbidden');
        if (matched.perm) A.need(user, matched.perm);
      }
      let body = {};
      if (req.method === 'POST') {
        const raw = await readBody(req, matched.big ? 3 * 1024 * 1024 : 32 * 1024);
        if (raw.length) {
          if (!/^application\/json/i.test(req.headers['content-type'] || '')) fail(415, 'json_required');
          try { body = JSON.parse(raw.toString('utf8')); } catch (_) { fail(400, 'invalid_json'); }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_json');
        }
      }
      const out = await matched.handler({ req, res, params, body, user, shop, ip, query: url.searchParams });
      if (out && out.streaming) return;
      if (out && out.raw) {
        res.writeHead(200, { 'Content-Type': out.mime, 'Cache-Control': 'private, max-age=60', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin' });
        return res.end(out.raw);
      }
      send(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) {
        if (!res.headersSent) send(res, e.status, { error: e.code, ...e.extra }, e.status === 413 ? { Connection: 'close' } : undefined);
        if (e.status === 413) res.once('finish', () => req.destroy());
        return;
      }
      console.error('server_error', req.method, p, e && e.message);
      if (!res.headersSent) send(res, 500, { error: 'server_error' });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
  server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
  return server;
}
module.exports = { createHttpServer };
