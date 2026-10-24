import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin, signedUpUser } from './helpers.js';

let t, admin;
before(async () => { t = await boot({ SITE_URL: 'https://films.example.test', RATE_LIMIT_CONTACT: '6' }); admin = await signedInAdmin(t); });
after(async () => { await t.close(); });

const msgs = () => t.db.prepare('SELECT * FROM messages ORDER BY id').all();
const good = { name: 'Asha Rao', email: 'asha@example.com', topic: 'speaking', organisation: 'Mumbai University', message: 'We would like to invite Mr. Singh to give a talk to our students.' };

test('About, Contact and Social pages exist with titles, canonical URLs and are in the sitemap', async () => {
  for (const [u, title] of [['/about', 'About'], ['/contact', 'Contact'], ['/social', 'Social media']]) {
    const r = await t.client().get(u);
    assert.equal(r.status, 200, u);
    assert.match(r.text, new RegExp(`<title>${title} — Yogesh Pratap Singh</title>`), u);
    assert.match(r.text, new RegExp(`rel="canonical" href="https://films\\.example\\.test${u}"`), u);
    assert.match(r.text, /name="description" content="[^"]{20,}/);
  }
  const map = (await t.client().get('/sitemap.xml')).text;
  for (const u of ['/about', '/contact', '/social']) assert.ok(map.includes(`https://films.example.test${u}<`), u);
});

test('every public page links to the new pages in its navigation', async () => {
  for (const u of ['/', '/films', '/login.html', '/about', '/contact', '/social']) {
    const h = (await t.client().get(u)).text;
    const chrome = ['/about', '/contact', '/social'].includes(u);           // these pages get their header from layout.js
    const nav = chrome ? (await t.client().get('/js/layout.js')).text : h;
    for (const l of ['/about', '/social', '/contact']) assert.ok(nav.includes(chrome ? `'${l}'` : `"${l}"`), `${u} links to ${l}`);
  }
});

test('contact form: valid message is stored; admin sees it unread', async () => {
  const r = await t.client().post('/api/contact', good);
  assert.equal(r.status, 200);
  const [m] = msgs();
  assert.equal(m.name, 'Asha Rao'); assert.equal(m.email, 'asha@example.com'); assert.equal(m.topic, 'speaking'); assert.equal(m.is_read, 0);
  const inbox = (await admin.get('/api/admin/messages')).json;
  assert.equal(inbox.unread, 1); assert.equal(inbox.messages[0].message, good.message);
  assert.equal((await admin.get('/api/admin/stats')).json.unread_messages, 1);
});

test('contact form: validation returns per-field errors and stores nothing', async () => {
  const before = msgs().length;
  let r = await t.client().post('/api/contact', { name: '', email: 'nope', phone: 'abc', message: 'short' });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.json.fields).sort(), ['email', 'message', 'name', 'phone']);
  r = await t.client().post('/api/contact', { ...good, message: 'see http://a.example http://b.example http://c.example http://d.example' });
  assert.equal(r.status, 400); assert.ok(r.json.fields.message);
  assert.equal(msgs().length, before);
});

test('contact form: unknown topic falls back, oversized/odd input is trimmed or cleaned, hostile text stays inert data', async () => {
  const r = await t.client().post('/api/contact', { ...good, topic: '<script>', name: '  Eve\u0000 <b>x</b>  ', message: 'x'.repeat(9000), organisation: 'o'.repeat(500) });
  assert.equal(r.status, 200);
  const m = msgs().at(-1);
  assert.equal(m.topic, 'general'); assert.ok(m.message.length === 4000 && m.organisation.length === 120);
  assert.ok(!m.name.includes('\u0000'));
  assert.equal(m.name, 'Eve <b>x</b>', 'stored as plain text; the admin screen escapes it when shown');
  const page = (await t.client().get('/contact?topic=<script>alert(1)</script>')).text;
  assert.ok(!page.includes('alert(1)'), 'query string is not reflected into the page');
});

test('contact form: honeypot field silently stores nothing; non-JSON and cross-origin posts are refused', async () => {
  const before = msgs().length;
  const r = await t.client().post('/api/contact', { ...good, website: 'http://spam.example' });
  assert.equal(r.status, 200); assert.equal(msgs().length, before, 'bot gets a normal answer but nothing is saved');
  assert.equal((await t.client().post('/api/contact', good, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await t.client().req('POST', '/api/contact', { raw: 'name=a&email=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 400);
});

test('contact form is rate limited per IP', async () => {
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await t.client().post('/api/contact', { ...good, name: `Person ${i}` })).status);
  assert.ok(codes.includes(429), `expected a 429 in ${codes}`);
});

test('inbox is admin only; admin can mark read/unread and delete; users cannot', async () => {
  const user = await signedUpUser(t, 'visitor@example.com');
  for (const [m, u] of [['get', '/api/admin/messages'], ['put', '/api/admin/messages/1'], ['del', '/api/admin/messages/1']]) {
    assert.equal((await t.client()[m](u, ...(m === 'put' ? [{}] : []))).status, 401, `anon ${m}`);
    assert.equal((await user[m](u, ...(m === 'put' ? [{}] : []))).status, 403, `user ${m}`);
  }
  const first = msgs()[0].id;
  assert.equal((await admin.put(`/api/admin/messages/${first}`, { read: true })).status, 200);
  assert.equal(msgs()[0].is_read, 1);
  assert.equal((await admin.put(`/api/admin/messages/${first}`, { read: false })).status, 200);
  assert.equal(msgs()[0].is_read, 0);
  assert.equal((await admin.del(`/api/admin/messages/${first}`)).status, 200);
  assert.ok(!msgs().some((m) => m.id === first));
});

test('Instagram links: only real post/reel URLs are accepted and normalised', async () => {
  const { parseInstagramLink } = await import('../server/routes/admin.js');
  const ok = {
    'https://www.instagram.com/p/CxYz123AbCd/': { code: 'CxYz123AbCd', kind: 'p' },
    'https://instagram.com/p/CxYz123AbCd': { code: 'CxYz123AbCd', kind: 'p' },
    'https://www.instagram.com/reel/Cabc_DEF-12/?igsh=abc123&utm_source=x': { code: 'Cabc_DEF-12', kind: 'reel' },
    'https://www.instagram.com/reels/Cabc_DEF-12/': { code: 'Cabc_DEF-12', kind: 'reel' },
    'https://www.instagram.com/tv/Cabc_DEF-12/': { code: 'Cabc_DEF-12', kind: 'reel' },
    'https://www.instagram.com/yp_singh/p/CxYz123AbCd/': { code: 'CxYz123AbCd', kind: 'p' },
    '  https://www.instagram.com/p/CxYz123AbCd/  ': { code: 'CxYz123AbCd', kind: 'p' },
  };
  for (const [u, want] of Object.entries(ok)) assert.deepEqual(parseInstagramLink(u), want, u);
  for (const bad of ['', null, undefined, 'not a url', 'http://www.instagram.com/p/CxYz123AbCd/', 'https://instagram.com.evil.example/p/CxYz123AbCd/',
    'https://evil.example/https://www.instagram.com/p/CxYz123AbCd/', 'https://www.instagram.com@evil.example/p/CxYz123AbCd/', 'https://user:pw@www.instagram.com/p/CxYz123AbCd/',
    'https://www.instagram.com:8443/p/CxYz123AbCd/', 'https://www.instagram.com/p/', 'https://www.instagram.com/p/ab/', 'https://www.instagram.com/p/CxYz123AbCd/../../x',
    'https://www.instagram.com/explore/tags/film/', 'https://www.instagram.com/yp_singh/', 'javascript:alert(1)', 'https://www.instagram.com/p/<script>alert(1)</script>/', 'https://www.instagram.com/p/Cx"onload="x/']) {
    assert.equal(parseInstagramLink(bad), null, String(bad));
  }
});

test('adding Instagram links: admin only, no duplicates, public API exposes only a validated shortcode', async () => {
  const user = await signedUpUser(t, 'v2@example.com');
  assert.equal((await user.post('/api/admin/social/embed', { url: 'https://www.instagram.com/p/AAAAAAAAAAA/' })).status, 403);
  assert.equal((await t.client().post('/api/admin/social/embed', { url: 'https://www.instagram.com/p/AAAAAAAAAAA/' })).status, 401);
  assert.equal((await admin.post('/api/admin/social/embed', { url: 'https://evil.example/p/AAAAAAAAAAA/' })).status, 400);
  assert.equal((await admin.post('/api/admin/social/embed', { url: 'https://www.instagram.com/p/AAAAAAAAAAA/?igsh=1', caption: 'First' })).status, 200);
  assert.equal((await admin.post('/api/admin/social/embed', { url: 'https://www.instagram.com/p/AAAAAAAAAAA/' })).status, 409, 'duplicate');
  assert.equal((await admin.post('/api/admin/social/embed', { url: 'https://www.instagram.com/reel/BBBBBBBBBBB/' })).status, 200);
  const api = (await t.client().get('/api/social')).json;
  assert.deepEqual(api.embeds.map((e) => [e.kind, e.code]), [['reel', 'BBBBBBBBBBB'], ['p', 'AAAAAAAAAAA']], 'newest first');
  assert.ok(!JSON.stringify(api).includes('instagram.com'), 'the browser is never handed a free-form URL; it builds the address from the code');
  // hide / show / remove
  const id = api.embeds[1].id;
  await admin.put(`/api/admin/social/${id}`, { hidden: true });
  assert.equal((await t.client().get('/api/social')).json.embeds.length, 1);
  await admin.put(`/api/admin/social/${id}`, { hidden: false });
  await admin.del(`/api/admin/social/${id}`);
  assert.equal((await t.client().get('/api/social')).json.embeds.length, 1);
});

test('the Social page JS builds embed addresses only from the shortcode, with a sandboxed lazy iframe', async () => {
  const js = (await t.client().get('/js/social.js')).text;
  assert.match(js, /https:\/\/www\.instagram\.com\/\$\{e\.kind\}\/\$\{esc\(e\.code\)\}\/embed\/captioned\//);
  assert.match(js, /setAttribute\('sandbox'/); assert.match(js, /loading = 'lazy'/);
  const csp = (await t.client().get('/social')).headers.get('content-security-policy');
  assert.match(csp, /frame-src [^;]*https:\/\/www\.instagram\.com/);
  assert.ok(!/frame-src [^;]*\*/.test(csp), 'no wildcard frame sources');
  assert.match(csp, /script-src 'self'(?! [^;]*instagram)/, 'Instagram is allowed as a frame only, never as a script source');
});

test('new site-content settings are editable by admin only and validated', async () => {
  const body = { contact_phone: '+91 98765 43210', contact_location: 'Mumbai, India', social_intro: 'Posts and reels.', social_instagram: 'javascript:alert(1)' };
  assert.equal((await admin.put('/api/admin/settings', body)).status, 400, 'a javascript: link is refused');
  body.social_instagram = 'https://www.instagram.com/example/';
  assert.equal((await admin.put('/api/admin/settings', body)).status, 200);
  const site = (await t.client().get('/api/site')).json.settings;
  assert.equal(site.contact_phone, '+91 98765 43210'); assert.equal(site.contact_location, 'Mumbai, India');
  assert.equal((await t.client().put('/api/admin/settings', body)).status, 401);
});

test('the hidden attribute really hides elements (sign-in form must not show the registration-only name box)', async () => {
  const css = (await t.client().get('/css/site.css')).text;
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  const login = (await t.client().get('/login.html')).text;
  assert.match(login, /id="f-name" hidden/, 'name field starts hidden and is only revealed by the Create account link');
});
