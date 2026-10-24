import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, tx } from '../db.js';
import { requireAuth, asyncHandler } from '../auth.js';
import * as cashfree from '../cashfree.js';

const r = Router();

/** Idempotently mark an order paid and unlock the film. */
export function fulfil(orderId) {
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    if (!o) return;
    if (o.status !== 'PAID') db.prepare("UPDATE orders SET status = 'PAID', paid_at = datetime('now') WHERE order_id = ?").run(orderId);
    db.prepare('INSERT OR IGNORE INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, ?)').run(o.user_id, o.movie_id, orderId);
  });
}

r.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
  const movie = db.prepare("SELECT * FROM movies WHERE id = ? AND published = 1 AND status = 'ready'").get(Number(req.body.movieId));
  if (!movie) return res.status(404).json({ error: 'This film is not available right now.' });
  if (db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND movie_id = ?').get(req.user.id, movie.id))
    return res.status(409).json({ error: 'You already own this film.' });
  if (config.paymentsMode === 'unconfigured') return res.status(503).json({ error: 'Payments are not configured yet.' });

  const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);

  const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  // Price always comes from the database, never from the browser.
  db.prepare('INSERT INTO orders (order_id, user_id, movie_id, amount_paise, gateway) VALUES (?, ?, ?, ?, ?)')
    .run(orderId, req.user.id, movie.id, movie.price_paise, config.paymentsMode);

  if (config.paymentsMode === 'demo') return res.json({ mode: 'demo', orderId });

  const order = await cashfree.createOrder({
    orderId, amountPaise: movie.price_paise, user: req.user, phone,
    returnUrl: `${config.siteUrl}/payment-return.html?order_id=${orderId}`,
    notifyUrl: `${config.siteUrl}/api/payments/webhook`,
  });
  res.json({ mode: 'cashfree', sdkMode: config.cashfree.sdkMode, orderId, paymentSessionId: order.payment_session_id });
}));

// Local-only: pretend the gateway succeeded.
r.post('/demo/complete', requireAuth, (req, res) => {
  if (config.paymentsMode !== 'demo') return res.status(404).end();
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ? AND user_id = ?').get(String(req.body.orderId), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  fulfil(o.order_id);
  res.json({ status: 'PAID' });
});

// The return page calls this; we ask Cashfree directly for the truth.
r.get('/verify', requireAuth, asyncHandler(async (req, res) => {
  const o = db.prepare(`SELECT o.*, m.slug FROM orders o JOIN movies m ON m.id = o.movie_id WHERE o.order_id = ? AND o.user_id = ?`).get(String(req.query.order_id || ''), req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  let status = o.status;
  if (status !== 'PAID' && config.paymentsMode === 'cashfree') {
    const cfStatus = await cashfree.fetchOrderStatus(o.order_id);
    if (cfStatus === 'PAID') { fulfil(o.order_id); status = 'PAID'; }
    else if (cfStatus === 'EXPIRED' || cfStatus === 'TERMINATED') { db.prepare("UPDATE orders SET status = 'FAILED' WHERE order_id = ?").run(o.order_id); status = 'FAILED'; }
    else status = 'PENDING';
  }
  res.json({ status, slug: o.slug });
}));

// Cashfree server-to-server notification. Mounted with a raw body parser (see index.js).
export const webhook = asyncHandler(async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!cashfree.verifyWebhook(raw, req.get('x-webhook-signature'), req.get('x-webhook-timestamp'))) return res.status(401).end();
  const orderId = JSON.parse(raw)?.data?.order?.order_id;
  if (orderId && db.prepare('SELECT 1 FROM orders WHERE order_id = ?').get(orderId)) {
    // Re-check with the API instead of trusting the payload.
    if ((await cashfree.fetchOrderStatus(orderId)) === 'PAID') fulfil(orderId);
  }
  res.json({ ok: true });
});

export default r;
