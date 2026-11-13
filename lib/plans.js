'use strict';
/* Plans, trials and access state for wholesalers (blueprint section 6).
   Nothing here is hard-coded: price, period, trial, grace and limits come from the plans Super Admin creates.
   A business with no subscription row has never been put on a plan and keeps full access (launch mode). */
const DAY = 86400000;

function stateOf(sub, now = Date.now()) {
  if (!sub) return { state: 'none', active: true, can_sell: true, days_left: null };
  if (sub.suspended_at) return { state: 'suspended', active: false, can_sell: false, days_left: 0, reason: sub.suspend_reason || '' };
  const end = Number(sub.paid_until), graceEnd = end + Number(sub.grace_days) * DAY;
  if (now < end) return { state: sub.cancelled_at ? 'cancelled' : sub.kind === 'trial' ? 'trial' : 'active', active: true, can_sell: true, days_left: Math.ceil((end - now) / DAY), until: end };
  if (now < graceEnd) return { state: 'grace', active: true, can_sell: true, days_left: Math.ceil((graceEnd - now) / DAY), until: graceEnd };
  return { state: 'expired', active: false, can_sell: false, days_left: 0, since: graceEnd };
}

function createPlans(q) {
  const subOf = (shopId) => q(`SELECT s.*, p.name AS plan_name, p.max_products, p.max_retailers, p.max_staff, p.period_days
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.shop_id = ?`).get(shopId);
  async function access(shopId) { const sub = await subOf(shopId); return { sub, ...stateOf(sub) }; }
  return { subOf, access, stateOf };
}
module.exports = { createPlans, stateOf, DAY };
