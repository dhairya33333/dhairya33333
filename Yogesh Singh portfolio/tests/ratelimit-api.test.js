import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedUpUser } from './helpers.js';

let t;
before(async () => { t = await boot({ RATE_LIMIT_API: '25', RATE_LIMIT_PAYMENTS: '3' }); });
after(async () => { await t.close(); });

test('a global per-IP limit applies to /api, but not to media segment delivery', async () => {
  const c = t.client(); const codes = [];
  for (let i = 0; i < 40; i++) codes.push((await c.get('/api/site')).status);
  assert.ok(codes.includes(429), 'API flooding is limited');
  assert.equal(codes[0], 200);
  // media is outside /api so video delivery (hundreds of segment requests per viewing) is not throttled by it
  const m = [];
  for (let i = 0; i < 40; i++) m.push((await c.get('/media/1/preview.m3u8')).status);
  assert.ok(!m.includes(429));
});
