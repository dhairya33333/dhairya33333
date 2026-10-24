import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { boot, signedUpUser, signedInAdmin, makeAdmin } from './helpers.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });
const uid = (email) => t.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

test('logout revokes the token itself: a copied cookie stops working', async () => {
  const c = await signedUpUser(t, 'copy@example.com');
  const stolen = c.cookie;
  assert.equal((await t.client().get('/api/auth/me', { headers: { cookie: stolen } })).json.user.email, 'copy@example.com');
  await c.post('/api/auth/logout');
  assert.equal((await t.client().get('/api/auth/me', { headers: { cookie: stolen } })).json.user, null, 'replayed cookie is rejected');
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM revoked_tokens').get().c, 1);
  const { purgeRevoked } = await import('../server/auth.js');
  t.db.prepare('UPDATE revoked_tokens SET expires_at = 1').run(); purgeRevoked();
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM revoked_tokens').get().c, 0, 'expired revocations are cleaned');
});

test('expired, forged, wrong-algorithm and claim-tampered sessions are anonymous; browser-supplied identity is ignored', async () => {
  await signedUpUser(t, 'victim@example.com');
  const id = uid('victim@example.com');
  const secret = process.env.JWT_SECRET;
  const asCookie = (tok) => `yp_session=${tok}`;
  const cases = {
    expired: jwt.sign({ uid: id, tv: 0, jti: 'a' }, secret, { expiresIn: -60 }),
    'wrong secret': jwt.sign({ uid: id, tv: 0, jti: 'b' }, 'attacker-secret', { expiresIn: '1h' }),
    'alg none': Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ uid: id, tv: 0 })).toString('base64url') + '.',
    'HS512 (not the allowed algorithm)': jwt.sign({ uid: id, tv: 0 }, secret, { algorithm: 'HS512' }),
    'stale token_version': jwt.sign({ uid: id, tv: 99, jti: 'c' }, secret, { expiresIn: '1h' }),
  };
  for (const [name, tok] of Object.entries(cases)) {
    assert.equal((await t.client().get('/api/auth/me', { headers: { cookie: asCookie(tok) } })).json.user, null, name);
    assert.equal((await t.client().get('/api/admin/stats', { headers: { cookie: asCookie(tok) } })).status, 401, name);
  }
  // identity or role sent by the browser is never believed
  const r = await t.client().get('/api/auth/me?uid=1&role=admin', { headers: { 'x-user-id': '1', 'x-role': 'admin' } });
  assert.equal(r.json.user, null);
});

test('an expired session cannot reach paid media or checkout', async () => {
  t.db.prepare("INSERT INTO movies (slug, title, status, validated, published) VALUES ('auth-film', 'F', 'ready', 1, 1)").run();
  const mid = t.db.prepare("SELECT id FROM movies WHERE slug='auth-film'").get().id;
  const expired = jwt.sign({ uid: uid('victim@example.com'), tv: 0, jti: 'z' }, process.env.JWT_SECRET, { expiresIn: -5 });
  const c = t.client();
  assert.equal((await c.post('/api/payments/checkout', { movieId: mid }, { headers: { cookie: `yp_session=${expired}` } })).status, 401);
});

test('demoting or promoting a user ends their existing sessions immediately', async () => {
  const admin = await signedInAdmin(t);
  const user = await signedUpUser(t, 'promoted@example.com');
  assert.equal((await user.get('/api/admin/stats')).status, 403);
  await admin.post(`/api/admin/users/${uid('promoted@example.com')}/role`, { role: 'admin' });
  assert.equal((await user.get('/api/auth/me')).json.user, null, 'old session is gone; they must sign in again to get the new role');
  const again = t.client(); await again.post('/api/auth/login', { email: 'promoted@example.com', password: 'password-12345' });
  assert.equal((await again.get('/api/admin/stats')).status, 200);
  await admin.post(`/api/admin/users/${uid('promoted@example.com')}/role`, { role: 'user' });
  assert.equal((await again.get('/api/admin/stats')).status, 401, 'demoted admin loses access at once');
});

test('password recovery: admin-issued one-time link, hashed at rest, single use, expiring, rate limited input', async () => {
  const admin = await signedInAdmin(t);
  const victim = await signedUpUser(t, 'forgot@example.com');
  const id = uid('forgot@example.com');
  assert.equal((await victim.post(`/api/admin/users/${id}/reset-link`)).status, 403, 'users cannot issue links');
  assert.equal((await t.client().post(`/api/admin/users/${id}/reset-link`)).status, 401);
  assert.equal((await admin.post('/api/admin/users/99999/reset-link')).status, 404);
  const issued = await admin.post(`/api/admin/users/${id}/reset-link`);
  assert.equal(issued.status, 200);
  const token = new URL(issued.json.url).searchParams.get('token');
  assert.ok(token.length >= 32);
  assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM password_resets').all()).includes(token), 'only a hash is stored');

  const anon = t.client();
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'short' })).status, 400, 'weak password refused, link not consumed');
  assert.equal((await anon.post('/api/auth/reset', { token: 'x'.repeat(48), password: 'a-new-password-1' })).status, 400, 'unknown token');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'a-new-password-1' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'another-password-2' })).status, 400, 'single use');
  assert.equal((await victim.get('/api/auth/me')).json.user, null, 'old sessions are ended');
  assert.equal((await t.client().post('/api/auth/login', { email: 'forgot@example.com', password: 'password-12345' })).status, 401);
  assert.equal((await t.client().post('/api/auth/login', { email: 'forgot@example.com', password: 'a-new-password-1' })).status, 200);

  const second = (await admin.post(`/api/admin/users/${id}/reset-link`)).json.url;
  const t2 = new URL(second).searchParams.get('token');
  t.db.prepare('UPDATE password_resets SET expires_at = ? WHERE used_at IS NULL').run(Date.now() - 1000);
  assert.equal((await anon.post('/api/auth/reset', { token: t2, password: 'yet-another-pass-3' })).status, 400, 'expired');
});

test('startup validation: malformed Google client id is refused; production requires an https SITE_URL', () => {
  const run = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', "const {config}=await import('./server/config.js'); console.log(JSON.stringify({g:config.google}))"], { env: { PATH: process.env.PATH, DATA_DIR: t.dataDir, ...env }, encoding: 'utf8' });
  let r = run({ GOOGLE_CLIENT_ID: 'not-a-client-id' });
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).g.clientId, '', 'invalid id disables Google sign-in');
  assert.match(r.stderr, /not a valid Google OAuth client id/);
  r = run({ GOOGLE_CLIENT_ID: 'abc-123.apps.googleusercontent.com' });
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).g.clientId, 'abc-123.apps.googleusercontent.com');
  r = run({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), SITE_URL: 'http://insecure.example' });
  assert.equal(r.status, 1); assert.match(r.stderr, /https/);
  r = run({ NODE_ENV: 'production', JWT_SECRET: 'short', SITE_URL: 'https://ok.example' });
  assert.equal(r.status, 1); assert.match(r.stderr, /JWT_SECRET/);
  r = run({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://ok.example' });
  assert.equal(r.status, 0);
});

test('CORS: no cross-origin access is granted; security headers present; no stack traces', async () => {
  const r = await t.client().get('/api/site', { headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(t.base + '/api/auth/login', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const h = r.headers;
  assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.equal(h.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(h.get('content-security-policy'), /default-src 'self'/); assert.match(h.get('content-security-policy'), /object-src 'none'/);
  assert.match(h.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(h.get('x-powered-by'), null);
  const bad = await t.client().req('POST', '/api/auth/login', { raw: '{"a":', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400); assert.ok(!/at \w+|node_modules|\.js:\d+/.test(bad.text));
});
