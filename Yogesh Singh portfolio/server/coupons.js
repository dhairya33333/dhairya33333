// Discount codes. The browser can only SUBMIT a code. The discount, the final price and the minimum are all decided here.
import { db } from './db.js';

export const MIN_PRICE_PAISE = 100;                       // a film is never free by coupon: the floor is Rs 1
export const normalise = (c) => String(c ?? '').trim().toUpperCase().replace(/\s+/g, '');
const CODE = /^[A-Z0-9_-]{3,24}$/;
export const validCode = (c) => CODE.test(c);

const used = (code) => db.prepare("SELECT COUNT(*) n FROM orders WHERE coupon_code = ? AND (status IN ('PAID','PARTIALLY_REFUNDED') OR (status IN ('CREATED','PENDING') AND created_at > datetime('now','-1 hour')))").get(code).n;

/** { ok: true, code, discountPaise, finalPaise } or { ok: false }. The caller shows ONE generic message for every failure (no code guessing). */
export function quote({ movie, userId, code }) {
  const c = normalise(code);
  const row = validCode(c) && db.prepare('SELECT * FROM coupons WHERE code = ?').get(c);
  if (!row || !row.active) return { ok: false };
  if (row.expires_on && new Date(`${row.expires_on}T23:59:59Z`) < new Date()) return { ok: false };
  if (row.movie_id && row.movie_id !== movie.id) return { ok: false };
  if (row.max_uses && used(c) >= row.max_uses) return { ok: false };
  if (userId && db.prepare("SELECT 1 FROM orders WHERE user_id = ? AND coupon_code = ? AND status IN ('PAID','PARTIALLY_REFUNDED')").get(userId, c)) return { ok: false };   // once per person
  const raw = row.percent ? Math.floor((movie.price_paise * row.percent) / 100) : row.amount_paise;
  const finalPaise = Math.max(MIN_PRICE_PAISE, movie.price_paise - raw);
  const discountPaise = Math.max(0, movie.price_paise - finalPaise);
  return { ok: true, code: c, discountPaise, finalPaise };
}
export { used as couponUses };
