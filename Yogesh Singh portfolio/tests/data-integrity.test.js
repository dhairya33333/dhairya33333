import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { boot, hasFfmpeg, signedUpUser, signedInAdmin, makeVideo, waitFor, hmacHex } from './helpers.js';

let t, verifyData;
before(async () => { t = await boot({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }); ({ verifyData } = await import('../scripts/verify-data.js')); });
after(async () => { await t.close(); });

const mode = (p) => fs.statSync(p).mode & 0o777;

test('database and private directories are not readable by other users', () => {
  for (const d of [t.dirs.data, t.dirs.source, t.dirs.media, t.dirs.tmp, t.dirs.backups, t.dirs.uploads]) assert.equal(mode(d) & 0o077, 0, `${d} is ${mode(d).toString(8)}`);
  for (const f of ['portfolio.sqlite', 'portfolio.sqlite-wal', 'portfolio.sqlite-shm']) { const p = path.join(t.dirs.data, f); if (fs.existsSync(p)) assert.equal(mode(p) & 0o077, 0, `${f} is ${mode(p).toString(8)}`); }
  assert.equal(mode(t.dirs.incoming) & 0o007, 0, 'incoming is never world-accessible');
  assert.equal(mode(t.dirs.incoming) & 0o070, 0o070, 'incoming is group read/write/enter so the SFTP user in the service group can drop files');
});

test('SQLite is configured for safe concurrent use (WAL, foreign keys, busy timeout)', () => {
  assert.equal(t.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(t.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(t.db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  assert.ok(t.db.prepare('PRAGMA user_version').get().user_version >= 3);
});

test('constraints block duplicate entitlements, duplicate gateway ids and orphan rows', async () => {
  await signedUpUser(t, 'c@example.com');
  t.db.prepare("INSERT INTO movies (slug, title, status, validated, published) VALUES ('f', 'F', 'ready', 1, 1)").run();
  const u = t.db.prepare("SELECT id FROM users WHERE email='c@example.com'").get().id, m = t.db.prepare("SELECT id FROM movies WHERE slug='f'").get().id;
  t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (?, ?)').run(u, m);
  assert.throws(() => t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (?, ?)').run(u, m), /UNIQUE/);
  const ins = (oid, pid) => t.db.prepare("INSERT INTO orders (order_id, user_id, movie_id, amount_paise, provider, provider_order_id, provider_payment_id) VALUES (?, ?, ?, 100, 'razorpay', ?, ?)").run(oid, u, m, `po_${oid}`, pid);
  ins('o1', 'pay_1');
  assert.throws(() => ins('o2', 'pay_1'), /UNIQUE/, 'one gateway payment cannot belong to two orders');
  assert.throws(() => t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (999, ?)').run(m), /FOREIGN KEY/);
  assert.throws(() => t.db.prepare("INSERT INTO orders (order_id, user_id, movie_id, amount_paise) VALUES ('o3', 999, ?, 1)").run(m), /FOREIGN KEY/);
  assert.throws(() => t.db.prepare("INSERT INTO refunds (provider, refund_id, order_id, amount_paise) VALUES ('razorpay', 'r', 'nope', 1)").run(), /FOREIGN KEY/);
  t.db.prepare('DELETE FROM purchases').run(); t.db.prepare('DELETE FROM orders').run();
});

test('the consistency checker passes on clean data and flags every kind of damage', async () => {
  assert.deepEqual(verifyData(t.db), []);
  const u = t.db.prepare("SELECT id FROM users WHERE email='c@example.com'").get().id, m = t.db.prepare("SELECT id FROM movies WHERE slug='f'").get().id;
  const order = (id, status, extra = '') => t.db.prepare(`INSERT INTO orders (order_id, user_id, movie_id, amount_paise, status, provider, provider_payment_id, paid_at ${extra ? ', refunded_paise' : ''}) VALUES (?, ?, ?, 29900, ?, 'razorpay', ?, datetime('now') ${extra ? ', ' + extra : ''})`).run(id, u, m, status, `p_${id}`);
  order('d1', 'PAID');                                           // paid without entitlement
  assert.match(verifyData(t.db).join('\n'), /paid order without an entitlement/);
  t.db.prepare("INSERT INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, 'd1')").run(u, m);
  assert.deepEqual(verifyData(t.db), []);
  t.db.prepare("UPDATE orders SET status = 'REFUNDED', refunded_paise = 29900 WHERE order_id = 'd1'").run();
  const out = verifyData(t.db).join('\n');
  assert.match(out, /revoked order still grants access/); assert.match(out, /refunded total differs/);
  t.db.prepare('DELETE FROM purchases').run(); t.db.prepare('DELETE FROM orders').run();
  t.db.prepare("UPDATE movies SET validated = 0 WHERE slug = 'f'").run();
  assert.match(verifyData(t.db).join('\n'), /published film that is not ready and validated/);
  t.db.prepare("UPDATE movies SET validated = 1 WHERE slug = 'f'").run();
  assert.deepEqual(verifyData(t.db), []);
});

test('after a realistic mix of payments, refunds and disputes the data is still consistent', async () => {
  const realFetch = globalThis.fetch; let n = 0; const paymentsDb = {};
  globalThis.fetch = async (u, i) => {
    if (!String(u).startsWith('https://api.razorpay.com')) return realFetch(u, i);
    const p = String(u).replace('https://api.razorpay.com/v1', '');
    if (p === '/orders') return new Response(JSON.stringify({ id: `order_I${++n}` }));
    const m = /^\/payments\/(.+)$/.exec(p); return m && paymentsDb[m[1]] ? new Response(JSON.stringify(paymentsDb[m[1]])) : new Response('{}', { status: 404 });
  };
  const hook = (body) => { const raw = JSON.stringify(body); return t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex('w', raw), 'x-razorpay-event-id': `e${Math.random()}` } }); };
  const m = t.db.prepare("SELECT id FROM movies WHERE slug='f'").get().id;
  try {
    for (let i = 0; i < 6; i++) {
      const c = await signedUpUser(t, `mix${i}@example.com`);
      const o = (await c.post('/api/payments/checkout', { agree: true, movieId: m })).json;
      paymentsDb[`pay_i${i}`] = { id: `pay_i${i}`, order_id: o.razorpayOrderId, status: 'captured', amount: 29900, currency: 'INR' };
      if (i < 5) await hook({ event: 'payment.captured', payload: { payment: { entity: paymentsDb[`pay_i${i}`] } } });
      if (i === 1) await hook({ event: 'refund.processed', payload: { refund: { entity: { id: 'ri1', payment_id: 'pay_i1', amount: 29900 } }, payment: { entity: { id: 'pay_i1', order_id: o.razorpayOrderId } } } });
      if (i === 2) await hook({ event: 'refund.processed', payload: { refund: { entity: { id: 'ri2', payment_id: 'pay_i2', amount: 1000 } }, payment: { entity: { id: 'pay_i2', order_id: o.razorpayOrderId } } } });
      if (i === 3) await hook({ event: 'payment.dispute.lost', payload: { dispute: { entity: { id: 'd', payment_id: 'pay_i3' } }, payment: { entity: { id: 'pay_i3', order_id: o.razorpayOrderId } } } });
    }
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(verifyData(t.db), []);
  const states = t.db.prepare("SELECT status, COUNT(*) c FROM orders GROUP BY status").all().map((r) => `${r.status}:${r.c}`).sort();
  assert.deepEqual(states, ['CREATED:1', 'CHARGEBACK:1', 'PAID:2', 'PARTIALLY_REFUNDED:1', 'REFUNDED:1'].sort());
});

test('RESTORE DRILL: a backup restores into a fresh server where users can sign in and keep their purchases', async (ctx) => {
  const { backupDb } = await import('../scripts/backup-db.js');
  const bk = backupDb({ dir: path.join(t.dataDir, 'bk') });
  assert.equal(bk.ok, true);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-restore-'));
  fs.copyFileSync(bk.file, path.join(fresh, 'portfolio.sqlite'));              // exactly the documented restore step
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.js'], { env: { PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: fresh, PORT: String(port), JWT_SECRET: 'x'.repeat(40) }, stdio: 'ignore' });
  try {
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch { return false; } }, { timeout: 15000, label: 'restored server' });
    const { Client } = await import('./helpers.js');
    const c = new Client(`http://127.0.0.1:${port}`);
    assert.equal((await c.post('/api/auth/login', { email: 'mix0@example.com', password: 'password-12345' })).status, 200, 'password still works after restore');
    const mine = await c.get('/api/my/purchases');
    assert.equal(mine.json.purchases.length, 1, 'purchase survived the restore');
    const site = await c.get('/api/site'); assert.equal(site.status, 200);
  } finally { child.kill('SIGKILL'); }
  const restored = new (await import('node:sqlite')).DatabaseSync(path.join(fresh, 'portfolio.sqlite'));
  assert.deepEqual(verifyData(restored), [], 'restored data is consistent');
  restored.close();
  void ctx;
});

test('CRASH RECOVERY: killing the server mid-encode (SIGKILL) leaves originals intact and recovery works after restart', async (ctx) => {
  if (!hasFfmpeg) return ctx.skip('ffmpeg not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-crash-'));
  const port = 20000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: dir, PORT: String(port), JWT_SECRET: 'x'.repeat(40), RATE_LIMIT_AUTH: '1000', MIN_FREE_BYTES: '1024' };
  assert.equal(spawnSync(process.execPath, ['scripts/create-admin.js', 'A', 'crash@admin.com', 'crash-admin-pass-1'], { env, encoding: 'utf8' }).status, 0);
  const logFd = fs.openSync(path.join(dir, 'server.log'), 'a');
  const start = () => spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', logFd, logFd] });
  const ready = () => waitFor(async () => { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } }, { timeout: 15000, label: 'server' });
  const incoming = path.join(dir, 'incoming'); makeVideo(path.join(incoming, 'long.mp4'), 100, { size: '1280x720' });   // before the server starts: a blocking step must not leave an idle HTTP connection to go stale
  const mark = (m) => fs.appendFileSync(path.join(dir, 'steps.log'), `${Date.now()} ${m}\n`);
  mark('start'); let child = start(); await ready(); mark('ready');
  const { Client } = await import('./helpers.js');
  const c = new Client(base); await c.post('/api/auth/login', { email: 'crash@admin.com', password: 'crash-admin-pass-1' });
  mark('video made'); const mid = (await c.post('/api/admin/movies', { title: 'Crash' })).json.id; mark('movie created');
  await c.post(`/api/admin/movies/${mid}/import`, { file: 'long.mp4' });
  await waitFor(async () => (await c.get('/api/admin/movies')).json.movies[0].encode_state === 'processing', { timeout: 20000, label: 'encoding' });
  mark('processing seen'); child.kill('SIGKILL');                                                          // power-cut style stop, no cleanup possible
  await new Promise((r) => setTimeout(r, 500));
  const ffmpegsFor = () => spawnSync('pgrep', ['-f', `^ffmpeg .*${dir}`], { encoding: 'utf8' }).stdout.trim();
  assert.notEqual(ffmpegsFor(), '', 'precondition: the crash really left an orphaned ffmpeg running');
  assert.ok(fs.existsSync(path.join(incoming, 'long.mp4')), 'original survived the crash');
  mark('killed'); child = start(); await ready(); mark('restarted');
  try {
    const c2 = new Client(base); await c2.post('/api/auth/login', { email: 'crash@admin.com', password: 'crash-admin-pass-1' });
    const m = (await c2.get('/api/admin/movies')).json.movies[0];
    assert.equal(m.encode_state, 'failed'); assert.match(m.error, /restart/);
    assert.ok(!fs.readdirSync(path.join(dir, 'private', 'media')).some((n) => /tmp-/.test(n)), 'half-written output removed on start-up');
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(ffmpegsFor(), '', 'the orphaned encoder was stopped at start-up');
    assert.equal((await c2.post(`/api/admin/movies/${mid}/reprocess`)).status, 200, 'processing can simply be started again');
    await c2.post(`/api/admin/movies/${mid}/cancel-encode`);
  } finally { child.kill('SIGKILL'); spawnSync('pkill', ['-f', `${dir}/private/media`]); }
});
