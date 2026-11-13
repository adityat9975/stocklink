import { S, app } from './state.js';

// Prevents double-submits: disables buttons while an async action runs.
export async function withBusy(fn) {
  if (S.busy) return;
  S.busy = true; app.render();
  try { await fn(); } finally { S.busy = false; app.render(); }
}
