'use strict';
// Offline GSTIN validation: format, state code, PAN pattern and the mod-36 check digit.
// This proves the number is well-formed. It does NOT prove the business exists or is active.
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = CH.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(v / 36) + (v % 36); }
  return CH[(36 - (sum % 36)) % 36];
}
function validate(raw) {
  const g = String(raw || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false };
  if (!STATES[g.slice(0, 2)]) return { ok: false };
  if (checkChar(g.slice(0, 14)) !== g[14]) return { ok: false };
  return { ok: true, gstin: g, state: STATES[g.slice(0, 2)], pan: g.slice(2, 12) };
}
const stateOf = (g) => (g && STATES[String(g).slice(0, 2)]) || null;
module.exports = { validate, checkChar, stateOf };
