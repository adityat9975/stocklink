// Single shared UI state plus late-bound hooks (set by main.js) so modules never import each other in cycles.
export const S = {
  cfg: null, me: null,
  lang: (navigator.language || 'en').toLowerCase().startsWith('hi') ? 'hi' : 'en',
  authMode: 'login', authErr: '', form: {},
  tab: '', d: {}, sel: { wid: null }, cart: { wid: null, items: {} }, checkout: null,
  modal: null, open: {}, chat: null, live: false, pendingRefresh: false, busy: false, prevAvail: {},
};

export const TABS = {
  retailer: ['home', 'catalog', 'orders', 'chat', 'wholesalers'],
  wholesaler: ['today', 'retailers', 'stock', 'orders', 'chat'],
  admin: ['dash', 'ask', 'shops', 'plans', 'audit'],
};

export const FLOW = ['received', 'paid', 'packed', 'dispatched', 'completed'];
export const FINAL = ['completed', 'cancelled', 'expired'];

export const app = { render() {}, load() {}, go() {}, onNotify() {} };

// Mirrors the server's role permissions, only to hide buttons a member cannot use (the server still checks).
const PERMS = { owner: ['*'], manager: ['catalog', 'stock', 'orders', 'network', 'chat', 'buy'], staff: ['stock', 'orders', 'chat'] };
export const can = (perm) => { const r = S.me && S.me.member_role; const l = PERMS[r] || (S.me && S.me.role === 'admin' ? ['*'] : []); return l.includes('*') || l.includes(perm); };
