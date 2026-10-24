import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth, asyncHandler } from '../auth.js';
import * as razorpay from '../payments/razorpay.js';
import * as cashfree from '../payments/cashfree.js';
import { getOrder, markPaid, markFailed, markCancelled, markRefunded, recordEvent, hasEvent } from '../payments/ledger.js';

const r = Router();
const mode = config.paymentsMode;                       // razorpay | cashfree | demo | unconfigured
const provider = mode === 'cashfree' ? cashfree : razorpay;
const limit = (max) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });

const ownedOrder = (orderId, userId) => db.prepare(`SELECT o.*, m.slug FROM orders o JOIN movies m ON m.id = o.movie_id WHERE o.order_id = ? AND o.user_id = ?`).get(String(orderId || ''), userId);
const clientStatus = (o) => (o.status === 'CREATED' ? 'PENDING' : o.status);

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
  db.prepare("UPDATE orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE user_id = ? AND movie_id = ? AND status = 'CREATED'").run(req.user.id, movie.id);

  const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  // Amount and currency always come from our database.
  db.prepare('INSERT INTO orders (order_id, user_id, movie_id, amount_paise, currency, gateway, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
    .run(orderId, req.user.id, movie.id, movie.price_paise, 'INR', mode, mode);
  if (mode === 'demo') return res.json({ mode: 'demo', orderId });

  try {
    const order = getOrder(orderId);
    const { providerOrderId, client } = await provider.createCheckout({ order, user: req.user, phone, siteUrl: config.siteUrl });
    db.prepare('UPDATE orders SET provider_order_id = ? WHERE order_id = ?').run(providerOrderId, orderId);
    res.json({ mode, ...client });
  } catch (e) {
    console.error('[payments] could not create gateway order:', e.message);
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
    console.warn(`[payments] invalid Razorpay signature for order ${order.order_id}`);
    return res.status(400).json({ error: 'Payment could not be verified.' });
  }
  const slug = db.prepare('SELECT slug FROM movies WHERE id = ?').get(order.movie_id).slug;
  let pay;
  try { pay = await razorpay.fetchPayment(rzPay); }
  catch (e) { console.error('[payments] fetch payment failed:', e.message); return res.json({ status: 'PENDING', orderId: order.order_id, slug }); }
  if (pay.order_id !== rzOrder) return res.status(400).json({ error: 'Payment could not be verified.' });
  let status = 'PENDING';
  if (pay.status === 'captured') {
    const result = markPaid(order.order_id, { providerPaymentId: pay.id, amountPaise: pay.amount, currency: pay.currency });
    status = result.ok ? 'PAID' : 'FAILED';
    if (!result.ok) console.error(`[payments] order ${order.order_id} rejected: ${result.reason}`);
  } else if (pay.status === 'failed') { markFailed(order.order_id, pay.error_description || 'payment_failed'); status = 'FAILED'; }
  res.json({ status, orderId: order.order_id, slug });
}));

r.post('/cancel', limit(config.rate.payments * 3), requireAuth, (req, res) => {
  const o = ownedOrder(req.body.orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  markCancelled(o.order_id);
  res.json({ status: clientStatus(getOrder(o.order_id)) });
});

// Local-only: pretend the gateway succeeded.
r.post('/demo/complete', requireAuth, (req, res) => {
  if (mode !== 'demo') return res.status(404).end();
  const o = ownedOrder(req.body.orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  markPaid(o.order_id, { amountPaise: o.amount_paise, currency: o.currency });
  res.json({ status: 'PAID' });
});

// The payment-return page asks here; the answer comes from our records and, if still open, from the gateway.
r.get('/verify', limit(config.rate.payments * 6), requireAuth, asyncHandler(async (req, res) => {
  let o = ownedOrder(req.query.order_id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (['CREATED', 'CANCELLED'].includes(o.status) && (mode === 'razorpay' || mode === 'cashfree')) {
    try {
      const rec = await provider.reconcile(o);
      if (rec.state === 'PAID') markPaid(o.order_id, { providerPaymentId: rec.paymentId, amountPaise: rec.amountPaise, currency: rec.currency });
      else if (rec.state === 'FAILED') markFailed(o.order_id, 'expired');
    } catch (e) { console.error('[payments] reconcile failed:', e.message); }
    o = ownedOrder(o.order_id, req.user.id);
  }
  res.json({ status: clientStatus(o), slug: o.slug });
}));

/** Gateway → server notification. Mounted with a raw body parser (see app.js); signature is checked on the exact bytes. */
export const webhook = asyncHandler(async (req, res) => {
  if (mode !== 'razorpay' && mode !== 'cashfree') return res.status(404).end();
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const h = req.headers;
  const valid = mode === 'razorpay'
    ? razorpay.verifyWebhookSignature(raw, h['x-razorpay-signature'])
    : cashfree.verifyWebhook(raw, h['x-webhook-signature'], h['x-webhook-timestamp']);
  if (!valid) return res.status(401).end();

  let ev;
  try { ev = provider.parseWebhook(raw, h); } catch { return res.status(400).end(); }
  if (hasEvent(mode, ev.eventId)) return res.json({ ok: true, duplicate: true });

  const order = mode === 'razorpay'
    ? db.prepare("SELECT * FROM orders WHERE provider = 'razorpay' AND provider_order_id = ?").get(ev.providerOrderId || '')
    : getOrder(ev.orderId || '');
  if (order) {
    if (ev.type === 'paid') {
      if (mode === 'cashfree' && (await cashfree.fetchOrderStatus(order.order_id)) !== 'PAID') return res.json({ ok: true, ignored: true });
      const r1 = markPaid(order.order_id, { providerPaymentId: ev.paymentId, amountPaise: ev.amountPaise, currency: ev.currency });
      if (!r1.ok) console.error(`[payments] webhook for ${order.order_id} rejected: ${r1.reason}`);
    } else if (ev.type === 'failed') markFailed(order.order_id, ev.failure || 'payment_failed');
    else if (ev.type === 'refunded' && ev.fullRefund) markRefunded(order.order_id);
  }
  recordEvent(mode, ev.eventId, ev.raw, order?.order_id || null);
  res.json({ ok: true });
});

export default r;
