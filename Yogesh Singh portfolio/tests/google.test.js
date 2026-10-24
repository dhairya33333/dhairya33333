import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { boot, signedUpUser } from './helpers.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
let t, google;
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });

function idToken(claims = {}, { key = keys, kid = 'kid1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-sub-1', email: 'new.person@gmail.com', email_verified: true,
    name: 'New Person', iat: now, exp: now + 3600, ...claims,
  }, key.privateKey, { algorithm: 'RS256', keyid: kid });
}

before(async () => {
  t = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID });
  google = await import('../server/google.js');
  google.setTestCerts({ kid1: pem(keys) });   // the real library verifies against these instead of fetching Google's keys
});
after(async () => { await t.close(); });

const signIn = (c, token) => c.post('/api/auth/google', { credential: token });

test('verifier accepts a valid token and returns only the identity fields', async () => {
  const g = await google.verifyGoogleIdToken(idToken());
  assert.deepEqual(g, { sub: 'g-sub-1', email: 'new.person@gmail.com', name: 'New Person' });
});

test('verifier rejects bad audience, issuer, signature, expiry, unverified email and junk', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    'wrong audience': idToken({ aud: 'someone-else.apps.googleusercontent.com' }),
    'wrong issuer': idToken({ iss: 'https://evil.example.com' }),
    'signed by another key': idToken({}, { key: otherKeys }),
    'expired': idToken({ iat: now - 7200, exp: now - 3600 }),
    'unknown key id': idToken({}, { kid: 'nope' }),
    'unverified email': idToken({ email_verified: false }),
    'email_verified as a string': idToken({ email_verified: 'true' }),
    'missing sub': idToken({ sub: undefined }),
    'missing email': idToken({ email: undefined }),
    'not a jwt': 'x'.repeat(40),
    'empty': '',
  };
  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(() => google.verifyGoogleIdToken(token), google.GoogleAuthError, name);
  }
  await assert.rejects(() => google.verifyGoogleIdToken(undefined), google.GoogleAuthError);
  await assert.rejects(() => google.verifyGoogleIdToken({ a: 1 }), google.GoogleAuthError);
});

test('alg=none and HS256-with-public-key forgeries are rejected', async () => {
  const unsigned = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'kid1' })).toString('base64url') + '.'
    + Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'a@b.co', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3000 })).toString('base64url') + '.';
  await assert.rejects(() => google.verifyGoogleIdToken(unsigned));
  const hs = jwt.sign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'a@b.co', email_verified: true }, pem(keys), { algorithm: 'HS256', keyid: 'kid1' });
  await assert.rejects(() => google.verifyGoogleIdToken(hs));
});

test('endpoint: invalid token is 401 and creates no session or user', async () => {
  const c = t.client();
  const before = t.db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const r = await signIn(c, idToken({ aud: 'wrong' }));
  assert.equal(r.status, 401);
  assert.equal((await c.get('/api/auth/me')).json.user, null);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
});

test('endpoint: first Google sign-in creates a verified, Google-only account; second signs in to the same one', async () => {
  const c = t.client();
  const r = await signIn(c, idToken({ sub: 'sub-A', email: 'alice@gmail.com', name: 'Alice' }));
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'alice@gmail.com');
  const row = t.db.prepare("SELECT * FROM users WHERE email = 'alice@gmail.com'").get();
  assert.equal(row.google_sub, 'sub-A'); assert.equal(row.email_verified, 1);
  const again = t.client();
  const r2 = await signIn(again, idToken({ sub: 'sub-A', email: 'alice@gmail.com' }));
  assert.equal(r2.status, 200);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'alice@gmail.com'").get().c, 1, 'no duplicate account');
  // a changed email on Google's side still resolves by sub, not by email
  const r3 = await signIn(t.client(), idToken({ sub: 'sub-A', email: 'alice.renamed@gmail.com' }));
  assert.equal(r3.status, 200); assert.equal(r3.json.user.email, 'alice@gmail.com');
});

test('a Google-only account cannot be entered with a password', async () => {
  const r = await t.client().post('/api/auth/login', { email: 'alice@gmail.com', password: '!google-sign-in-only' });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /Google/);
  const r2 = await t.client().post('/api/auth/login', { email: 'alice@gmail.com', password: '' });
  assert.equal(r2.status, 401);
});

test('account takeover protection: matching email is NOT merged automatically', async () => {
  // An attacker pre-registers the victim's address with a password they know.
  await signedUpUser(t, 'victim@gmail.com', 'Attacker Made');
  const before = t.db.prepare("SELECT * FROM users WHERE email = 'victim@gmail.com'").get();
  // The real owner now signs in with Google.
  const c = t.client();
  const r = await signIn(c, idToken({ sub: 'victim-sub', email: 'victim@gmail.com' }));
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'link_required');
  assert.equal((await c.get('/api/auth/me')).json.user, null, 'no session was created');
  const after = t.db.prepare("SELECT * FROM users WHERE email = 'victim@gmail.com'").get();
  assert.equal(after.google_sub, null, 'Google identity was not attached');
  assert.equal(after.id, before.id);
});

test('linking requires being signed in, a matching email, and an unused Google identity', async () => {
  const owner = await signedUpUser(t, 'linker@gmail.com', 'Linker');
  assert.equal((await t.client().post('/api/auth/google/link', { credential: idToken({ sub: 'sub-L', email: 'linker@gmail.com' }) })).status, 401, 'must be signed in');
  assert.equal((await owner.post('/api/auth/google/link', { credential: idToken({ sub: 'sub-L', email: 'other@gmail.com' }) })).status, 400, 'different email');
  assert.equal((await owner.post('/api/auth/google/link', { credential: idToken({ aud: 'bad', sub: 'sub-L', email: 'linker@gmail.com' }) })).status, 401, 'invalid token');
  const ok = await owner.post('/api/auth/google/link', { credential: idToken({ sub: 'sub-L', email: 'linker@gmail.com' }) });
  assert.equal(ok.status, 200); assert.equal(ok.json.user.googleLinked, true);
  // now Google sign-in works for that account, and the password still works too
  assert.equal((await signIn(t.client(), idToken({ sub: 'sub-L', email: 'linker@gmail.com' }))).status, 200);
  assert.equal((await t.client().post('/api/auth/login', { email: 'linker@gmail.com', password: 'password-12345' })).status, 200);
  // the same Google identity cannot be attached to a second account
  const other = await signedUpUser(t, 'other@gmail.com');
  const dup = await other.post('/api/auth/google/link', { credential: idToken({ sub: 'sub-L', email: 'other@gmail.com' }) });
  assert.equal(dup.status, 409);
});

test('a Google sign-in cannot take over an admin account by email', async () => {
  t.db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Boss', 'boss@gmail.com', 'x', 'admin')").run();
  const r = await signIn(t.client(), idToken({ sub: 'attacker-sub', email: 'boss@gmail.com' }));
  assert.equal(r.status, 409);
});

test('config endpoint exposes the client id only (never a secret)', async () => {
  const r = await t.client().get('/api/auth/config');
  assert.deepEqual(r.json, { googleClientId: CLIENT_ID });
});

test('CSP allows Google only because it is configured', async () => {
  const r = await t.client().get('/api/auth/config');
  assert.match(r.headers.get('content-security-policy'), /accounts\.google\.com\/gsi\/client/);
});
