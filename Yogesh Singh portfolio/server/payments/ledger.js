// The single place that changes order/purchase state. Every path (browser verify, webhook, reconcile) goes through here,
// so the rules below hold no matter how often or in what order notifications arrive.
import { db, tx } from '../db.js';

const now = "datetime('now')";

export const getOrder = (orderId) => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);

/** Marks an order paid and unlocks the film. Idempotent. Rejects a payment whose amount/currency differ from our order. */
export function markPaid(orderId, { providerPaymentId = null, amountPaise = null, currency = null } = {}) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    if (amountPaise != null && Number(amountPaise) !== o.amount_paise) return { ok: false, reason: 'amount_mismatch' };
    if (currency != null && String(currency).toUpperCase() !== o.currency) return { ok: false, reason: 'currency_mismatch' };
    if (o.status === 'REFUNDED') return { ok: false, reason: 'refunded' };   // a refunded order never re-unlocks
    if (o.status !== 'PAID') {
      db.prepare(`UPDATE orders SET status = 'PAID', paid_at = ${now}, updated_at = ${now}, failure_reason = NULL,
        provider_payment_id = COALESCE(?, provider_payment_id) WHERE order_id = ?`).run(providerPaymentId, orderId);
    }
    db.prepare('INSERT OR IGNORE INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, ?)').run(o.user_id, o.movie_id, orderId);
    return { ok: true, order: getOrder(orderId) };
  });
}

/** A failed attempt only matters while the order is still open; it can never downgrade a paid order. */
export function markFailed(orderId, reason = 'payment_failed') {
  db.prepare(`UPDATE orders SET status = 'FAILED', failure_reason = ?, updated_at = ${now} WHERE order_id = ? AND status IN ('CREATED', 'CANCELLED')`).run(String(reason).slice(0, 200), orderId);
}

export function markCancelled(orderId) {
  db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ${now} WHERE order_id = ? AND status = 'CREATED'`).run(orderId);
}

/** Full refund: record it and revoke access granted by this order. Admin-granted (order_id NULL) access is untouched. */
export function markRefunded(orderId) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    db.prepare(`UPDATE orders SET status = 'REFUNDED', refunded_at = ${now}, updated_at = ${now} WHERE order_id = ?`).run(orderId);
    db.prepare('DELETE FROM purchases WHERE order_id = ?').run(orderId);
    return { ok: true };
  });
}

/** Returns true the first time an event id is seen, false for redeliveries. */
export function recordEvent(provider, eventId, type, orderRef) {
  const r = db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, type, order_ref) VALUES (?, ?, ?, ?)').run(provider, eventId, type, orderRef);
  return r.changes === 1;
}

export const hasEvent = (provider, eventId) =>
  !!db.prepare('SELECT 1 FROM payment_events WHERE provider = ? AND event_id = ?').get(provider, eventId);
