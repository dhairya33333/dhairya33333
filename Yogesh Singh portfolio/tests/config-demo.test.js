import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode = (extra) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-cfg-'));
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', SITE_URL: 'https://preview.example.test', JWT_SECRET: 'x'.repeat(40), DATA_DIR: dir, ...extra };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const { config } = await import('./server/config.js'); console.log(config.paymentsMode);"], { env, encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') });
  return r.stdout.trim();
};

test('production without payment keys is "unconfigured" unless demo is explicitly allowed (client previews only)', () => {
  assert.equal(mode({}), 'unconfigured');
  assert.equal(mode({ ALLOW_DEMO_PAYMENTS: 'false' }), 'unconfigured');
  assert.equal(mode({ ALLOW_DEMO_PAYMENTS: 'true' }), 'demo');
});

test('real gateway keys always win over the demo switch', () => {
  assert.equal(mode({ ALLOW_DEMO_PAYMENTS: 'true', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'y', RAZORPAY_WEBHOOK_SECRET: 'z' }), 'razorpay');
});
