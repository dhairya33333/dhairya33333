import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin, signedUpUser } from './helpers.js';

let t, admin, movie;
before(async () => {
  t = await boot({ RATE_LIMIT_AUTH: '500', RATE_LIMIT_PAYMENTS: '500' }); admin = await signedInAdmin(t);
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, preview_sec, duration_sec, published, status, validated) VALUES ('ins','Insight Film',29900,60,600,1,'ready',1)").run();
  movie = t.db.prepare("SELECT * FROM movies WHERE slug = 'ins'").get();
});
after(async () => { await t.close(); });
let n = 0;
const viewer = async () => { const e = `ins${++n}@example.com`, c = await signedUpUser(t, e); return { c, id: t.db.prepare('SELECT id FROM users WHERE email = ?').get(e).id }; };
const checkout = (c, body = {}) => c.post('/api/payments/checkout', { movieId: movie.id, phone: '9876543210', agree: true, ...body });
const order = (id) => t.db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').get(id);
const mk = (o) => admin.post('/api/admin/coupons', { code: 'X', kind: 'percent', value: 10, ...o });

test('coupon input is validated; only admins manage coupons', async () => {
  assert.equal((await mk({ code: 'ab' })).status, 400); assert.equal((await mk({ code: 'bad code!' })).status, 400);
  assert.equal((await mk({ code: 'P0', value: 0 })).status, 400); assert.equal((await mk({ code: 'P101', value: 101 })).status, 400); assert.equal((await mk({ code: 'PF', value: 12.5 })).status, 400);
  assert.equal((await mk({ code: 'A0', kind: 'amount', value: 0 })).status, 400);
  assert.equal((await mk({ code: 'diwali20', value: 20 })).status, 200); assert.equal((await mk({ code: 'DIWALI20', value: 20 })).status, 409, 'codes are case-insensitive and unique');
  const v = await viewer(); assert.equal((await v.c.get('/api/admin/coupons')).status, 403); assert.equal((await v.c.post('/api/admin/coupons', { code: 'HACK', kind: 'percent', value: 100 })).status, 403);
});

test('the server computes the price: percent, rupees off, the Rs 1 floor, and the order stores the discounted amount', async () => {
  await mk({ code: 'TEN', value: 10 }); await mk({ code: 'FIFTYOFF', kind: 'amount', value: 50 }); await mk({ code: 'FREE', value: 100 }); await mk({ code: 'HUGE', kind: 'amount', value: 100000 });
  const q = async (code) => (await (await viewer()).c.post('/api/payments/coupon', { movieId: movie.id, code })).json;
  assert.equal((await q('ten')).finalPaise, 26910); assert.equal((await q(' TEN ')).discountPaise, 2990);
  assert.equal((await q('FIFTYOFF')).finalPaise, 24900);
  assert.equal((await q('FREE')).finalPaise, 100, '100% still costs Rs 1'); assert.equal((await q('HUGE')).finalPaise, 100);
  const v = await viewer(); const r = await checkout(v.c, { coupon: 'ten' }); assert.equal(r.status, 200);
  const o = order(v.id); assert.equal(o.amount_paise, 26910); assert.equal(o.discount_paise, 2990); assert.equal(o.coupon_code, 'TEN');
  const plain = await viewer(); await checkout(plain.c); assert.equal(order(plain.id).amount_paise, 29900); assert.equal(order(plain.id).coupon_code, null);
  assert.equal((await v.c.post('/api/payments/checkout', { movieId: movie.id, phone: '9876543210', agree: true, coupon: 'TEN', amount_paise: 1, price_paise: 1 })).status, 200);
  assert.equal(order(v.id).amount_paise, 26910, 'a client-supplied price is ignored');
});

test('every kind of invalid code gets the same answer (no code guessing), and nothing is created', async () => {
  await mk({ code: 'OLD', expires_on: '2000-01-01' }); await mk({ code: 'OFF', value: 10 }); await admin.put('/api/admin/coupons/OFF', { active: false });
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, published, status, validated) VALUES ('other','Other',9900,1,'ready',1)").run();
  const other = t.db.prepare("SELECT id FROM movies WHERE slug='other'").get().id; await mk({ code: 'ONLYOTHER', movie_id: other });
  const v = await viewer(); const msgs = new Set();
  for (const code of ['NOPE', 'OLD', 'OFF', 'ONLYOTHER', '', 'a', "'; DROP TABLE orders;--", 'X'.repeat(500)]) {
    const r = await v.c.post('/api/payments/coupon', { movieId: movie.id, code }); assert.equal(r.status, 400, code); msgs.add(r.json.error);
  }
  assert.equal(msgs.size, 1); assert.equal((await checkout(v.c, { coupon: 'NOPE' })).status, 400);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM orders WHERE user_id = ?').get(v.id).n, 0);
  assert.equal((await t.client().post('/api/payments/coupon', { movieId: movie.id, code: 'TEN' })).status, 401);
});

test('max uses and once-per-person are enforced on paid orders', async () => {
  const { markPaid } = await import('../server/payments/ledger.js');
  await mk({ code: 'TWO', value: 50, max_uses: 2 });
  const pay = async (v, code) => { const r = await checkout(v.c, { coupon: code }); if (r.status !== 200) return r; const o = order(v.id); markPaid(o.order_id, { providerPaymentId: 'p_' + o.order_id, amountPaise: o.amount_paise, currency: 'INR' }); return r; };
  const a = await viewer(), b = await viewer(), c = await viewer();
  assert.equal((await pay(a, 'TWO')).status, 200); assert.equal((await pay(b, 'TWO')).status, 200);
  assert.equal((await pay(c, 'TWO')).status, 400, 'third use refused');
  assert.equal((await admin.get('/api/admin/coupons')).json.items.find((x) => x.code === 'TWO').used, 2);
  await mk({ code: 'ONCE', value: 10 }); t.db.prepare("INSERT INTO movies (slug, title, price_paise, published, status, validated) VALUES ('second','Second',20000,1,'ready',1)").run();
  const d = await viewer(); await pay(d, 'ONCE');
  const m2 = t.db.prepare("SELECT id FROM movies WHERE slug='second'").get().id;
  assert.equal((await d.c.post('/api/payments/checkout', { movieId: m2, phone: '9876543210', agree: true, coupon: 'ONCE' })).status, 400, 'same person cannot reuse it');
  assert.equal((await admin.del('/api/admin/coupons/TWO')).status, 409, 'a used code can only be switched off');
  assert.equal((await admin.del('/api/admin/coupons/OFF')).status, 200);
});

test('funnel counts anonymous steps; only known steps are accepted; purchase is counted once', async () => {
  t.db.exec('DELETE FROM events');
  const anon = t.client();
  for (const name of ['film_view', 'film_view', 'preview_play', 'paywall_shown', 'checkout_open']) assert.equal((await anon.post('/api/track', { name })).status, 204);
  for (const name of ['purchase', 'evil', '', 'film_view; DROP TABLE events', { a: 1 }]) await anon.post('/api/track', { name });   // purchase is server-only
  const f = (await admin.get('/api/admin/funnel?days=30')).json;
  const by = Object.fromEntries(f.steps.map((s) => [s.key, s.count]));
  assert.deepEqual([by.film_view, by.preview_play, by.paywall_shown, by.checkout_open, by.purchase], [2, 1, 1, 1, 0]);
  assert.equal(f.steps[1].pctOfFirst, 50);
  const cols = t.db.prepare("PRAGMA table_info('events')").all().map((c) => c.name); assert.deepEqual(cols.sort(), ['day', 'n', 'name']);
  const { markPaid } = await import('../server/payments/ledger.js'); const v = await viewer(); await checkout(v.c); const o = order(v.id);
  for (let i = 0; i < 2; i++) markPaid(o.order_id, { providerPaymentId: 'p_f', amountPaise: o.amount_paise, currency: 'INR' });
  const g = (await admin.get('/api/admin/funnel')).json.steps; assert.equal(g.find((s) => s.key === 'purchase').count, 1); assert.equal(g.find((s) => s.key === 'checkout_started').count >= 1, true);
  assert.equal((await (await viewer()).c.get('/api/admin/funnel')).status, 403);
});

test('audit log records admin changes (not reads, not bodies, not non-admins), newest first', async () => {
  t.db.exec('DELETE FROM audit_log');
  await admin.get('/api/admin/stats');
  await admin.put('/api/admin/settings', { hero_name: 'Secret Name Value 12345' });
  await admin.post('/api/admin/coupons', { code: 'AUDITME', kind: 'percent', value: 5 });
  await admin.del('/api/admin/coupons/NOSUCH');
  const v = await viewer(); await v.c.post('/api/admin/coupons', { code: 'NOPE1', kind: 'percent', value: 5 });
  const log = (await admin.get('/api/admin/audit')).json.items;
  assert.deepEqual(log.map((l) => [l.action, l.status]), [['DELETE /coupons/NOSUCH', 404], ['POST /coupons', 200], ['PUT /settings', 200]]);
  assert.equal(log[0].admin_email, 'admin@test.com'); assert.ok(!JSON.stringify(log).includes('Secret Name'));
  assert.equal((await v.c.get('/api/admin/audit')).status, 403);
});

test('system health reports each check with plain language and the overall verdict', async () => {
  const h = (await admin.get('/api/admin/health')).json; const keys = h.checks.map((c) => c.key);
  for (const k of ['database', 'backup', 'offsite', 'disk', 'ffmpeg', 'payments', 'email', 'https', 'legal', 'twofa']) assert.ok(keys.includes(k), k);
  assert.equal(h.checks.find((c) => c.key === 'database').ok, true); assert.equal(h.checks.find((c) => c.key === 'backup').ok, false, 'no backup yet is reported, not hidden');
  assert.equal(h.ok, false); assert.ok(h.checks.every((c) => c.detail.length > 5) && !JSON.stringify(h).includes(t.dataDir), 'no server paths');
  const { backupDb } = await import('../scripts/backup-db.js'); backupDb();
  assert.equal((await admin.get('/api/admin/health')).json.checks.find((c) => c.key === 'backup').ok, true);
  assert.equal((await (await viewer()).c.get('/api/admin/health')).status, 403);
});
