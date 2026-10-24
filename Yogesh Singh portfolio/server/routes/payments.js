import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth, asyncHandler } from '../auth.js';
import { log } from '../log.js';
import * as razorpay from '../payments/razorpay.js';
import * as cashfree from '../payments/cashfree.js';
import { getOrder, markPaid, markPending, markFailed, markCancelled, applyRefund, applyDispute, recordEvent, hasEvent } from '../payments/ledger.js';

const r = Router();
const mode = config.paymentsMode;                       // razorpay | cashfree | demo | unconfigured
const provider = mode === 'cashfree' ? cashfree : razorpay;
const limit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });

const ownedOrder = (orderId, userId) => db.prepare(`SELECT o.*, m.slug FROM orders o JOIN movies m ON m.id = o.movie_id WHERE o.order_id = ? AND o.user_id = ?`).get(String(orderId || ''), userId);
// What the browser is told. Access-keeping states report PAID; access-removed states report REVOKED/REFUNDED.
const CLIENT = { CREATED: 'PENDING', PENDING: 'PENDING', PAID: 'PAID', PARTIALLY_REFUNDED: 'PAID', REFUNDED: 'REFUNDED', CHARGEBACK: 'REVOKED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };
const clientStatus = (o) => CLIENT[o.status] || 'PENDING';

r.post('/checkout', limit(config.rate.payments), requireAuth, asyncHandler(async (req, res) => {
  const movie = db.prepare("SELECT * FROM movies WHERE id = ? AND published = 1 AND status = 'ready'").get(Number(req.body.movieId));
  if (!movie) return res.status(404).json({ error: 'This film is not available right now.' });
  if (db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND movie_id = ?').get(req.user.id, movie.id))
    return res.status(409).json({ error: 'You already own this film.' });
  if (mode === 'unconfigured') return res.status(503).json({ error: 'Payments are not configured yet. Please try again later.' });

  let phone = null;
  if (mode === 'demo' || provider.requiresPhone) {
    phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);
  }

  // Close any earlier unpaid attempt so open orders do not pile up. (A late payment on one still unlocks via the ledger.)
  db.prepare("UPDATE orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE user_id = ? AND movie_id = ? AND status IN ('CREATED', 'PENDING')").run(req.user.id, movie.id);

  const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  // The order is bound to this user and this film, with the amount and currency taken from OUR database.
  db.prepare('INSERT INTO orders (order_id, user_id, movie_id, amount_paise, currency, gateway, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
    .run(orderId, req.user.id, movie.id, movie.price_paise, 'INR', mode, mode);
  log('info', 'order.created', { order: orderId, user: req.user.id, movie: movie.id, amount: movie.price_paise, provider: mode });
  if (mode === 'demo') return res.json({ mode: 'demo', orderId });

  try {
    const order = getOrder(orderId);
    const { providerOrderId, client } = await provider.createCheckout({ order, user: req.user, phone, siteUrl: config.siteUrl });
    db.prepare('UPDATE orders SET provider_order_id = ? WHERE order_id = ?').run(providerOrderId, orderId);
    res.json({ mode, ...client });
  } catch (e) {
    log('error', 'gateway.order_failed', { order: orderId, message: e.message });
    markFailed(orderId, 'gateway_order_failed');
    res.status(502).json({ error: 'We could not start the payment. You have not been charged. Please try again.' });
  }
}));

// Razorpay Checkout success callback. Never trusted on its own: signature, then Razorpay's own record of the payment.
r.post('/razorpay/verify', limit(config.rate.payments * 3), requireAuth, asyncHandler(async (req, res) => {
  if (mode !== 'razorpay') return res.status(404).end();
  const { razorpay_order_id: rzOrder, razorpay_payment_id: rzPay, razorpay_signature: sig } = req.body || {};
  const order = db.prepare("SELECT * FROM orders WHERE provider = 'razorpay' AND provider_order_id = ? AND user_id = ?").get(String(rzOrder || ''), req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!razorpay.verifyPaymentSignature(rzOrder, rzPay, sig)) {
    log('warn', 'payment.bad_signature', { order: order.order_id });
    return res.status(400).json({ error: 'Payment could not be verified.' });
  }
  const slug = db.prepare('SELECT slug FROM movies WHERE id = ?').get(order.movie_id).slug;
  let pay;
  try { pay = await razorpay.fetchPayment(rzPay); }
  catch (e) { log('error', 'gateway.fetch_payment_failed', { order: order.order_id, message: e.message }); return res.json({ status: 'PENDING', orderId: order.order_id, slug }); }
  if (pay.order_id !== rzOrder) return res.status(400).json({ error: 'Payment could not be verified.' });
  let status = 'PENDING';
  if (pay.status === 'captured') {
    const result = markPaid(order.order_id, { providerPaymentId: pay.id, amountPaise: pay.amount, currency: pay.currency });
    status = result.ok ? 'PAID' : 'FAILED';
  } else if (pay.status === 'failed') { markFailed(order.order_id, pay.error_description || 'payment_failed'); status = 'FAILED'; }
  else markPending(order.order_id);
  res.json({ status, orderId: order.order_id, slug });
}));

r.post('/cancel', limit(config.rate.payments * 3), requireAuth, (req, res) => {
  const o = ownedOrder(req.body.orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  markCancelled(o.order_id);
  res.json({ status: clientStatus(getOrder(o.order_id)) });
});

// Local-only: pretend the gateway succeeded. Does not exist when a real provider is configured.
r.post('/demo/complete', requireAuth, (req, res) => {
  if (mode !== 'demo') return res.status(404).end();
  const o = ownedOrder(req.body.orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  markPaid(o.order_id, { providerPaymentId: `demo_${o.order_id}`, amountPaise: o.amount_paise, currency: o.currency });
  res.json({ status: 'PAID' });
});

// The payment-return page asks here; the answer comes from our records and, if still open, from the gateway.
r.get('/verify', limit(config.rate.payments * 6), requireAuth, asyncHandler(async (req, res) => {
  let o = ownedOrder(req.query.order_id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (['CREATED', 'PENDING', 'CANCELLED'].includes(o.status) && (mode === 'razorpay' || mode === 'cashfree')) {
    try {
      const rec = await provider.reconcile(o);
      if (rec.state === 'PAID') markPaid(o.order_id, { providerPaymentId: rec.paymentId, amountPaise: rec.amountPaise, currency: rec.currency });
      else if (rec.state === 'FAILED') markFailed(o.order_id, 'expired');
    } catch (e) { log('error', 'gateway.reconcile_failed', { order: o.order_id, message: e.message }); }
    o = ownedOrder(o.order_id, req.user.id);
  }
  res.json({ status: clientStatus(o), slug: o.slug });
}));

/** Applies one verified, normalised gateway event to the ledger. Always fetches authoritative data the payload lacks. */
async function applyEvent(ev) {
  const order = mode === 'razorpay'
    ? (ev.providerOrderId && db.prepare("SELECT * FROM orders WHERE provider = 'razorpay' AND provider_order_id = ?").get(ev.providerOrderId))
      || (ev.paymentId && db.prepare("SELECT * FROM orders WHERE provider = 'razorpay' AND provider_payment_id = ?").get(ev.paymentId))
    : getOrder(ev.orderId || '');
  if (!order) return { order: null, note: 'unknown_order' };

  switch (ev.type) {
    case 'paid': {
      let paid = { paymentId: ev.paymentId, amountPaise: ev.amountPaise, currency: ev.currency };
      const complete = paid.paymentId && Number.isInteger(paid.amountPaise) && paid.currency;
      if (mode === 'cashfree' || !complete || (ev.paymentStatus && ev.paymentStatus !== 'captured')) {
        // Cashfree webhooks and any payload with missing fields are never trusted for money: ask the gateway.
        paid = await provider.authoritativePayment(order, ev.paymentId);
        if (!paid) return { order, note: 'not_paid_at_gateway' };
      }
      const res = markPaid(order.order_id, { providerPaymentId: paid.paymentId, amountPaise: paid.amountPaise, currency: paid.currency });
      return { order, note: res.ok ? 'paid' : res.reason };
    }
    case 'failed': markFailed(order.order_id, ev.failure || 'payment_failed'); return { order, note: 'failed' };
    case 'refunded': {
      let amount = ev.refundAmountPaise;
      if (!Number.isInteger(amount) && mode === 'razorpay' && ev.refundId) { try { amount = (await razorpay.fetchRefund(ev.refundId)).amount; } catch { /* handled below */ } }
      const res = applyRefund(order.order_id, { refundId: ev.refundId, amountPaise: amount });
      return { order, note: res.ok ? res.status : res.reason };
    }
    case 'dispute_open': case 'dispute_won': case 'dispute_closed': case 'dispute_lost': {
      const res = applyDispute(order.order_id, ev.type.replace('dispute_', ''));
      return { order, note: res.ok ? ev.type : res.reason };
    }
    default: return { order, note: 'ignored' };
  }
}

/** Gateway → server notification. Mounted with a raw body parser (see app.js); the signature is checked on the exact bytes. */
export const webhook = asyncHandler(async (req, res) => {
  if (mode !== 'razorpay' && mode !== 'cashfree') return res.status(404).end();
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const h = req.headers;
  const valid = mode === 'razorpay'
    ? razorpay.verifyWebhookSignature(raw, h['x-razorpay-signature'])
    : cashfree.verifyWebhook(raw, h['x-webhook-signature'], h['x-webhook-timestamp']);
  if (!valid) { log('warn', 'webhook.bad_signature', { provider: mode }); return res.status(401).end(); }

  let ev;
  try { ev = provider.parseWebhook(raw, h); } catch { return res.status(400).end(); }
  if (hasEvent(mode, ev.eventId)) return res.json({ ok: true, duplicate: true });

  let out;
  try { out = await applyEvent(ev); }
  catch (e) { log('error', 'webhook.apply_failed', { provider: mode, event: ev.raw, message: e.message }); return res.status(500).end(); }   // gateway will retry; nothing recorded
  log('info', 'webhook.processed', { provider: mode, event: ev.raw, order: out.order?.order_id, result: out.note });
  // If the gateway does not (yet) confirm the payment, leave the event unrecorded so a redelivery can still succeed.
  if (out.note !== 'not_paid_at_gateway') recordEvent(mode, ev.eventId, ev.raw, out.order?.order_id || null);
  res.json({ ok: true });
});

export default r;
