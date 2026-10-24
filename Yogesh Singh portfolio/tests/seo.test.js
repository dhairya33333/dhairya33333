import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin } from './helpers.js';

let t;
before(async () => { t = await boot({ SITE_URL: 'https://films.example.test' }); });
after(async () => { await t.close(); });

const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

test('home page: absolute canonical, Open Graph, valid Person JSON-LD built only from configured content', async () => {
  const h = (await t.client().get('/')).text;
  assert.match(h, /<link rel="canonical" href="https:\/\/films\.example\.test\/">/);
  assert.match(h, /property="og:title"/); assert.match(h, /property="og:url" content="https:\/\/films\.example\.test\/"/); assert.match(h, /name="description"/);
  const [p] = jsonLd(h);
  assert.equal(p['@type'], 'Person'); assert.equal(p.name, 'Yogesh Pratap Singh');
  assert.ok(!('sameAs' in p), 'no social links configured, so none are claimed');
  assert.ok(!('award' in p) && !('jobTitle' in p) && !('alumniOf' in p), 'no biography facts are invented');
  const admin = await signedInAdmin(t);
  await admin.put('/api/admin/settings', { social_instagram: 'https://instagram.com/example' });
  assert.deepEqual(jsonLd((await t.client().get('/')).text)[0].sameAs, ['https://instagram.com/example']);
});

test('film page: Movie JSON-LD with the real price/currency; hostile titles cannot break out of the script block', async () => {
  const admin = await signedInAdmin(t);
  t.db.prepare("INSERT INTO movies (slug, title, tagline, description, year, duration_sec, price_paise, status, validated, published) VALUES ('evil', ?, 'Tag', 'Desc', '2011', 9000, 29900, 'ready', 1, 1)").run('</script><script>alert(1)</script>"Film');
  const h = (await t.client().get('/film/evil')).text;
  assert.ok(!/<\/script><script>alert/.test(h), 'script injection through the title is neutralised');
  const m = jsonLd(h)[0];
  assert.equal(m['@type'], 'Movie'); assert.equal(m.name, '</script><script>alert(1)</script>"Film');
  assert.equal(m.offers.price, '299.00'); assert.equal(m.offers.priceCurrency, 'INR'); assert.equal(m.duration, 'PT2H30M'); assert.equal(m.datePublished, '2011');
  assert.ok(!('aggregateRating' in m) && !('award' in m) && !('review' in m), 'no invented ratings or awards');
  assert.match(h, /<link rel="canonical" href="https:\/\/films\.example\.test\/film\/evil">/);
  assert.match(h, /og:type" content="video\.movie"/);
  assert.ok(!h.includes('<script>alert(1)'), 'title is HTML-escaped in meta tags');
  void admin;
});

test('films library page is canonical too; unpublished films have no page', async () => {
  assert.match((await t.client().get('/films')).text, /rel="canonical" href="https:\/\/films\.example\.test\/films"/);
  t.db.prepare("INSERT INTO movies (slug, title, status, validated, published) VALUES ('hidden', 'Hidden', 'ready', 1, 0)").run();
  assert.equal((await t.client().get('/film/hidden')).status, 404);
});

test('robots.txt and sitemap.xml: private areas excluded, only published films listed', async () => {
  const r = (await t.client().get('/robots.txt')).text;
  for (const d of ['/admin', '/api/', '/media/', '/account.html', '/login.html', '/payment-return.html']) assert.match(r, new RegExp(`Disallow: ${d.replace('/', '\\/')}`));
  assert.match(r, /Sitemap: https:\/\/films\.example\.test\/sitemap\.xml/);
  const s = (await t.client().get('/sitemap.xml'));
  assert.match(s.headers.get('content-type'), /xml/);
  assert.match(s.text, /<loc>https:\/\/films\.example\.test\/film\/evil<\/loc>/); assert.ok(!s.text.includes('/film/hidden'));
  assert.ok(!s.text.includes('/admin') && !s.text.includes('/login'));
});

test('private pages are noindex', async () => {
  for (const u of ['/login.html', '/account.html', '/payment-return.html', '/reset-password.html']) assert.match((await t.client().get(u)).text, /name="robots" content="noindex/, u);
});

test('every page has a title, viewport and language; no page loads third-party scripts unless configured', async () => {
  for (const u of ['/', '/films', '/film/evil', '/login.html']) {
    const r = await t.client().get(u);
    assert.match(r.text, /<html lang="en"/); assert.match(r.text, /<title>[^<]+<\/title>/); assert.match(r.text, /name="viewport"/);
    assert.ok(!/<script[^>]+src="https?:\/\/(?!fonts)/.test(r.text), `${u} has no external script tag`);
  }
});
