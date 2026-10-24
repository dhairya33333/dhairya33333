import crypto from 'node:crypto';
import { config } from '../config.js';

const rz = config.razorpay;
const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${rz.keyId}:${rz.keySecret}`).toString('base64'), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${data?.error?.description || 'request failed'}`);
  return data;
}

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Checkout success callback signature: HMAC_SHA256(razorpay_order_id|razorpay_payment_id, key_secret) */
export function verifyPaymentSignature(rzOrderId, rzPaymentId, signature) {
  if (!rzOrderId || !rzPaymentId || !signature) return false;
  return safeEqualHex(hmacHex(rz.keySecret, `${rzOrderId}|${rzPaymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook_secret), header X-Razorpay-Signature */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !rz.webhookSecret) return false;
  return safeEqualHex(hmacHex(rz.webhookSecret, rawBody), signature);
}

export const name = 'razorpay';
export const requiresPhone = false;

// Amount and currency are ours (from the database), never taken from the browser.
export async function createCheckout({ order, user }) {
  const rzOrder = await call('POST', '/orders', {
    amount: order.amount_paise, currency: order.currency, receipt: order.order_id, notes: { order_id: order.order_id },
  });
  return {
    providerOrderId: rzOrder.id,
    client: { provider: 'razorpay', keyId: rz.keyId, razorpayOrderId: rzOrder.id, amount: order.amount_paise, currency: order.currency, orderId: order.order_id, prefill: { name: user.name, email: user.email } },
  };
}

export const fetchPayment = (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`);

/** Asks Razorpay what actually happened to an order. Used when the browser/webhook result is missing. */
export async function reconcile(order) {
  if (!order.provider_order_id) return { state: 'PENDING' };
  const list = await call('GET', `/orders/${encodeURIComponent(order.provider_order_id)}/payments`);
  const paid = (list.items || []).find((p) => p.status === 'captured' && p.amount === order.amount_paise && String(p.currency).toUpperCase() === order.currency);
  if (paid) return { state: 'PAID', paymentId: paid.id, amountPaise: paid.amount, currency: paid.currency };
  return { state: 'PENDING' };
}

export const fetchRefund = (refundId) => call('GET', `/refunds/${encodeURIComponent(refundId)}`);

/**
 * Authoritative paid data for an order, straight from Razorpay's API (used when a webhook omits amount/currency/payment id).
 * Returns null unless a CAPTURED payment that belongs to this order exists.
 */
export async function authoritativePayment(order, paymentId = null) {
  if (paymentId) {
    const p = await fetchPayment(paymentId);
    return p.order_id === order.provider_order_id && p.status === 'captured' ? { paymentId: p.id, amountPaise: p.amount, currency: p.currency } : null;
  }
  const rec = await reconcile(order);
  return rec.state === 'PAID' ? { paymentId: rec.paymentId, amountPaise: rec.amountPaise, currency: rec.currency } : null;
}

const EVENT_TYPES = {
  'payment.captured': 'paid', 'order.paid': 'paid', 'payment.failed': 'failed', 'refund.processed': 'refunded',
  'payment.dispute.created': 'dispute_open', 'payment.dispute.under_review': 'dispute_open',
  'payment.dispute.won': 'dispute_won', 'payment.dispute.lost': 'dispute_lost', 'payment.dispute.closed': 'dispute_closed',
};
const int = (v) => (Number.isInteger(v) ? v : null);

/** Normalises a verified webhook body. Missing fields stay null so the caller must fetch authoritative data. */
export function parseWebhook(rawBody, headers) {
  const body = JSON.parse(rawBody);
  const pay = body?.payload?.payment?.entity, ord = body?.payload?.order?.entity;
  const refund = body?.payload?.refund?.entity, dispute = body?.payload?.dispute?.entity;
  return {
    eventId: headers['x-razorpay-event-id'] || `${body.event}:${pay?.id || refund?.id || dispute?.id || body.created_at}`,
    type: EVENT_TYPES[body.event] || 'ignored', raw: body.event,
    providerOrderId: pay?.order_id || ord?.id || null,
    paymentId: pay?.id || refund?.payment_id || dispute?.payment_id || null,
    amountPaise: int(pay?.amount) ?? int(ord?.amount_paid), currency: pay?.currency || ord?.currency || null,
    paymentStatus: pay?.status || null,
    failure: pay?.error_description || null,
    refundId: refund?.id || null, refundAmountPaise: int(refund?.amount),
  };
}
