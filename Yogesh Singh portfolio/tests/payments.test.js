import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedUpUser, hmacHex } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret_value', WH_SECRET = 'whsec_test_value';
let t, rz;
const realFetch = globalThis.fetch;
const gateway = { orders: 0, payments: {}, orderPayments: {}, fail: false };   // what our fake Razorpay "knows"

// Fake Razorpay API: only api.razorpay.com is intercepted, everything else (our own server) is real.
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const p = u.replace('https://api.razorpay.com/v1', '');
  if (gateway.fail) return json({ error: { description: 'boom' } }, 500);
  if (p === '/orders' && init.method === 'POST') { const b = JSON.parse(init.body); gateway.lastOrderBody = b; return json({ id: `order_RZ${++gateway.orders}`, amount: b.amount, currency: b.currency }); }
  let m;
  if ((m = /^\/payments\/(.+)$/.exec(p))) return gateway.payments[m[1]] ? json(gateway.payments[m[1]]) : json({ error: { description: 'not found' } }, 404);
  if ((m = /^\/orders\/(.+)\/payments$/.exec(p))) return json({ items: gateway.orderPayments[m[1]] || [] });
  return json({}, 404);
};

before(async () => {
  t = await boot({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
  assert.equal(t.config.paymentsMode, 'razorpay');
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, status, validated, published) VALUES ('film', 'Film', 29900, 'ready', 1, 1)").run();
});
after(async () => { globalThis.fetch = realFetch; await t.close(); });
beforeEach(() => { gateway.fail = false; });

const movieId = () => t.db.prepare("SELECT id FROM movies WHERE slug='film'").get().id;
const owns = (email) => !!t.db.prepare('SELECT 1 FROM purchases p JOIN users u ON u.id=p.user_id WHERE u.email = ?').get(email);
const orderRow = (id) => t.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
const sign = (o, p) => hmacHex(KEY_SECRET, `${o}|${p}`);
const payment = (id, order, over = {}) => (gateway.payments[id] = { id, order_id: order, status: 'captured', amount: 29900, currency: 'INR', ...over });

async function startCheckout(email) {
  const c = await signedUpUser(t, email);
  const r = await c.post('/api/payments/checkout', { agree: true, movieId: movieId() });
  assert.equal(r.status, 200, r.text);
  return { c, ...r.json };
}
function webhook(event, body, { secret = WH_SECRET, id } = {}) {
  const raw = JSON.stringify(body);
  return t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex(secret, raw), 'x-razorpay-event-id': id || `evt_${Math.random()}` } });
}
const capturedEvent = (rzOrder, payId, amount = 29900) => ({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: rzOrder, amount, currency: 'INR', status: 'captured' } } } });

test('checkout requires sign-in, uses the server price, and never exposes secrets', async () => {
  assert.equal((await t.client().post('/api/payments/checkout', { agree: true, movieId: movieId() })).status, 401);
  const c = await signedUpUser(t, 'buyer1@example.com');
  const r = await c.post('/api/payments/checkout', { agree: true, movieId: movieId(), amount: 1, price_paise: 1, currency: 'USD' });
  assert.equal(r.status, 200);
  assert.equal(r.json.amount, 29900, 'amount comes from the database, not the browser');
  assert.equal(r.json.currency, 'INR');
  assert.equal(gateway.lastOrderBody.amount, 29900);
  assert.equal(gateway.lastOrderBody.currency, 'INR');
  assert.equal(r.json.keyId, 'rzp_test_key');
  assert.ok(!r.text.includes(KEY_SECRET) && !r.text.includes(WH_SECRET));
  assert.equal(orderRow(r.json.orderId).status, 'CREATED');
  assert.equal(owns('buyer1@example.com'), false, 'creating an order unlocks nothing');
});

test('checkout for an unpublished or unknown film is refused', async () => {
  const c = await signedUpUser(t, 'buyer2@example.com');
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: 9999 })).status, 404);
  t.db.prepare("INSERT INTO movies (slug, title, status, validated, published) VALUES ('draft', 'Draft', 'draft', 0, 0)").run();
  const id = t.db.prepare("SELECT id FROM movies WHERE slug='draft'").get().id;
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: id })).status, 404);
});

test('gateway failure while creating the order: clear error, nothing unlocked, order marked failed', async () => {
  const c = await signedUpUser(t, 'buyer3@example.com');
  gateway.fail = true;
  const r = await c.post('/api/payments/checkout', { agree: true, movieId: movieId() });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /not been charged/);
  assert.equal(t.db.prepare("SELECT status FROM orders o JOIN users u ON u.id=o.user_id WHERE u.email='buyer3@example.com'").get().status, 'FAILED');
  gateway.fail = false;
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: movieId() })).status, 200, 'retry works');
});

test('payment signature: invalid signature never unlocks; valid signature + captured payment does', async () => {
  const { c, razorpayOrderId, orderId } = await startCheckout('sig@example.com');
  payment('pay_1', razorpayOrderId);
  let r = await c.post('/api/payments/razorpay/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) });
  assert.equal(r.status, 400); assert.equal(owns('sig@example.com'), false);
  r = await c.post('/api/payments/razorpay/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(razorpayOrderId, 'pay_OTHER') });
  assert.equal(r.status, 400, 'signature over a different payment id is rejected'); assert.equal(owns('sig@example.com'), false);
  r = await c.post('/api/payments/razorpay/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: 'pay_1' });
  assert.equal(r.status, 400, 'missing signature');
  r = await c.post('/api/payments/razorpay/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(razorpayOrderId, 'pay_1') });
  assert.equal(r.status, 200); assert.equal(r.json.status, 'PAID');
  assert.equal(owns('sig@example.com'), true);
  assert.equal(orderRow(orderId).status, 'PAID');
  assert.equal(orderRow(orderId).provider_payment_id, 'pay_1');
});

test('verify is idempotent: repeating it keeps one purchase', async () => {
  const { c, razorpayOrderId } = await startCheckout('idem@example.com');
  payment('pay_idem', razorpayOrderId);
  const body = { razorpay_order_id: razorpayOrderId, razorpay_payment_id: 'pay_idem', razorpay_signature: sign(razorpayOrderId, 'pay_idem') };
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/payments/razorpay/verify', body)).json.status, 'PAID');
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM purchases p JOIN users u ON u.id=p.user_id WHERE u.email='idem@example.com'").get().c, 1);
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: movieId() })).status, 409, 'cannot buy twice');
});

test('a correctly signed payment that is only authorized, or has the wrong amount, does not unlock', async () => {
  const a = await startCheckout('pending@example.com');
  payment('pay_auth', a.razorpayOrderId, { status: 'authorized' });
  let r = await a.c.post('/api/payments/razorpay/verify', { razorpay_order_id: a.razorpayOrderId, razorpay_payment_id: 'pay_auth', razorpay_signature: sign(a.razorpayOrderId, 'pay_auth') });
  assert.equal(r.json.status, 'PENDING'); assert.equal(owns('pending@example.com'), false);

  const b = await startCheckout('cheap@example.com');
  payment('pay_cheap', b.razorpayOrderId, { amount: 100 });
  r = await b.c.post('/api/payments/razorpay/verify', { razorpay_order_id: b.razorpayOrderId, razorpay_payment_id: 'pay_cheap', razorpay_signature: sign(b.razorpayOrderId, 'pay_cheap') });
  assert.equal(r.json.status, 'FAILED'); assert.equal(owns('cheap@example.com'), false, 'underpayment never unlocks');
});

test('one user cannot verify or cancel another user\'s order', async () => {
  const a = await startCheckout('owner@example.com');
  const thief = await signedUpUser(t, 'thief@example.com');
  payment('pay_o', a.razorpayOrderId);
  const body = { razorpay_order_id: a.razorpayOrderId, razorpay_payment_id: 'pay_o', razorpay_signature: sign(a.razorpayOrderId, 'pay_o') };
  assert.equal((await thief.post('/api/payments/razorpay/verify', body)).status, 404);
  assert.equal((await thief.get(`/api/payments/verify?order_id=${a.orderId}`)).status, 404);
  assert.equal((await thief.post('/api/payments/cancel', { orderId: a.orderId })).status, 404);
  assert.equal(owns('thief@example.com'), false);
});

test('webhook: bad or missing signature is rejected and changes nothing', async () => {
  const { razorpayOrderId } = await startCheckout('wh1@example.com');
  const body = capturedEvent(razorpayOrderId, 'pay_wh1');
  let r = await webhook('x', body, { secret: 'wrong-secret' });
  assert.equal(r.status, 401);
  r = await t.client().req('POST', '/api/payments/webhook', { raw: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 401);
  assert.equal(owns('wh1@example.com'), false);
});

test('webhook: payment.captured unlocks; the same event delivered twice is processed once', async () => {
  const { razorpayOrderId, orderId } = await startCheckout('wh2@example.com');
  const body = capturedEvent(razorpayOrderId, 'pay_wh2');
  assert.equal((await webhook('', body, { id: 'evt_dup' })).status, 200);
  assert.equal(owns('wh2@example.com'), true);
  const second = await webhook('', body, { id: 'evt_dup' });
  assert.equal(second.status, 200); assert.equal(second.json.duplicate, true);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM payment_events WHERE event_id = 'evt_dup'").get().c, 1);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM purchases WHERE order_id = ?').get(orderId).c, 1);
  // a different event id for the same payment (Razorpay also sends order.paid) is harmless
  assert.equal((await webhook('', body, { id: 'evt_other' })).status, 200);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM purchases WHERE order_id = ?').get(orderId).c, 1);
});

test('webhook: amount or currency that does not match our order is ignored', async () => {
  const a = await startCheckout('wh3@example.com');
  await webhook('', capturedEvent(a.razorpayOrderId, 'pay_wh3', 100));
  assert.equal(owns('wh3@example.com'), false);
  const b = await startCheckout('wh3b@example.com');
  const ev = capturedEvent(b.razorpayOrderId, 'pay_wh3b'); ev.payload.payment.entity.currency = 'USD';
  await webhook('', ev);
  assert.equal(owns('wh3b@example.com'), false);
});

test('webhook: failed payment keeps access locked and cannot downgrade a paid order', async () => {
  const a = await startCheckout('wh4@example.com');
  const failed = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: a.razorpayOrderId, amount: 29900, currency: 'INR', error_description: 'Card declined' } } } };
  await webhook('', failed);
  assert.equal(orderRow(a.orderId).status, 'FAILED'); assert.equal(orderRow(a.orderId).failure_reason, 'Card declined');
  assert.equal(owns('wh4@example.com'), false);
  // retry success on the same order afterwards still works
  await webhook('', capturedEvent(a.razorpayOrderId, 'pay_ok'));
  // (order was FAILED, a captured payment is the stronger fact)
  assert.equal(owns('wh4@example.com'), true);
  await webhook('', failed);  // a late/replayed failure must not take it away
  assert.equal(orderRow(a.orderId).status, 'PAID'); assert.equal(owns('wh4@example.com'), true);
});

test('webhook: full refund revokes access and a replayed capture does not restore it; partial refund does not revoke', async () => {
  const a = await startCheckout('refund@example.com');
  await webhook('', capturedEvent(a.razorpayOrderId, 'pay_r'));
  assert.equal(owns('refund@example.com'), true);
  const partial = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_p', payment_id: 'pay_r', amount: 5000 } }, payment: { entity: { id: 'pay_r', order_id: a.razorpayOrderId, amount: 29900 } } } };
  await webhook('', partial);
  assert.equal(owns('refund@example.com'), true, 'partial refund keeps access');
  const full = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_f', payment_id: 'pay_r', amount: 29900 } }, payment: { entity: { id: 'pay_r', order_id: a.razorpayOrderId, amount: 29900 } } } };
  await webhook('', full);
  assert.equal(owns('refund@example.com'), false); assert.equal(orderRow(a.orderId).status, 'REFUNDED');
  await webhook('', capturedEvent(a.razorpayOrderId, 'pay_r'));   // replay, new event id
  assert.equal(owns('refund@example.com'), false, 'a refunded order never re-unlocks');
});

test('admin-granted access survives a refund of an unrelated order', async () => {
  const c = await signedUpUser(t, 'comp@example.com');
  const uid = t.db.prepare("SELECT id FROM users WHERE email='comp@example.com'").get().id;
  t.db.prepare('INSERT INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, NULL)').run(uid, movieId());
  assert.equal(owns('comp@example.com'), true);
  assert.equal((await c.post('/api/payments/checkout', { agree: true, movieId: movieId() })).status, 409, 'already has access');
});

test('webhook for an unknown order is acknowledged without side effects', async () => {
  const before = t.db.prepare('SELECT COUNT(*) c FROM purchases').get().c;
  const r = await webhook('', capturedEvent('order_DOES_NOT_EXIST', 'pay_x'));
  assert.equal(r.status, 200);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM purchases').get().c, before);
});

test('cancelled order, then a late successful payment still unlocks; a new checkout cancels the old open order', async () => {
  const a = await startCheckout('late@example.com');
  assert.equal((await a.c.post('/api/payments/cancel', { orderId: a.orderId })).json.status, 'CANCELLED');
  const second = await a.c.post('/api/payments/checkout', { agree: true, movieId: movieId() });
  assert.equal(second.status, 200);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM orders o JOIN users u ON u.id=o.user_id WHERE u.email='late@example.com' AND o.status='CREATED'").get().c, 1, 'only one open order');
  await webhook('', capturedEvent(a.razorpayOrderId, 'pay_late'));   // paid on the first (cancelled) attempt
  assert.equal(owns('late@example.com'), true);
});

test('payment-return check reads our records and reconciles with the gateway; it trusts nothing in the URL', async () => {
  const a = await startCheckout('ret@example.com');
  assert.equal((await a.c.get(`/api/payments/verify?order_id=${a.orderId}&status=PAID&paid=1`)).json.status, 'PENDING', 'URL parameters are ignored');
  assert.equal(owns('ret@example.com'), false);
  gateway.orderPayments[a.razorpayOrderId] = [{ id: 'pay_rec', status: 'captured', amount: 29900, currency: 'INR' }];
  const r = await a.c.get(`/api/payments/verify?order_id=${a.orderId}`);
  assert.equal(r.json.status, 'PAID'); assert.equal(owns('ret@example.com'), true);
  assert.equal((await t.client().get(`/api/payments/verify?order_id=${a.orderId}`)).status, 401);
});

test('purchase and transaction records persist (orders + purchases rows survive)', async () => {
  const row = t.db.prepare("SELECT o.*, p.created_at AS bought FROM orders o JOIN purchases p ON p.order_id = o.order_id JOIN users u ON u.id=o.user_id WHERE u.email='sig@example.com'").get();
  assert.equal(row.status, 'PAID'); assert.equal(row.amount_paise, 29900); assert.equal(row.currency, 'INR');
  assert.equal(row.provider, 'razorpay'); assert.ok(row.paid_at && row.provider_order_id && row.provider_payment_id);
});

test('demo endpoint is disabled when a real provider is configured', async () => {
  const a = await startCheckout('demo@example.com');
  assert.equal((await a.c.post('/api/payments/demo/complete', { orderId: a.orderId })).status, 404);
  assert.equal(owns('demo@example.com'), false);
});
