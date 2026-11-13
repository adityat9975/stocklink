import { S } from './state.js';
import { authView } from '../features/auth.js';
import { shell } from '../ui/shell.js';
import { modalView } from '../ui/modals.js';

// Entrance animation plays once when a screen opens (or its data first arrives), never on later refreshes.
let lastKey = '';
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function enterKey() {
  if (!S.me) return 'auth';
  const ready = S.tab === 'today' ? !!S.d.dash : S.tab === 'home' ? !!S.d.orders : S.tab === 'dash' ? !!S.d.dash : true;
  return S.me.role + ':' + S.tab + ':' + ready;
}
function countUp(root) {
  for (const el of root.querySelectorAll('[data-countup]')) {
    const target = Number(el.dataset.countup) || 0, kind = el.dataset.fmt, final = el.textContent;
    if (!target) continue;
    const cur = (S.cfg && S.cfg.currency) || '₹';
    const fmt = (v) => (kind === 'money' ? cur + Math.round(v / 100).toLocaleString('en-IN') : Math.round(v).toLocaleString('en-IN'));
    const t0 = performance.now(), dur = 750;
    const step = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      if (!el.isConnected) return; el.textContent = p < 1 ? fmt(target * e) : final; if (p < 1) requestAnimationFrame(step); };
    el.textContent = fmt(0); requestAnimationFrame(step);
  }
}

export function render() {
  const root = document.getElementById('root');
  if (!root) return;
  const a = document.activeElement;
  const fid = a && a.id && root.contains(a) ? a.id : null;
  const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  const y = window.scrollY;
  document.documentElement.lang = S.lang === 'hi' ? 'hi-Latn' : 'en';
  root.innerHTML = !S.cfg ? '' : !S.me ? authView().s : shell().s;
  if (S.me && S.modal) root.insertAdjacentHTML('beforeend', modalView().s);
  const k = enterKey(), page = root.querySelector('.page');
  if (k !== lastKey) { lastKey = k; if (page && !reduce()) { page.classList.add('enter'); countUp(page); } }
  window.scrollTo(0, y);
  if (!fid) return;
  const el = document.getElementById(fid);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (sel && el.setSelectionRange && /^(text|tel|password|search)$/.test(el.type)) {
    try { el.setSelectionRange(sel[0], sel[1]); } catch (_) { /* unsupported input type */ }
  }
}
