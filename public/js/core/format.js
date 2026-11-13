import { I18N } from '../i18n.js';
import { S } from './state.js';

export const t = (k, v) => {
  let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.en[k] ?? k;
  if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]);
  return s;
};

export const money = (p) =>
  ((S.cfg && S.cfg.currency) || '₹') +
  (p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

export const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return t('just_now');
  if (m < 60) return t('min_ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('hr_ago', { n: h });
  return t('day_ago', { n: Math.round(h / 24) });
};

export const clock = (ts) =>
  new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const longDate = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

export const firstName = () => (S.me.name || '').split(' ')[0];
