import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin, signedUpUser } from './helpers.js';

let t, admin;
before(async () => { t = await boot({ SITE_URL: 'https://films.example.test' }); admin = await signedInAdmin(t); });
after(async () => { await t.close(); });

test('Privacy, Terms and Refund pages exist, are canonical and in the sitemap, and show template text', async () => {
  for (const [slug, title] of [['privacy', 'Privacy Policy'], ['terms', 'Terms of Use'], ['refunds', 'Refund and Cancellation Policy']]) {
    const page = await t.client().get(`/${slug}`);
    assert.equal(page.status, 200); assert.match(page.text, new RegExp(`<title>${title} — `)); assert.match(page.text, new RegExp(`rel="canonical" href="https://films\\.example\\.test/${slug}"`));
    const api = (await t.client().get(`/api/legal/${slug}`)).json;
    assert.equal(api.title, title); assert.ok(api.body.length > 800);
    assert.ok((await t.client().get('/sitemap.xml')).text.includes(`/${slug}<`));
  }
  assert.equal((await t.client().get('/api/legal/secret')).status, 404);
  assert.equal((await t.client().get('/api/legal/..%2f..%2fetc')).status, 404);
});

test('the privacy policy describes what the app really does (no invented practices)', async () => {
  const p = (await t.client().get('/api/legal/privacy')).json.body.toLowerCase();
  for (const word of ['password', 'one-way hash', 'razorpay', 'google', 'instagram', 'cookie', 'we do not sell']) assert.ok(p.includes(word), word);
  assert.ok(!p.includes('advertis') && !p.includes('tracking pixel'), 'no ads or trackers are mentioned because there are none');
});

test('admin sees placeholder counts and a dashboard warning until they are filled in; only admins can edit', async () => {
  const before = (await admin.get('/api/admin/legal')).json;
  assert.ok(before.pages.every((p) => p.placeholders > 0 && !p.customised));
  assert.ok((await admin.get('/api/admin/stats')).json.legal_placeholders > 10);
  const user = await signedUpUser(t, 'u@example.com');
  assert.equal((await user.get('/api/admin/legal')).status, 403); assert.equal((await t.client().put('/api/admin/legal', {})).status, 401);
  const full = (slug) => `## Heading\nA real paragraph for ${slug} with no placeholders at all, written by the site owner, long enough to pass the length check.\n\n- one\n- two`;
  assert.equal((await admin.put('/api/admin/legal', { privacy: 'too short' })).status, 400);
  assert.equal((await admin.put('/api/admin/legal', { privacy: full('privacy'), terms: full('terms'), refunds: full('refunds') })).status, 200);
  const after = (await admin.get('/api/admin/legal')).json;
  assert.ok(after.pages.every((p) => p.placeholders === 0 && p.customised)); assert.match(after.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await admin.get('/api/admin/stats')).json.legal_placeholders, 0);
  assert.match((await t.client().get('/api/legal/terms')).json.body, /A real paragraph for terms/);
});

test('legal page script escapes text before formatting (a hostile edit cannot inject HTML)', async () => {
  const js = (await t.client().get('/js/legal.js')).text;
  assert.match(js, /const inline = \(s\) => esc\(s\)/);
  assert.ok(!/innerHTML\s*=\s*d\.body/.test(js), 'raw text is never assigned as HTML');
});

test('checkout requires the buyer to accept the terms; acceptance is recorded with the legal version', async () => {
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, status, validated, published) VALUES ('f', 'F', 29900, 'ready', 1, 1)").run();
  const mid = t.db.prepare("SELECT id FROM movies WHERE slug='f'").get().id;
  const c = await signedUpUser(t, 'buyer@example.com');
  for (const body of [{ movieId: mid }, { movieId: mid, agree: false }, { movieId: mid, agree: 'true' }, { movieId: mid, agree: 1 }]) {
    const r = await c.post('/api/payments/checkout', { phone: '9876543210', ...body });
    assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.code, 'consent_required');
  }
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM orders').get().c, 0, 'no order is created without consent');
  const ok = await c.post('/api/payments/checkout', { movieId: mid, phone: '9876543210', agree: true });
  assert.equal(ok.status, 200);
  const o = t.db.prepare('SELECT consent_at, consent_version FROM orders').get();
  assert.ok(o.consent_at); assert.match(o.consent_version, /^\d{4}-\d{2}-\d{2}$/);
});

test('the film page has the consent box and the footer links to all three policies', async () => {
  const film = (await t.client().get('/film/f')).text;
  assert.match(film, /id="agree"/); for (const l of ['/terms', '/privacy', '/refunds']) assert.ok(film.includes(`href="${l}"`), l);
  const home = (await t.client().get('/')).text;
  for (const l of ['/terms', '/privacy', '/refunds']) assert.ok(home.includes(`href="${l}"`), `home ${l}`);
  assert.match((await t.client().get('/js/layout.js')).text, /href="\/privacy"/);
});
