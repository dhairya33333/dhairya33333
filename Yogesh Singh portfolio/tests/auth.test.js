import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, makeAdmin, signedUpUser } from './helpers.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('register, session, logout, login', async () => {
  const c = t.client();
  let r = await c.post('/api/auth/register', { name: 'Asha', email: 'Asha@Example.com', password: 'longenough1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'asha@example.com');
  assert.equal((await c.get('/api/auth/me')).json.user.name, 'Asha');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).json.user, null);
  r = await c.post('/api/auth/login', { email: 'asha@example.com', password: 'longenough1' });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/auth/me')).json.user.email, 'asha@example.com');
});

test('registration validation and duplicate email', async () => {
  const c = t.client();
  assert.equal((await c.post('/api/auth/register', { name: '', email: 'a@b.co', password: 'longenough1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { name: 'X', email: 'not-an-email', password: 'longenough1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { name: 'X', email: 'x@b.co', password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { name: 'X', email: 'x@b.co', password: 'a'.repeat(80) })).status, 400, 'over 72 bytes is refused, not truncated');
  assert.equal((await c.post('/api/auth/register', { name: 'X', email: 'dup@b.co', password: 'longenough1' })).status, 200);
  assert.equal((await t.client().post('/api/auth/register', { name: 'Y', email: 'DUP@b.co', password: 'longenough1' })).status, 409);
});

test('wrong password and unknown user get the same generic error', async () => {
  await signedUpUser(t, 'known@example.com');
  const a = await t.client().post('/api/auth/login', { email: 'known@example.com', password: 'wrong-password' });
  const b = await t.client().post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
});

test('password hashes are bcrypt and never returned by the API', async () => {
  const c = await signedUpUser(t, 'hash@example.com');
  const row = t.db.prepare("SELECT password_hash FROM users WHERE email = 'hash@example.com'").get();
  assert.match(row.password_hash, /^\$2[aby]\$/);
  const me = await c.get('/api/auth/me');
  assert.ok(!JSON.stringify(me.json).includes('password_hash'));
  assert.ok(!JSON.stringify(me.json).includes(row.password_hash));
});

test('admin routes: anonymous 401, normal user 403, admin 200', async () => {
  const admin = makeAdmin(t, 'boss@example.com');
  const user = await signedUpUser(t, 'plain@example.com');
  for (const route of ['/api/admin/stats', '/api/admin/movies', '/api/admin/users', '/api/admin/orders', '/api/admin/storage', '/api/admin/settings']) {
    assert.equal((await t.client().get(route)).status, 401, `anon ${route}`);
    assert.equal((await user.get(route)).status, 403, `user ${route}`);
  }
  const a = t.client(); await a.post('/api/auth/login', admin);
  assert.equal((await a.get('/api/admin/stats')).status, 200);
  assert.equal((await user.post('/api/admin/movies', { title: 'Nope' })).status, 403);
  assert.equal((await t.client().get('/admin')).status, 302, 'admin page redirects when signed out');
  assert.equal((await user.get('/admin/admin.js')).status, 404, 'admin assets are not served to normal users');
});

test('changing the password ends other sessions; current password is required', async () => {
  const c1 = await signedUpUser(t, 'rot@example.com');
  const c2 = t.client(); await c2.post('/api/auth/login', { email: 'rot@example.com', password: 'password-12345' });
  assert.equal((await c1.post('/api/auth/password', { current: 'wrong', password: 'brand-new-pass-1' })).status, 400);
  assert.equal((await c1.post('/api/auth/password', { current: 'password-12345', password: 'brand-new-pass-1' })).status, 200);
  assert.equal((await c1.get('/api/auth/me')).json.user.email, 'rot@example.com', 'the browser that changed it stays signed in');
  assert.equal((await c2.get('/api/auth/me')).json.user, null, 'the other session is revoked');
  assert.equal((await t.client().post('/api/auth/login', { email: 'rot@example.com', password: 'password-12345' })).status, 401);
});

test('cross-origin state-changing requests are rejected', async () => {
  const c = await signedUpUser(t, 'csrf@example.com');
  const r = await c.post('/api/auth/logout', {}, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal((await c.get('/api/auth/me')).json.user.email, 'csrf@example.com', 'still signed in');
});

test('session cookie is HttpOnly and SameSite=Lax', async () => {
  const res = await fetch(t.base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'C', email: 'cookie@example.com', password: 'longenough1' }) });
  const c = res.headers.get('set-cookie');
  assert.match(c, /HttpOnly/i); assert.match(c, /SameSite=Lax/i);
});

test('errors never leak stack traces or secrets', async () => {
  const r = await t.client().req('POST', '/api/auth/login', { raw: '{bad json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.ok(!/at .*\.js/.test(r.text) && !r.text.includes('JWT'));
  assert.ok(!(await t.client().get('/api/does-not-exist')).text.includes('node_modules'));
});

test('a malformed login body is rejected without being written to the log', async () => {
  const logged = [];
  const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { await t.client().req('POST', '/api/auth/login', { raw: '{"email":"a@b.co","password":"TopSecretPw!" oops', headers: { 'content-type': 'application/json' } }); }
  finally { console.error = orig; }
  assert.ok(!logged.join('\n').includes('TopSecretPw'));
});
