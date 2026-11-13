'use strict';
// Browser-facing security headers (strict CSP: scripts and styles only from this origin).
function securityHeaders(cfg) {
  const h = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()'
  };
  if (cfg.prod) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

module.exports = { securityHeaders };
