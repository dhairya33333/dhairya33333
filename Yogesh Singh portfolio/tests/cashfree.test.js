import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, signedUpUser } from './helpers.js';

const SECRET = 'cf_secret_test';
let t;
const realFetch = globalThis.fetch;
const gw = { payments: {}, orderStatus: {}, calls: [] };       // what our fake Cashfree knows, by our order id
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://sandbox.cashfree.com/pg')) return realFetch(url, init);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
  const p = u.replace('https://sandbox.cashfree.com/pg', ''); gw.calls.push(`${init.method || 'GET'} ${p}`);
  assert.equal(init.headers['x-client-secret'], SECRET); assert.equal(init.headers['x-api-version'], '2023-08-01');
  let m;
  if (p === '/orders' && init.method === 'POST') { const b = JSON.parse(init.body); gw.lastOrder = b; gw.orderStatus[b.order_id] = 'ACTIVE'; return json({ order_id: b.order_id, payment_session_id: 'session_xyz', order_status: 'ACTIVE' }); }
  if ((m = /^\/orders\/([^/]+)\/payments$/.exec(p))) return json(gw.payments[m[1]] || []);
  if ((m = /^\/orders\/([^/]+)$/.exec(p))) return json({ order_status: gw.orderStatus[m[1]] || 'ACTIVE' });
  return json({}, 404);
};

before(async () => {
  t = await boot({ PAYMENT_PROVIDER: 'cashfree', CASHFREE_ENV: 'sandbox', CASHFREE_APP_ID: 'cf_app', CASHFREE_SECRET_KEY: SECRET });
  assert.equal(t.config.paymentsMode, 'cashfree');
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, status, validated, published) VALUES ('film', 'Film', 29900, 'ready', 1, 1)").run();
});
after(async () => { globalThis.fetch = realFetch; await t.close(); });

const movieId = () => t.db.prepare("SELECT id FROM movies WHERE slug='film'").get().id;
const owns = (email) => !!t.db.prepare('SELECT 1 FROM purchases p JOIN users u ON u.id=p.user_id WHERE u.email = ?').get(email);
const order = (id) => t.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
let seq = 5550000;
const success = (orderId, over = {}) => ({ cf_payment_id: ++seq, payment_status: 'SUCCESS', payment_amount: 299, payment_currency: 'INR', ...over });
async function buy(email) {
  const c = await signedUpUser(t, email);
  const r = await c.post('/api/payments/checkout', { agree: true, movieId: movieId(), phone: '9876543210' });
  assert.equal(r.status, 200, r.text);
  return { c, ...r.json };
}
function hook(type, data, { secret = SECRET, ts = String(Date.now()) } = {}) {
  const raw = JSON.stringify({ type, event_time: ts, data });
  const sig = crypto.createHmac('sha256', secret).update(ts + raw).digest('base64');
  return t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'content-type': 'application/json', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts } });
}

test('checkout: server price in rupees, bound to our order id, mobile number required, secrets not exposed', async () => {
  const c = await signedUpUser(t, 'cf0@example.com');
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: movieId() })).status, 400, 'phone required');
  const r = await c.post('/api/payments/checkout', { agree: true, movieId: movieId(), phone: '9876543210', amount: 1 });
  assert.equal(r.status, 200);
  assert.equal(gw.lastOrder.order_amount, 299); assert.equal(gw.lastOrder.order_currency, 'INR');
  assert.equal(r.json.paymentSessionId, 'session_xyz');
  assert.ok(!r.text.includes(SECRET));
  assert.equal(order(r.json.orderId).amount_paise, 29900);
});

test('webhook success: amount, currency and payment id come from the gateway API, not the payload', async () => {
  const a = await buy('cf1@example.com');
  gw.payments[a.orderId] = [success(a.orderId)];
  // payload lies about the amount; the API says 299 INR
  const r = await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: a.orderId }, payment: { cf_payment_id: gw.payments[a.orderId][0].cf_payment_id, payment_amount: 1, payment_currency: 'INR', payment_status: 'SUCCESS' } });
  assert.equal(r.status, 200);
  assert.equal(owns('cf1@example.com'), true);
  const o = order(a.orderId); assert.equal(o.status, 'PAID'); assert.equal(o.provider_payment_id, String(gw.payments[a.orderId][0].cf_payment_id));
  assert.ok(gw.calls.some((c) => c.endsWith(`/orders/${a.orderId}/payments`)));
});

test('webhook success but the gateway shows no successful payment: nothing granted, event can be redelivered', async () => {
  const a = await buy('cf2@example.com');
  const pend = success(a.orderId, { payment_status: 'PENDING' }); gw.payments[a.orderId] = [pend];
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: a.orderId }, payment: { cf_payment_id: pend.cf_payment_id } }, { ts: '111' });
  assert.equal(owns('cf2@example.com'), false);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM payment_events WHERE order_ref = ?").get(a.orderId).c, 0);
  pend.payment_status = 'SUCCESS';
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: a.orderId }, payment: { cf_payment_id: pend.cf_payment_id } }, { ts: '111' });
  assert.equal(owns('cf2@example.com'), true);
});

test('wrong amount or currency from the gateway is rejected and flagged', async () => {
  const a = await buy('cf3@example.com'); gw.payments[a.orderId] = [success(a.orderId, { payment_amount: 100 })];
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: a.orderId }, payment: { cf_payment_id: (gw.payments[a.orderId] || [{}])[0].cf_payment_id } });
  assert.equal(owns('cf3@example.com'), false); assert.equal(order(a.orderId).failure_reason, 'amount_mismatch');
  const b = await buy('cf3b@example.com'); gw.payments[b.orderId] = [success(b.orderId, { payment_currency: 'USD' })];
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: b.orderId }, payment: { cf_payment_id: (gw.payments[b.orderId] || [{}])[0].cf_payment_id } });
  assert.equal(owns('cf3b@example.com'), false);
  const c = await buy('cf3c@example.com'); gw.payments[c.orderId] = [success(c.orderId, { payment_amount: 299.5 })];
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: c.orderId }, payment: { cf_payment_id: (gw.payments[c.orderId] || [{}])[0].cf_payment_id } });
  assert.equal(owns('cf3c@example.com'), false, 'rupee decimals are converted to exact paise and compared');
});

test('invalid webhook signature, wrong secret, tampered body and stale-timestamp mismatch are rejected', async () => {
  const a = await buy('cf4@example.com'); gw.payments[a.orderId] = [success(a.orderId)];
  const data = { order: { order_id: a.orderId }, payment: { cf_payment_id: (gw.payments[a.orderId] || [{}])[0].cf_payment_id } };
  assert.equal((await hook('PAYMENT_SUCCESS_WEBHOOK', data, { secret: 'wrong' })).status, 401);
  const raw = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data }); const ts = '123';
  const sig = crypto.createHmac('sha256', SECRET).update(ts + raw).digest('base64');
  assert.equal((await t.client().req('POST', '/api/payments/webhook', { raw: raw.replace(String(gw.payments[a.orderId][0].cf_payment_id), '9999999'), headers: { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts } })).status, 401, 'tampered body');
  assert.equal((await t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'x-webhook-signature': sig, 'x-webhook-timestamp': '124' } })).status, 401, 'timestamp is part of the signature');
  assert.equal(owns('cf4@example.com'), false);
});

test('duplicate webhook deliveries are safe', async () => {
  const a = await buy('cf5@example.com'); gw.payments[a.orderId] = [success(a.orderId)];
  const body = { order: { order_id: a.orderId }, payment: { cf_payment_id: (gw.payments[a.orderId] || [{}])[0].cf_payment_id } };
  const rs = await Promise.all(Array.from({ length: 4 }, () => hook('PAYMENT_SUCCESS_WEBHOOK', body, { ts: '777' })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM purchases WHERE order_id = ?').get(a.orderId).c, 1);
});

test('reconciliation after a missed webhook restores the right state (paid, failed, still pending)', async () => {
  const a = await buy('cf6@example.com');
  assert.equal((await a.c.get(`/api/payments/verify?order_id=${a.orderId}`)).json.status, 'PENDING');
  gw.payments[a.orderId] = [success(a.orderId)];
  assert.equal((await a.c.get(`/api/payments/verify?order_id=${a.orderId}`)).json.status, 'PAID');
  assert.equal(owns('cf6@example.com'), true); assert.equal(order(a.orderId).provider_payment_id, String(gw.payments[a.orderId][0].cf_payment_id));
  const b = await buy('cf6b@example.com'); gw.orderStatus[b.orderId] = 'EXPIRED';
  assert.equal((await b.c.get(`/api/payments/verify?order_id=${b.orderId}`)).json.status, 'FAILED');
  assert.equal(owns('cf6b@example.com'), false);
});

test("another user's order cannot be verified or used to unlock", async () => {
  const a = await buy('cf7@example.com'); const thief = await signedUpUser(t, 'cf7thief@example.com');
  gw.payments[a.orderId] = [success(a.orderId)];
  assert.equal((await thief.get(`/api/payments/verify?order_id=${a.orderId}`)).status, 404);
  assert.equal(owns('cf7thief@example.com'), false);
});

test('refunds: partial keeps access (policy), cumulative full revokes, duplicates ignored', async () => {
  const a = await buy('cf8@example.com'); gw.payments[a.orderId] = [success(a.orderId)];
  await hook('PAYMENT_SUCCESS_WEBHOOK', { order: { order_id: a.orderId }, payment: { cf_payment_id: (gw.payments[a.orderId] || [{}])[0].cf_payment_id } });
  const refund = (id, amt, ts) => hook('REFUND_STATUS_WEBHOOK', { refund: { order_id: a.orderId, cf_refund_id: id, refund_amount: amt, refund_status: 'SUCCESS' } }, { ts });
  await refund('r1', 100, '1');
  assert.equal(order(a.orderId).status, 'PARTIALLY_REFUNDED'); assert.equal(owns('cf8@example.com'), true);
  await refund('r1', 100, '2');
  assert.equal(order(a.orderId).refunded_paise, 10000);
  await hook('REFUND_STATUS_WEBHOOK', { refund: { order_id: a.orderId, cf_refund_id: 'r3', refund_amount: 199, refund_status: 'PENDING' } }, { ts: '3' });
  assert.equal(order(a.orderId).refunded_paise, 10000, 'only SUCCESS refunds count');
  await refund('r2', 199, '4');
  assert.equal(order(a.orderId).status, 'REFUNDED'); assert.equal(owns('cf8@example.com'), false);
});

test('direct calls cannot grant access in cashfree mode either', async () => {
  const c = await signedUpUser(t, 'cf9@example.com');
  assert.equal((await c.post('/api/payments/demo/complete', { orderId: 'x' })).status, 404);
  assert.equal((await c.post('/api/payments/razorpay/verify', {})).status, 404);
  assert.equal(owns('cf9@example.com'), false);
});
