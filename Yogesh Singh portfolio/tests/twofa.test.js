import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, makeAdmin, signedUpUser } from './helpers.js';

let t, hotp, base32Decode, base32Encode, verifyTotp, totpAt, sealSecret, openSecret, newRecoveryCodes, hashRecovery;
before(async () => {
  t = await boot({ RATE_LIMIT_AUTH: '500' });
  ({ hotp, base32Decode, base32Encode, verifyTotp, totpAt, sealSecret, openSecret, newRecoveryCodes, hashRecovery } = await import('../server/totp.js'));   // after boot: config must see the test environment
});
after(async () => { await t.close(); });

test('TOTP matches the RFC 6238 published test vectors (SHA-1, 8 digits) and RFC 4226 HOTP vectors', () => {
  const key = Buffer.from('12345678901234567890');
  for (const [time, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(hotp(key, Math.floor(time / 30), 8), code, `t=${time}`);
  }
  ['755224', '287082', '359152', '969429', '338314', '254676'].forEach((c, i) => assert.equal(hotp(key, i), c));
  assert.equal(base32Encode(key), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); assert.deepEqual(base32Decode('gezd gnbv-GY3TQOJQ GEZDGNBVGY3TQOJQ'), key);
});

test('verification: ±1 step drift allowed, 2 steps not, a used step cannot be replayed, bad input rejected', () => {
  const s = base32Encode(Buffer.from('abcdefghijklmnopqrst')), now = 1_700_000_000_000, c = (ms) => totpAt(s, ms);
  const step = Math.floor(now / 30000);
  assert.equal(verifyTotp(s, c(now), { now }), step);
  assert.equal(verifyTotp(s, c(now - 30000), { now }), step - 1); assert.equal(verifyTotp(s, c(now + 30000), { now }), step + 1);
  assert.equal(verifyTotp(s, c(now - 90000), { now }), null);
  assert.equal(verifyTotp(s, c(now), { now, lastStep: step }), null, 'replay');
  for (const bad of ['', 'abcdef', '12345', '1234567', null, undefined]) assert.equal(verifyTotp(s, bad, { now }), null);
});

test('secrets are encrypted at rest and tamper-evident; recovery codes are hashed', () => {
  const sealed = sealSecret('JBSWY3DPEHPK3PXP'); assert.ok(!sealed.includes('JBSWY')); assert.equal(openSecret(sealed), 'JBSWY3DPEHPK3PXP');
  const parts = sealed.split('.'); parts[2] = Buffer.from('x'.repeat(10)).toString('base64'); assert.throws(() => openSecret(parts.join('.')));
  const codes = newRecoveryCodes(); assert.equal(new Set(codes).size, 10); assert.match(codes[0], /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  assert.equal(hashRecovery(codes[0]), hashRecovery(codes[0].toUpperCase().replace('-', ' ')), 'forgiving about case and separators');
});

async function enroll(email = 'admin2@test.com', password = 'admin-password-123') {
  makeAdmin(t, email, password);
  const c = t.client(); assert.equal((await c.post('/api/auth/login', { email, password })).status, 200);
  const setup = await c.post('/api/auth/2fa/setup', { password }); assert.equal(setup.status, 200, setup.text);
  assert.match(setup.json.qr, /^data:image\/png;base64,/); assert.match(setup.json.uri, /^otpauth:\/\/totp\//);
  const secret = setup.json.secret.replace(/ /g, '');
  assert.equal((await c.post('/api/auth/2fa/enable', { code: '000000' })).status, 400);
  const en = await c.post('/api/auth/2fa/enable', { code: totpAt(secret, Date.now()) });
  assert.equal(en.status, 200); assert.equal(en.json.recoveryCodes.length, 10);
  return { email, password, secret, codes: en.json.recoveryCodes, c };
}

test('full flow: password alone no longer signs in; ticket + code does; codes are single use; wrong codes lock the ticket', async () => {
  const a = await enroll();
  const row = t.db.prepare('SELECT totp_secret FROM users WHERE email = ?').get(a.email); assert.ok(!row.totp_secret.includes(a.secret));
  const c = t.client(); const login = await c.post('/api/auth/login', { email: a.email, password: a.password });
  assert.equal(login.status, 200); assert.equal(login.json.twofa, true); assert.ok(login.json.ticket); assert.equal(login.json.user, undefined);
  assert.equal((await c.get('/api/auth/me')).json.user, null, 'no session yet');
  assert.equal((await c.get('/api/admin/stats')).status, 401);
  assert.equal((await c.post('/api/auth/2fa/verify', { ticket: 'garbage', code: '123456' })).status, 401);
  const ok = await c.post('/api/auth/2fa/verify', { ticket: login.json.ticket, code: totpAt(a.secret, Date.now() + 30000) });
  assert.equal(ok.status, 200); assert.equal(ok.json.user.twofa, true); assert.equal((await c.get('/api/admin/stats')).status, 200);

  // the same code cannot be used for a second sign-in
  const l2 = (await t.client().post('/api/auth/login', { email: a.email, password: a.password })).json;
  assert.equal((await t.client().post('/api/auth/2fa/verify', { ticket: l2.ticket, code: totpAt(a.secret, Date.now() + 30000) })).status, 401, 'replay');
  // a recovery code works once
  const l3 = (await t.client().post('/api/auth/login', { email: a.email, password: a.password })).json;
  assert.equal((await t.client().post('/api/auth/2fa/verify', { ticket: l3.ticket, code: a.codes[0] })).status, 200);
  const l4 = (await t.client().post('/api/auth/login', { email: a.email, password: a.password })).json;
  assert.equal((await t.client().post('/api/auth/2fa/verify', { ticket: l4.ticket, code: a.codes[0] })).status, 401, 'recovery code reuse');
  // five wrong codes kill the ticket, even a right code afterwards
  for (let i = 0; i < 5; i++) await t.client().post('/api/auth/2fa/verify', { ticket: l4.ticket, code: '111111' });
  assert.equal((await t.client().post('/api/auth/2fa/verify', { ticket: l4.ticket, code: a.codes[1] })).status, 401);
});

test('a sign-in ticket is not a session, and a session token is not a ticket', async () => {
  const a = await enroll('admin3@test.com');
  const l = (await t.client().post('/api/auth/login', { email: a.email, password: a.password })).json;
  const c = t.client(); c.cookie = `yp_session=${l.ticket}`; assert.equal((await c.get('/api/auth/me')).json.user, null, 'ticket as cookie');
  assert.equal((await t.client().post('/api/auth/2fa/verify', { ticket: a.c.cookie.split('=')[1], code: totpAt(a.secret, Date.now() + 30000) })).status, 401, 'session as ticket');
});

test('turning it off needs password and a valid code; admin2fa=required gates the admin API until it is on', async () => {
  const a = await enroll('admin4@test.com');
  assert.equal((await a.c.post('/api/auth/2fa/disable', { password: 'wrong-password-1', code: totpAt(a.secret, Date.now() + 60000) })).status, 400);
  assert.equal((await a.c.post('/api/auth/2fa/disable', { password: a.password, code: '000000' })).status, 400);
  assert.equal((await a.c.post('/api/auth/2fa/disable', { password: a.password, code: a.codes[2] })).status, 200);
  assert.equal(t.db.prepare('SELECT totp_enabled e FROM users WHERE email = ?').get(a.email).e, 0);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)').get(a.email).n, 0);

  t.config.admin2fa = true;
  try {
    const me = (await a.c.get('/api/auth/me')).json.user; assert.equal(me.twofaRequired, true);
    const r = await a.c.get('/api/admin/stats'); assert.equal(r.status, 403); assert.equal(r.json.code, '2fa_required');
    assert.equal((await a.c.post('/api/auth/2fa/setup', { password: a.password })).status, 200, 'can still set it up');
  } finally { t.config.admin2fa = false; }
});

test('ordinary viewers can use it too, and a Google-only account sets up without a password', async () => {
  const u = await signedUpUser(t, 'viewer2fa@example.com');
  assert.equal((await u.post('/api/auth/2fa/setup', { password: 'wrong' })).status, 400);
  assert.equal((await u.post('/api/auth/2fa/setup', { password: 'password-12345' })).status, 200);
  assert.equal((await t.client().post('/api/auth/2fa/setup', {})).status, 401);
});
