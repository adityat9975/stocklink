// Auto-escaping HTML template tag. Every interpolated value is escaped unless it
// was produced by html`` itself or wrapped in raw(). This makes XSS-by-default impossible.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(String(s));

const part = (v) => {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
};

export const html = (strings, ...vals) =>
  new Safe(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? part(vals[i]) : ''), ''));

// attribute map -> escaped attribute string. true => bare attribute, false/null => omitted.
export const attrs = (o = {}) =>
  raw(Object.entries(o).filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(' '));
