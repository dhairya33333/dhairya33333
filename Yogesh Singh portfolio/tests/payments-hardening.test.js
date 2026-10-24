import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedUpUser, signedInAdmin, hmacHex } from './helpers.js';

const KEY_SECRET = 'rzp_secret_hardening', WH_SECRET = 'whsec_hardening';
let t, log;
const realFetch = globalThis.fetch;
const gw = { payments: {}, refunds: {}, orderPayments: {}, calls: [] };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/v1')) return realFetch(url, init);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
  const p = u.replace('https://api.razorpay.com/v1', ''); gw.calls.push(p);
  let m;
  if (p === '/orders' && init.method === 'POST') return json({ id: `order_H${gw.calls.length}_${Math.random().toString(36).slice(2, 6)}` });
  if ((m = /^\/payments\/(.+)$/.exec(p))) return gw.payments[m[1]] ? json(gw.payments[m[1]]) : json({}, 404);
  if ((m = /^\/refunds\/(.+)$/.exec(p))) return gw.refunds[m[1]] ? json(gw.refunds[m[1]]) : json({}, 404);
  if ((m = /^\/orders\/(.+)\/payments$/.exec(p))) return json({ items: gw.orderPayments[m[1]] || [] });
  return json({}, 404);
};

const lines = [];
before(async () => {
  t = await boot({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_h', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
  log = await import('../server/log.js');
  log.setLogSink((l) => lines.push(l));
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, status, validated, published) VALUES ('film', 'Film', 29900, 'ready', 1, 1)").run();
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, status, validated, published) VALUES ('other', 'Other', 49900, 'ready', 1, 1)").run();
});
after(async () => { globalThis.fetch = realFetch; await t.close(); });

const movie = (slug = 'film') => t.db.prepare('SELECT id FROM movies WHERE slug = ?').get(slug).id;
const owns = (email, slug = 'film') => !!t.db.prepare('SELECT 1 FROM purchases p JOIN users u ON u.id=p.user_id JOIN movies m ON m.id=p.movie_id WHERE u.email = ? AND m.slug = ?').get(email, slug);
const order = (id) => t.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
const pay = (id, rzOrder, o = {}) => (gw.payments[id] = { id, order_id: rzOrder, status: 'captured', amount: 29900, currency: 'INR', ...o });
async function buy(email, slug = 'film') {
  const c = await signedUpUser(t, email);
  const r = await c.post('/api/payments/checkout', { movieId: movie(slug) });
  assert.equal(r.status, 200, r.text);
  return { c, ...r.json };
}
function hook(body, { id = `evt_${Math.random()}`, secret = WH_SECRET } = {}) {
  const raw = JSON.stringify(body);
  return t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex(secret, raw), 'x-razorpay-event-id': id } });
}
const captured = (rzOrder, payId, extra = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: rzOrder, ...extra } } } });
const refundEv = (rzOrder, payId, refundId, amount) => ({ event: 'refund.processed', payload: { refund: { entity: { id: refundId, payment_id: payId, ...(amount === undefined ? {} : { amount }) } }, payment: { entity: { id: payId, order_id: rzOrder, amount: 1 } } } });

test('order is bound to the user, the film, the server price and INR', async () => {
  const a = await buy('bind@example.com', 'other');
  const row = order(a.orderId);
  assert.equal(row.amount_paise, 49900); assert.equal(row.currency, 'INR');
  assert.equal(row.movie_id, movie('other'));
  assert.equal(row.user_id, t.db.prepare("SELECT id FROM users WHERE email='bind@example.com'").get().id);
});

test('webhook with missing amount/currency: authoritative data is fetched, then compared', async () => {
  const a = await buy('miss1@example.com');
  pay('pay_m1', a.razorpayOrderId);                                   // gateway truth: 29900 INR captured
  await hook(captured(a.razorpayOrderId, 'pay_m1'));                  // payload carries NO amount and NO currency
  assert.equal(owns('miss1@example.com'), true);
  assert.ok(gw.calls.includes('/payments/pay_m1'), 'asked the gateway');
  assert.equal(order(a.orderId).provider_payment_id, 'pay_m1');

  const b = await buy('miss2@example.com');
  pay('pay_m2', b.razorpayOrderId, { amount: 100 });                  // gateway truth says only 1 rupee
  await hook(captured(b.razorpayOrderId, 'pay_m2'));
  assert.equal(owns('miss2@example.com'), false, 'a missing field never skips the comparison');
  assert.equal(order(b.orderId).failure_reason, 'amount_mismatch');
});

test('webhook claiming "captured" for a payment the gateway does not confirm grants nothing, and can be redelivered', async () => {
  const a = await buy('noconfirm@example.com');
  pay('pay_nc', a.razorpayOrderId, { status: 'authorized' });
  const r = await hook(captured(a.razorpayOrderId, 'pay_nc', { amount: 29900, currency: 'INR', status: 'authorized' }), { id: 'evt_nc' });
  assert.equal(r.status, 200); assert.equal(owns('noconfirm@example.com'), false);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM payment_events WHERE event_id = 'evt_nc'").get().c, 0, 'not recorded, so a retry can still succeed');
  gw.payments.pay_nc.status = 'captured';
  await hook(captured(a.razorpayOrderId, 'pay_nc', { amount: 29900, currency: 'INR' }), { id: 'evt_nc' });
  assert.equal(owns('noconfirm@example.com'), true);
});

test('pending (authorized) then failed leaves no access; states are explicit', async () => {
  const a = await buy('pend@example.com');
  pay('pay_p', a.razorpayOrderId, { status: 'authorized' });
  const sig = hmacHex(KEY_SECRET, `${a.razorpayOrderId}|pay_p`);
  const r = await a.c.post('/api/payments/razorpay/verify', { razorpay_order_id: a.razorpayOrderId, razorpay_payment_id: 'pay_p', razorpay_signature: sig });
  assert.equal(r.json.status, 'PENDING'); assert.equal(order(a.orderId).status, 'PENDING'); assert.equal(owns('pend@example.com'), false);
  await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_p', order_id: a.razorpayOrderId, error_description: 'Bank declined' } } } });
  assert.equal(order(a.orderId).status, 'FAILED'); assert.equal(owns('pend@example.com'), false);
});

test('one gateway payment can only ever settle one order', async () => {
  const a = await buy('reuseA@example.com'), b = await buy('reuseB@example.com');
  pay('pay_reuse', a.razorpayOrderId);
  await hook(captured(a.razorpayOrderId, 'pay_reuse', { amount: 29900, currency: 'INR' }));
  assert.equal(owns('reuseA@example.com'), true);
  // attacker B replays A's payment id against B's order
  const sig = hmacHex(KEY_SECRET, `${b.razorpayOrderId}|pay_reuse`);
  const r = await b.c.post('/api/payments/razorpay/verify', { razorpay_order_id: b.razorpayOrderId, razorpay_payment_id: 'pay_reuse', razorpay_signature: sig });
  assert.equal(r.status, 400, "payment belongs to A's order at the gateway");
  const { markPaid } = await import('../server/payments/ledger.js');
  assert.equal(markPaid(b.orderId, { providerPaymentId: 'pay_reuse', amountPaise: 29900, currency: 'INR' }).reason, 'payment_reused');
  assert.equal(owns('reuseB@example.com'), false);
});

test('ledger refuses calls with any verified field missing', async () => {
  const { markPaid } = await import('../server/payments/ledger.js');
  const a = await buy('ledger@example.com');
  for (const args of [{}, { providerPaymentId: 'p' }, { providerPaymentId: 'p', amountPaise: 29900 }, { providerPaymentId: 'p', currency: 'INR' }, { amountPaise: 29900, currency: 'INR' }, { providerPaymentId: 'p', amountPaise: '29900', currency: 'INR' }, { providerPaymentId: 'p', amountPaise: 29900.5, currency: 'INR' }, { providerPaymentId: 'p', amountPaise: 29900, currency: 'USD' }]) {
    assert.equal(markPaid(a.orderId, args).ok, false, JSON.stringify(args));
  }
  assert.equal(owns('ledger@example.com'), false);
});

test('partial refunds accumulate; the total is judged against OUR stored price; duplicates are not double counted', async () => {
  const a = await buy('part@example.com');
  pay('pay_part', a.razorpayOrderId);
  await hook(captured(a.razorpayOrderId, 'pay_part', { amount: 29900, currency: 'INR' }));
  await hook(refundEv(a.razorpayOrderId, 'pay_part', 'rf_1', 10000));            // payload "payment.amount: 1" is irrelevant
  assert.equal(order(a.orderId).status, 'PARTIALLY_REFUNDED'); assert.equal(order(a.orderId).refunded_paise, 10000);
  assert.equal(owns('part@example.com'), true, 'policy: partial refund keeps access');
  await hook(refundEv(a.razorpayOrderId, 'pay_part', 'rf_1', 10000), { id: 'evt_other_id_same_refund' });   // same refund, different event id
  assert.equal(order(a.orderId).refunded_paise, 10000, 'same refund id is not counted twice');
  await hook(refundEv(a.razorpayOrderId, 'pay_part', 'rf_2', 19900));            // 10000 + 19900 = 29900 = the full price
  assert.equal(order(a.orderId).status, 'REFUNDED'); assert.equal(owns('part@example.com'), false, 'cumulative full refund revokes access');
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM refunds WHERE order_id = ?').get(a.orderId).c, 2);
});

test('refund payload without an amount: the amount is fetched from the gateway', async () => {
  const a = await buy('refnoamt@example.com');
  pay('pay_rn', a.razorpayOrderId);
  await hook(captured(a.razorpayOrderId, 'pay_rn', { amount: 29900, currency: 'INR' }));
  gw.refunds.rf_x = { id: 'rf_x', amount: 29900 };
  await hook(refundEv(a.razorpayOrderId, 'pay_rn', 'rf_x'));                      // no refund.amount in the webhook
  assert.equal(order(a.orderId).status, 'REFUNDED'); assert.equal(owns('refnoamt@example.com'), false);
  const b = await buy('refunk@example.com');
  pay('pay_ru', b.razorpayOrderId);
  await hook(captured(b.razorpayOrderId, 'pay_ru', { amount: 29900, currency: 'INR' }));
  await hook(refundEv(b.razorpayOrderId, 'pay_ru', 'rf_unknown'));                // gateway cannot tell us the amount either
  assert.equal(owns('refunk@example.com'), true, 'an unresolvable refund never silently changes access');
  assert.equal(order(b.orderId).status, 'PAID');
});

test('disputes: open flags and keeps access; won clears; lost revokes', async () => {
  const dispute = (type, rzOrderPay, payId) => ({ event: `payment.dispute.${type}`, payload: { dispute: { entity: { id: 'disp_1', payment_id: payId } }, payment: { entity: { id: payId, order_id: rzOrderPay } } } });
  const a = await buy('disp@example.com'); pay('pay_d', a.razorpayOrderId);
  await hook(captured(a.razorpayOrderId, 'pay_d', { amount: 29900, currency: 'INR' }));
  await hook(dispute('created', a.razorpayOrderId, 'pay_d'));
  assert.equal(order(a.orderId).dispute_status, 'open'); assert.equal(owns('disp@example.com'), true);
  await hook(dispute('won', a.razorpayOrderId, 'pay_d'));
  assert.equal(order(a.orderId).dispute_status, 'won'); assert.equal(owns('disp@example.com'), true);
  const b = await buy('displost@example.com'); pay('pay_dl', b.razorpayOrderId);
  await hook(captured(b.razorpayOrderId, 'pay_dl', { amount: 29900, currency: 'INR' }));
  await hook(dispute('lost', b.razorpayOrderId, 'pay_dl'));
  assert.equal(order(b.orderId).status, 'CHARGEBACK'); assert.equal(owns('displost@example.com'), false);
  await hook(captured(b.razorpayOrderId, 'pay_dl', { amount: 29900, currency: 'INR' }));
  assert.equal(owns('displost@example.com'), false, 'a charged-back order never re-unlocks');
});

test('admin can revoke an order; ordinary users cannot', async () => {
  const a = await buy('revoke@example.com'); pay('pay_rv', a.razorpayOrderId);
  await hook(captured(a.razorpayOrderId, 'pay_rv', { amount: 29900, currency: 'INR' }));
  assert.equal((await a.c.post(`/api/admin/orders/${a.orderId}/revoke`)).status, 403);
  assert.equal(owns('revoke@example.com'), true);
  const admin = await signedInAdmin(t);
  assert.equal((await admin.post(`/api/admin/orders/${a.orderId}/revoke`)).status, 200);
  assert.equal(owns('revoke@example.com'), false); assert.equal(order(a.orderId).status, 'CHARGEBACK');
  assert.equal((await admin.post('/api/admin/orders/nope/revoke')).status, 404);
});

test('race: webhook, browser verify and reconcile arriving together create exactly one purchase', async () => {
  const a = await buy('race@example.com'); pay('pay_race', a.razorpayOrderId);
  gw.orderPayments[a.razorpayOrderId] = [{ id: 'pay_race', status: 'captured', amount: 29900, currency: 'INR' }];
  const sig = hmacHex(KEY_SECRET, `${a.razorpayOrderId}|pay_race`);
  const results = await Promise.all([
    ...Array.from({ length: 5 }, () => hook(captured(a.razorpayOrderId, 'pay_race', { amount: 29900, currency: 'INR' }), { id: 'evt_race' })),
    ...Array.from({ length: 3 }, () => a.c.post('/api/payments/razorpay/verify', { razorpay_order_id: a.razorpayOrderId, razorpay_payment_id: 'pay_race', razorpay_signature: sig })),
    ...Array.from({ length: 3 }, () => a.c.get(`/api/payments/verify?order_id=${a.orderId}`)),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM purchases WHERE order_id = ?').get(a.orderId).c, 1);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM payment_events WHERE event_id = 'evt_race'").get().c, 1);
  assert.equal(order(a.orderId).status, 'PAID');
});

test('direct API calls cannot fabricate a purchase', async () => {
  const c = await signedUpUser(t, 'faker@example.com'); const uid = t.db.prepare("SELECT id FROM users WHERE email='faker@example.com'").get().id;
  const attempts = [
    c.post('/api/payments/demo/complete', { orderId: 'x', movieId: movie() }),
    c.post('/api/admin/grant', { email: 'faker@example.com', movieId: movie() }),
    c.post('/api/payments/razorpay/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'x' }),
    c.post('/api/payments/checkout', { movieId: movie(), status: 'PAID', paid: true, amount_paise: 0, price: 1, user_id: 1 }),
    c.put('/api/auth/me', { role: 'admin' }), c.post('/api/auth/register', { name: 'x', email: 'faker@example.com', password: 'password-12345', role: 'admin' }),
    t.client().post('/api/payments/webhook', { event: 'payment.captured' }),
  ];
  await Promise.all(attempts);
  assert.equal(owns('faker@example.com'), false);
  assert.equal(t.db.prepare('SELECT role FROM users WHERE id = ?').get(uid).role, 'user');
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM purchases WHERE user_id = ?").get(uid).c, 0);
  const o = t.db.prepare('SELECT status FROM orders WHERE user_id = ?').all(uid);
  assert.ok(o.every((x) => x.status === 'CREATED'), 'injected fields did not change order state');
});

test('logs record references and transitions but never secrets, signatures or tokens', async () => {
  const text = lines.join('\n');
  assert.match(text, /"event":"order.transition"/); assert.match(text, /"to":"PAID"/); assert.match(text, /"to":"REFUNDED"/);
  assert.match(text, /order.created/);
  for (const secret of [KEY_SECRET, WH_SECRET, 'rzp_test_h', hmacHex(KEY_SECRET, 'x').slice(0, 10)]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.ok(!/password|cookie|yp_session/i.test(text.replace(/"password"/g, '')), 'no credentials');
  const redacted = (log.log('info', 'x', { password: 'hunter2', razorpay_signature: 'abc', nested: { token: 'zzz' }, path: t.dirs.source + '/a.mp4' }), lines.at(-1));
  assert.ok(!redacted.includes('hunter2') && !redacted.includes('abc') && !redacted.includes('zzz') && !redacted.includes(t.dirs.source));
});
