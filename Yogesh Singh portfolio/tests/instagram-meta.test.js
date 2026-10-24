import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, signedInAdmin, signedUpUser, waitFor } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const realFetch = globalThis.fetch;
const calls = [];
let mode = {};                                   // what the fake Instagram does in the current test
let t, admin;

const page = (extra = '') => `<!doctype html><html><head>
<meta property="og:title" content="Yogesh Pratap Singh on Instagram: &quot;Courage &amp; discipline&quot;" />
<meta content="49 likes, 3 comments - ypsingh on October 12, 2026: &quot;Courage &amp; discipline: a short thought for today&quot;." property="og:description" />
<meta property="og:image" content="${mode.image ?? 'https://scontent-bom1-1.cdninstagram.com/v/t51/abc.jpg?stp=dst&amp;_nc=1'}" />${extra}</head><body></body></html>`;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith(t?.base || 'http://127.0.0.1')) return realFetch(url, init);
  calls.push(u);
  if (mode.networkDown) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
  if (u.startsWith('https://www.instagram.com/')) {
    const res = new Response(page(), { status: mode.pageStatus || 200, headers: { 'content-type': 'text/html' } });
    if (mode.loginWall) Object.defineProperty(res, 'url', { value: 'https://www.instagram.com/accounts/login/?next=x' });
    return res;
  }
  if (mode.redirectTo && u.includes('redir')) return new Response(null, { status: 302, headers: { location: mode.redirectTo } });
  const body = mode.imageBody ?? PNG;
  return new Response(body, { status: 200, headers: { 'content-type': mode.imageType ?? 'image/png', ...(mode.imageLength ? { 'content-length': String(mode.imageLength) } : {}) } });
};

before(async () => { t = await boot(); admin = await signedInAdmin(t); });
after(async () => { globalThis.fetch = realFetch; await t.close(); });
const reset = (m = {}) => { mode = m; calls.length = 0; };
const add = (code, kind = 'p', extra = {}) => admin.post('/api/admin/social/embed', { url: `https://www.instagram.com/${kind}/${code}/`, ...extra });
const row = (code) => t.db.prepare("SELECT * FROM social_posts WHERE ext_id = ?").get(code);

test('page parser reads image, caption and author from either attribute order, with HTML entities decoded', async () => {
  const { parsePreview, decodeHtml } = await import('../server/instagram-meta.js');
  reset();
  const p = parsePreview(page());
  assert.equal(p.image, 'https://scontent-bom1-1.cdninstagram.com/v/t51/abc.jpg?stp=dst&_nc=1');
  assert.equal(p.caption, 'Courage & discipline: a short thought for today');
  assert.equal(p.author, 'ypsingh');
  assert.equal(decodeHtml('&lt;b&gt; &#39;x&#39; &#x41; &amp;amp;'), "<b> 'x' A &amp;");
  assert.deepEqual(parsePreview('<html></html>'), { image: '', caption: '', author: '' });
});

test('adding a link downloads the cover once, stores caption and author, and the public API exposes only local paths', async () => {
  reset();
  const r = await add('Cabcdefgh01', 'reel');
  assert.equal(r.status, 200); assert.equal(r.json.cover, true);
  const p = row('Cabcdefgh01');
  assert.equal(p.thumb, '/uploads/ig/embed-Cabcdefgh01.png'); assert.equal(p.cover_source, 'fetched');
  assert.equal(p.caption, 'Courage & discipline: a short thought for today'); assert.equal(p.author, 'ypsingh');
  assert.ok(fs.readFileSync(path.join(t.dirs.uploads, 'ig/embed-Cabcdefgh01.png')).equals(PNG));
  const api = (await t.client().get('/api/social')).json.embeds[0];
  assert.deepEqual({ kind: api.kind, code: api.code, thumb: api.thumb, author: api.author }, { kind: 'reel', code: 'Cabcdefgh01', thumb: '/uploads/ig/embed-Cabcdefgh01.png', author: 'ypsingh' });
  assert.ok(!JSON.stringify(api).includes('cdninstagram'), 'no remote image address reaches the browser');
  assert.equal((await t.client().get(api.thumb)).status, 200, 'the cover is served from this site');
  assert.ok(calls[0] === 'https://www.instagram.com/reel/Cabcdefgh01/' && calls[1].startsWith('https://scontent-bom1-1.cdninstagram.com/'));
});

test('an admin-typed caption is kept; fetched caption only fills an empty one', async () => {
  reset();
  await add('Cmycaption01', 'p', { caption: 'My own words' });
  assert.equal(row('Cmycaption01').caption, 'My own words');
});

test('Instagram asking for a login, an error page or no network: the post is still added, without a cover, and says why', async () => {
  reset({ loginWall: true });
  let r = await add('Clogin00001'); assert.equal(r.status, 200); assert.equal(r.json.cover, false); assert.equal(r.json.note, 'instagram_asked_for_login');
  reset({ pageStatus: 429 });
  r = await add('Crate000001'); assert.equal(r.json.cover, false);
  reset({ networkDown: true });
  r = await add('Cdown000001'); assert.equal(r.status, 200); assert.equal(r.json.note, 'could_not_reach_instagram');
  assert.equal(row('Cdown000001').thumb, null);
  const list = (await t.client().get('/api/social')).json.embeds;
  assert.ok(list.some((e) => e.code === 'Cdown000001' && e.thumb === ''), 'the page can still show it with its designed no-cover card');
});

test('SSRF protection: only Instagram CDN https hosts may be downloaded from', async () => {
  const evil = ['http://127.0.0.1:8080/x.jpg', 'https://127.0.0.1/x.jpg', 'https://evil.example/x.jpg', 'https://scontent.cdninstagram.com.evil.example/x.jpg', 'https://evil.example/https://x.cdninstagram.com/a.jpg',
    'https://user:pw@scontent.cdninstagram.com/x.jpg', 'https://scontent.cdninstagram.com:8443/x.jpg', 'https://cdninstagram.com.attacker.net/x.jpg', 'file:///etc/passwd', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/x.jpg'];
  for (const [i, image] of evil.entries()) {
    reset({ image });
    const r = await add(`Cevil${String(i).padStart(6, '0')}`);
    assert.equal(r.json.cover, false, image);
    assert.ok(!calls.some((c) => c === image || c.startsWith(image)), `${image} was never requested`);
  }
});

test('redirects are re-checked: a CDN link that bounces to another host is refused', async () => {
  reset({ image: 'https://scontent.cdninstagram.com/redir.jpg', redirectTo: 'https://evil.example/steal.jpg' });
  const r = await add('Credirect001');
  assert.equal(r.json.cover, false);
  assert.ok(!calls.includes('https://evil.example/steal.jpg'));
});

test('non-images and oversized images are rejected and leave no file behind', async () => {
  reset({ imageType: 'text/html', imageBody: '<script>alert(1)</script>' });
  assert.equal((await add('Chtml000001')).json.cover, false);
  reset({ imageType: 'image/svg+xml', imageBody: '<svg onload="alert(1)"/>' });
  assert.equal((await add('Csvg0000001')).json.cover, false, 'SVG can carry script, so it is not accepted');
  reset({ imageLength: 50 * 1024 * 1024 });
  assert.equal((await add('Cbig0000001')).json.cover, false);
  reset({ imageBody: Buffer.alloc(9 * 1024 * 1024, 1), imageType: 'image/jpeg' });
  assert.equal((await add('Cbig0000002')).json.cover, false);
  const files = fs.readdirSync(path.join(t.dirs.uploads, 'ig'));
  for (const c of ['Chtml000001', 'Csvg0000001', 'Cbig0000001', 'Cbig0000002']) assert.ok(!files.some((f) => f.includes(c)), c);
});

test('admin can upload a cover; it is image-only, size-limited, admin-only, and survives a refresh', async () => {
  reset({ loginWall: true });
  await add('Cupload0001');
  const id = row('Cupload0001').id;
  const send = (client, name, bytes, type = 'image/png') => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), name); return fetch(`${t.base}/api/admin/social/${id}/cover`, { method: 'POST', body: fd, headers: { cookie: client.cookie } }); };
  const user = await signedUpUser(t, 'x@example.com');
  assert.equal((await send(user, 'c.png', PNG)).status, 403);
  assert.equal((await fetch(`${t.base}/api/admin/social/${id}/cover`, { method: 'POST', body: new FormData() })).status, 401);
  for (const bad of ['evil.html', 'evil.svg', 'evil.exe', 'evil.php', 'evil.png.html']) assert.equal((await send(admin, bad, '<script>x</script>')).status, 400, bad);
  assert.equal((await send(admin, 'cover.png', PNG)).status, 200);
  const p = row('Cupload0001'); assert.match(p.thumb, /^\/uploads\/cover-[a-f0-9]+\.png$/); assert.equal(p.cover_source, 'uploaded');
  assert.equal((await t.client().get(p.thumb)).status, 200);
  reset();                                              // Instagram now cooperates, but must not overwrite the admin's cover
  await admin.post(`/api/admin/social/${id}/refresh`);
  assert.equal(row('Cupload0001').thumb, p.thumb);
  await admin.del(`/api/admin/social/${id}`);
  await waitFor(() => !fs.existsSync(path.join(t.dirs.uploads, path.basename(p.thumb))), { timeout: 3000, label: 'uploaded cover removed with the post' });
});

test('refresh and caption editing: admin only, unknown posts are 404', async () => {
  reset();
  await add('Cedit000001');
  const id = row('Cedit000001').id;
  assert.equal((await t.client().post(`/api/admin/social/${id}/refresh`)).status, 401);
  assert.equal((await admin.post('/api/admin/social/999999/refresh')).status, 404);
  assert.equal((await admin.put(`/api/admin/social/${id}`, { caption: 'x'.repeat(900) })).status, 200);
  assert.equal(row('Cedit000001').caption.length, 600);
  assert.equal((await admin.post(`/api/admin/social/${id}/refresh`)).status, 200);
  assert.equal(row('Cedit000001').thumb, '/uploads/ig/embed-Cedit000001.png');
});

test('Social page markup and script: accessible viewer dialog; embed address built from the short code only', async () => {
  const html = (await t.client().get('/social')).text, js = (await t.client().get('/js/social.js')).text;
  assert.match(html, /id="lb" role="dialog" aria-modal="true"/); assert.match(html, /aria-label="Close"/);
  assert.match(js, /https:\/\/www\.instagram\.com\/\$\{e\.kind\}\/\$\{e\.code\}\/embed\//);
  assert.match(js, /setAttribute\('sandbox'/); assert.match(js, /ev\.key === 'Escape'/); assert.match(js, /ArrowLeft/);
  assert.ok(!/innerHTML\s*=\s*[^;]*e\.caption(?![^;]*esc\()/.test(js), 'captions are always escaped before use as HTML');
});
