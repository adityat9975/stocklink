import { S, app } from './core/state.js';
import { render } from './core/render.js';
import { load, go } from './core/data.js';
import { boot } from './core/session.js';
import { initLive } from './core/live.js';
import { modalActions, closeModal, sizesTotal } from './ui/modals.js';
import { authActions, submitAuth } from './features/auth.js';
import { retailerActions, proofPicked } from './features/retailer.js';
import { wholesalerActions, productPhotosPicked } from './features/wholesaler.js';
import { adminActions } from './features/admin.js';
import { chatActions } from './features/chat.js';
import { insightActions } from './features/insights.js';
import { planActions } from './features/plans.js';
import { notesActions, onNotify, openTab } from './features/notes.js';
import { initDevice } from './core/device.js';

Object.assign(app, { render, load, go, onNotify });

// data-act="name" -> handler(data-id). Later spreads win; role modules never share names except ordtab (same logic).
const ACT = { ...authActions, ...modalActions, ...notesActions, ...retailerActions, ...wholesalerActions, ...adminActions, ...chatActions, ...insightActions, ...planActions, tab: go };

document.addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.bd) return closeModal();
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = ACT[b.dataset.act];
  if (fn) { e.preventDefault(); fn(b.dataset.id); }
  else if (/^plpick_\d+$/.test(b.dataset.act)) { e.preventDefault(); S.form[b.dataset.act] = b.dataset.id; app.render(); } // plan picker per shop
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal) closeModal(); });
document.addEventListener('input', (e) => {
  const d = e.target.dataset;
  if (d && d.f) S.form[d.f] = e.target.value;
  if (d && d.sz) {
    const [i, k] = d.sz.split(':');
    S.form.psizes[+i][k] = e.target.value;
    const el = document.getElementById('sztotal');
    if (el) el.textContent = sizesTotal();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'aPhotos') { productPhotosPicked([...el.files]); el.value = ''; }
  else if (el.dataset && el.dataset.proof && el.files[0]) proofPicked(el.dataset.proof, el.files[0]);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  if (ACT[f.dataset.form] && /search$/.test(f.dataset.form)) return ACT[f.dataset.form]();
  submitAuth(f.dataset.form);
});

initLive();
boot();
initDevice({ onChange: () => app.render(), onOpenTab: openTab });
