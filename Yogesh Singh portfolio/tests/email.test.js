import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin, signedUpUser} from './helpers.js';

let t, admin, mailer, sent;
const fake = { async sendMail(m) { if (fake.fail) throw new Error('smtp down password=hunter2'); sent.push(m); return {}; } };
before(async () => {
  t = await boot({ SMTP_HOST: 'smtp.test.invalid', SMTP_FROM: 'Site <no-reply@site.test>', NOTIFY_EMAIL: 'owner@site.test', SITE_URL: 'https://films.example.test' });
  mailer = await import('../server/mailer.js'); mailer.setTransport(fake); admin = await signedInAdmin(t);
});
beforeEach(() => { sent = []; fake.fail = false; });
after(async () => { mailer.setTransport(null); await t.close(); });
const flush = () => new Promise((r) => setTimeout(r, 80));
const contact = (o = {}) => t.client().post('/api/contact', { name: 'Asha Rao', email: 'asha@example.com', topic: 'speaking', message: 'We would love to invite you to our university.', ...o });

test('a contact message emails the owner, with reply-to set to the sender, and is still stored', async () => {
  assert.equal((await contact()).status, 200); await flush();
  assert.equal(sent.length, 1); const m = sent[0];
  assert.equal(m.to, 'owner@site.test'); assert.equal(m.replyTo, 'asha@example.com'); assert.match(m.subject, /speaking.*Asha Rao/);
  assert.match(m.text, /university/); assert.match(JSON.stringify((await admin.get('/api/admin/messages')).json), /Asha Rao/);
});

test('a header-injection attempt in the name cannot add recipients or headers', async () => {
  await contact({ name: 'Eve\r\nBcc: attacker@evil.test' }); await flush();
  assert.ok(sent.length === 1 && !/[\r\n]/.test(sent[0].subject) && !sent[0].bcc);
});

test('a failing mail server never breaks the contact form, and the error is logged without secrets', async () => {
  fake.fail = true; const lines = [];
  const log = await import('../server/log.js'); log.setLogSink((l) => lines.push(l));
  assert.equal((await contact()).status, 200); await flush(); log.setLogSink(() => {});
  assert.ok(lines.some((l) => l.includes('mail.failed')) && !lines.join('').includes('hunter2'));
});

test('forgot-password: same answer for known and unknown addresses, one email only for the real account, link works once', async () => {
  await signedUpUser(t, 'viewer@example.com');
  const known = await t.client().post('/api/auth/forgot', { email: 'viewer@example.com' }), unknown = await t.client().post('/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.deepEqual(known.json, unknown.json); await flush();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'viewer@example.com');
  const token = sent[0].text.match(/token=([0-9a-f]{48})/)?.[1]; assert.ok(token); assert.match(sent[0].text, /^.*https:\/\/films\.example\.test\/reset-password\.html/m);
  assert.equal((await t.client().post('/api/auth/reset', { token, password: 'a-brand-new-password-1' })).status, 200);
  assert.equal((await t.client().post('/api/auth/reset', { token, password: 'another-password-22' })).status, 400, 'single use');
  assert.equal((await t.client().post('/api/auth/login', { email: 'viewer@example.com', password: 'a-brand-new-password-1' })).status, 200);
});

test('forgot-password cannot be used to flood an inbox: one email per account per 2 minutes, same answer each time', async () => {
  await signedUpUser(t, 'victim@example.com'); sent.length = 0;
  const answers = []; for (let i = 0; i < 4; i++) answers.push((await t.client().post('/api/auth/forgot', { email: 'victim@example.com' })).json);
  await flush(); assert.equal(sent.length, 1); assert.ok(answers.every((a) => JSON.stringify(a) === JSON.stringify(answers[0])));
});

test('the admin can send a test email; the address is masked in the reply', async () => {
  const r = await admin.post('/api/admin/email/test', {}); assert.equal(r.status, 200); assert.equal(r.json.to, 'o***@site.test'); assert.equal(sent.length, 1);
  fake.fail = true; assert.equal((await admin.post('/api/admin/email/test', {})).status, 502);
  const user = await signedUpUser(t, 'plain@example.com'); assert.equal((await user.post('/api/admin/email/test', {})).status, 403);
});

test('a purchase sends one receipt to the buyer and one notice to the owner, once even if confirmed twice', async () => {
  const { markPaid } = await import('../server/payments/ledger.js'); const { db } = t;
  await signedUpUser(t, 'buyer@example.com', 'Ravi');
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get('buyer@example.com').id;
  db.prepare("INSERT INTO movies (slug, title, price_paise, published, status) VALUES ('mail-film','Mail Film',9900,1,'ready')").run();
  const mid = db.prepare("SELECT id FROM movies WHERE slug='mail-film'").get().id;
  db.prepare("INSERT INTO orders (order_id, user_id, movie_id, amount_paise, currency, provider, status) VALUES ('ord_mail1', ?, ?, 9900, 'INR', 'razorpay', 'CREATED')").run(uid, mid);
  assert.ok(markPaid('ord_mail1', { providerPaymentId: 'pay_m1', amountPaise: 9900, currency: 'INR' }).ok);
  markPaid('ord_mail1', { providerPaymentId: 'pay_m1', amountPaise: 9900, currency: 'INR' }); await flush();
  assert.equal(sent.length, 2);
  const receipt = sent.find((m) => m.to === 'buyer@example.com'); assert.match(receipt.text, /Mail Film/); assert.match(receipt.text, /₹99/); assert.match(receipt.text, /ord_mail1/); assert.match(receipt.text, /\/film\/mail-film/);
  assert.ok(sent.some((m) => m.to === 'owner@site.test' && /New sale/.test(m.subject)));
});

test('without SMTP configured the site behaves as before: no mail, forgot-password says so, the login page hides the option', async () => {
  const { config } = t, host = config.mail.host; config.mail.host = ''; mailer.setTransport(null);
  try {
    assert.equal((await t.client().get('/api/auth/config')).json.emailReset, false);
    assert.equal((await t.client().post('/api/auth/forgot', { email: 'viewer@example.com' })).status, 503);
    assert.equal((await contact()).status, 200); await flush(); assert.equal(sent.length, 0);
    assert.equal((await admin.post('/api/admin/email/test', {})).status, 400);
  } finally { config.mail.host = host; mailer.setTransport(fake); }
});
