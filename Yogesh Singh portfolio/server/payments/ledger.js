// The single place that changes order/purchase state. Every path (browser verify, webhook, reconcile, admin) goes through
// here, so these rules hold no matter how often or in what order notifications arrive. Each change is one SQLite
// transaction and every transition is logged (references only, never secrets).
//
// Order states:  CREATED -> PENDING -> PAID -> PARTIALLY_REFUNDED -> REFUNDED
//                CREATED/PENDING -> FAILED | CANCELLED ;  PAID -> CHARGEBACK (dispute lost / admin revoke)
//
// ACCESS POLICY (documented in docs/PAYMENTS.md):
//   PAID, PARTIALLY_REFUNDED  -> access kept   (a partial refund is a goodwill gesture, not a withdrawal of the sale)
//   REFUNDED (refunds total >= price), CHARGEBACK -> access revoked immediately
//   open dispute -> access kept, order flagged for the admin to review
import { db, tx } from '../db.js';
import { log } from '../log.js';

const now = "datetime('now')";
const OPEN = ['CREATED', 'PENDING', 'CANCELLED', 'FAILED'];       // states a successful payment may still complete

export const getOrder = (orderId) => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);

/** Leave a visible reason on the order (shown in Admin → Orders) when a payment is rejected. */
function flag(orderId, reason) {
  db.prepare(`UPDATE orders SET failure_reason = ?, updated_at = ${now} WHERE order_id = ?`).run(reason, orderId);
}

function transition(o, to, ref = {}) {
  log('info', 'order.transition', { order: o.order_id, from: o.status, to, provider: o.provider, ...ref });
}

/**
 * Marks an order paid and unlocks the film. Idempotent.
 * The paid amount, currency and payment id MUST be supplied by verified gateway data. A missing value is a rejection, never a skipped check.
 */
export function markPaid(orderId, { providerPaymentId, amountPaise, currency } = {}) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    if (!Number.isInteger(amountPaise) || typeof currency !== 'string' || !currency || !providerPaymentId) {
      log('warn', 'payment.rejected', { order: orderId, reason: 'missing_verified_fields' });
      return { ok: false, reason: 'missing_verified_fields' };
    }
    if (amountPaise !== o.amount_paise) { flag(orderId, 'amount_mismatch'); log('warn', 'payment.rejected', { order: orderId, reason: 'amount_mismatch', expected: o.amount_paise, got: amountPaise }); return { ok: false, reason: 'amount_mismatch' }; }
    if (currency.toUpperCase() !== o.currency) { flag(orderId, 'currency_mismatch'); log('warn', 'payment.rejected', { order: orderId, reason: 'currency_mismatch' }); return { ok: false, reason: 'currency_mismatch' }; }
    if (['REFUNDED', 'CHARGEBACK'].includes(o.status)) return { ok: false, reason: o.status.toLowerCase() };   // never re-unlocks
    const other = db.prepare('SELECT order_id FROM orders WHERE provider = ? AND provider_payment_id = ? AND order_id <> ?').get(o.provider, providerPaymentId, orderId);
    if (other) { flag(orderId, 'payment_reused'); log('warn', 'payment.rejected', { order: orderId, reason: 'payment_reused', other: other.order_id }); return { ok: false, reason: 'payment_reused' }; }

    if (OPEN.includes(o.status)) {
      db.prepare(`UPDATE orders SET status = 'PAID', paid_at = ${now}, updated_at = ${now}, failure_reason = NULL, provider_payment_id = ? WHERE order_id = ?`).run(providerPaymentId, orderId);
      transition(o, 'PAID', { payment: providerPaymentId });
    } else if (o.provider_payment_id && o.provider_payment_id !== providerPaymentId) {
      return { ok: false, reason: 'already_paid_with_other_payment' };
    }
    db.prepare('INSERT OR IGNORE INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, ?)').run(o.user_id, o.movie_id, orderId);
    return { ok: true, order: getOrder(orderId) };
  });
}

/** A payment is in flight (e.g. authorized, not yet captured). Grants nothing. */
export function markPending(orderId) {
  const o = getOrder(orderId);
  if (o && ['CREATED', 'CANCELLED'].includes(o.status)) {
    db.prepare(`UPDATE orders SET status = 'PENDING', updated_at = ${now} WHERE order_id = ?`).run(orderId);
    transition(o, 'PENDING');
  }
}

/** A failed attempt only matters while the order is still open; it can never downgrade a paid order. */
export function markFailed(orderId, reason = 'payment_failed') {
  const o = getOrder(orderId);
  if (!o || !['CREATED', 'PENDING', 'CANCELLED'].includes(o.status)) return;
  db.prepare(`UPDATE orders SET status = 'FAILED', failure_reason = ?, updated_at = ${now} WHERE order_id = ?`).run(String(reason).slice(0, 200), orderId);
  transition(o, 'FAILED', { reason: String(reason).slice(0, 80) });
}

export function markCancelled(orderId) {
  const o = getOrder(orderId);
  if (!o || !['CREATED', 'PENDING'].includes(o.status)) return;
  db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ${now} WHERE order_id = ?`).run(orderId);
  transition(o, 'CANCELLED');
}

/**
 * Records one refund (idempotent per gateway refund id) and recomputes the total from the refund rows.
 * "Full" is judged against OUR stored order amount, not against numbers inside a webhook payload.
 */
export function applyRefund(orderId, { refundId, amountPaise } = {}) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    if (!refundId || !Number.isInteger(amountPaise) || amountPaise <= 0) { log('warn', 'refund.rejected', { order: orderId, reason: 'missing_refund_fields' }); return { ok: false, reason: 'missing_refund_fields' }; }
    if (['CREATED', 'PENDING', 'FAILED', 'CANCELLED'].includes(o.status)) return { ok: false, reason: 'order_not_paid' };
    const added = db.prepare('INSERT OR IGNORE INTO refunds (provider, refund_id, order_id, amount_paise) VALUES (?, ?, ?, ?)').run(o.provider, refundId, orderId, amountPaise).changes === 1;
    const total = db.prepare('SELECT COALESCE(SUM(amount_paise), 0) t FROM refunds WHERE order_id = ?').get(orderId).t;
    if (o.status === 'CHARGEBACK') return { ok: true, status: 'CHARGEBACK', added };
    if (total >= o.amount_paise) {
      db.prepare(`UPDATE orders SET status = 'REFUNDED', refunded_paise = ?, refunded_at = COALESCE(refunded_at, ${now}), updated_at = ${now} WHERE order_id = ?`).run(total, orderId);
      db.prepare('DELETE FROM purchases WHERE order_id = ?').run(orderId);
      if (o.status !== 'REFUNDED') transition(o, 'REFUNDED', { refund: refundId, refunded_paise: total });
      return { ok: true, status: 'REFUNDED', added };
    }
    db.prepare(`UPDATE orders SET status = 'PARTIALLY_REFUNDED', refunded_paise = ?, updated_at = ${now} WHERE order_id = ?`).run(total, orderId);
    if (o.status !== 'PARTIALLY_REFUNDED' || added) transition(o, 'PARTIALLY_REFUNDED', { refund: refundId, refunded_paise: total });
    return { ok: true, status: 'PARTIALLY_REFUNDED', added };
  });
}

/** Disputes: an open dispute only flags the order; a lost dispute (or an admin decision) revokes access. */
export function applyDispute(orderId, state) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    if (state === 'lost') return revokeInner(o, 'CHARGEBACK', 'lost');
    if (['open', 'won', 'closed'].includes(state)) {
      db.prepare(`UPDATE orders SET dispute_status = ?, updated_at = ${now} WHERE order_id = ?`).run(state, orderId);
      log('warn', 'order.dispute', { order: orderId, state });
      return { ok: true, status: o.status };
    }
    return { ok: false, reason: 'unknown_state' };
  });
}

function revokeInner(o, to, dispute = null) {
  db.prepare(`UPDATE orders SET status = ?, dispute_status = COALESCE(?, dispute_status), updated_at = ${now} WHERE order_id = ?`).run(to, dispute, o.order_id);
  db.prepare('DELETE FROM purchases WHERE order_id = ?').run(o.order_id);
  transition(o, to, { dispute });
  return { ok: true, status: to };
}

/** Admin decision to withdraw access for an order (fraud, chargeback handled outside the gateway). */
export function adminRevoke(orderId) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) return { ok: false, reason: 'unknown_order' };
    return revokeInner(o, 'CHARGEBACK');
  });
}

/** Returns true the first time an event id is seen, false for redeliveries. */
export function recordEvent(provider, eventId, type, orderRef) {
  return db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, type, order_ref) VALUES (?, ?, ?, ?)').run(provider, eventId, type, orderRef).changes === 1;
}
export const hasEvent = (provider, eventId) =>
  !!db.prepare('SELECT 1 FROM payment_events WHERE provider = ? AND event_id = ?').get(provider, eventId);
