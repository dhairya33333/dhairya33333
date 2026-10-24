import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedUpUser } from './helpers.js';

let t;
before(async () => { t = await boot({ RATE_LIMIT_AUTH: '5' }); });
after(async () => { await t.close(); });

test('repeated failed logins are rate limited', async () => {
  await signedUpUser(t, 'rl@example.com');
  const c = t.client(); const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await c.post('/api/auth/login', { email: 'rl@example.com', password: 'wrong-wrong' })).status);
  assert.ok(codes.includes(429), `expected a 429 in ${codes}`);
  assert.equal(codes[0], 401);
  assert.equal((await c.post('/api/auth/login', { email: 'rl@example.com', password: 'password-12345' })).status, 429, 'even the right password is held back while limited');
});

test('Google sign-in endpoint is rate limited too', async () => {
  const c = t.client(); const codes = [];
  for (let i = 0; i < 20; i++) codes.push((await c.post('/api/auth/google', { credential: 'x'.repeat(30) })).status);
  assert.ok(codes.includes(429));
});
