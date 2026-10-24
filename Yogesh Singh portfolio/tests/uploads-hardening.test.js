import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boot, hasFfmpeg, signedInAdmin, makeAdmin, makeVideo, waitFor } from './helpers.js';

let t, admin, src;
before(async (ctx) => {
  if (!hasFfmpeg) return ctx.skip('ffmpeg not installed');
  t = await boot();
  admin = await signedInAdmin(t);
  src = makeVideo(path.join(t.dataDir, 'v.mp4'), 12);
});
after(async () => { if (t) await t.close(); });

const newMovie = async (title = 'M') => (await admin.post('/api/admin/movies', { title })).json.id;
const chunk = (c, uid, off, buf, headers = {}) => c.req('PUT', `/api/admin/uploads/${uid}/chunk?offset=${off}`, { raw: buf, headers: { 'content-type': 'application/octet-stream', ...headers } });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('chunk checksum: a damaged piece is rejected and not kept; a correct one is accepted', async () => {
  const data = fs.readFileSync(src); const m = await newMovie();
  const uid = (await admin.post(`/api/admin/movies/${m}/uploads`, { filename: 'v.mp4', size: data.length })).json.upload.id;
  const half = data.subarray(0, 4096);
  const bad = await chunk(admin, uid, 0, half, { 'x-chunk-sha256': sha(Buffer.from('something else')) });
  assert.equal(bad.status, 422); assert.equal(bad.json.received, 0);
  assert.equal(fs.statSync(path.join(t.dirs.tmp, `${uid}.part`)).size, 0, 'damaged bytes were rolled back');
  assert.equal((await chunk(admin, uid, 0, half, { 'x-chunk-sha256': 'zz' })).status, 400, 'malformed checksum header');
  const ok = await chunk(admin, uid, 0, half, { 'x-chunk-sha256': sha(half) });
  assert.equal(ok.status, 200); assert.equal(ok.json.received, 4096);
  assert.equal(sha(fs.readFileSync(path.join(t.dirs.tmp, `${uid}.part`))), sha(half));
});

test('an upload belongs to the admin who started it', async () => {
  const data = fs.readFileSync(src); const m = await newMovie();
  const uid = (await admin.post(`/api/admin/movies/${m}/uploads`, { filename: 'v.mp4', size: data.length })).json.upload.id;
  makeAdmin(t, 'second@admin.com', 'second-admin-pass-1');
  const other = t.client(); await other.post('/api/auth/login', { email: 'second@admin.com', password: 'second-admin-pass-1' });
  assert.equal((await other.get(`/api/admin/uploads/${uid}`)).status, 404);
  assert.equal((await chunk(other, uid, 0, data.subarray(0, 100))).status, 404);
  assert.equal((await other.post(`/api/admin/uploads/${uid}/complete`)).status, 404);
  assert.equal((await other.del(`/api/admin/uploads/${uid}`)).status, 404);
  assert.equal((await chunk(admin, uid, 0, data.subarray(0, 100))).status, 200, 'the owner is unaffected');
});

test('only one writer per upload at a time', async () => {
  const m = await newMovie(); const size = 8 * 1024 * 1024;
  const uid = (await admin.post(`/api/admin/movies/${m}/uploads`, { filename: 'v.mp4', size })).json.upload.id;
  const buf = Buffer.alloc(size / 2, 1);
  const results = await Promise.all([chunk(admin, uid, 0, buf), chunk(admin, uid, 0, buf), chunk(admin, uid, 0, buf)]);
  const codes = results.map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one writer wins: ${codes}`);
  assert.equal(fs.statSync(path.join(t.dirs.tmp, `${uid}.part`)).size, size / 2, 'file is exactly one chunk, not interleaved');
});

test('failure text shown to the admin contains no server paths', async () => {
  const m = await newMovie();
  fs.writeFileSync(path.join(t.dirs.incoming, 'broken.mp4'), Buffer.concat([fs.readFileSync(src).subarray(0, 3000), Buffer.alloc(3000, 9)]));
  await admin.post(`/api/admin/movies/${m}/import`, { file: 'broken.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'failed', { timeout: 60000 });
  const row = t.db.prepare('SELECT error FROM movies WHERE id = ?').get(m);
  assert.ok(row.error);
  for (const d of [t.dataDir, t.dirs.incoming, t.dirs.media, t.dirs.source, '/tmp/yp-test']) assert.ok(!row.error.includes(d), `error leaked ${d}: ${row.error}`);
  const listed = await admin.get(`/api/admin/movies/${m}/uploads`);
  assert.ok(!listed.text.includes(t.dataDir));
});

test('disk preflight uses the worst case and refuses when headroom is missing; nothing is deleted', async () => {
  const m = await newMovie(); const keep = t.config.limits.reserveFreeBytes;
  fs.copyFileSync(src, path.join(t.dirs.incoming, 'space.mp4'));
  t.config.limits.reserveFreeBytes = 1e18;
  await admin.post(`/api/admin/movies/${m}/import`, { file: 'space.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'failed', { timeout: 30000 });
  t.config.limits.reserveFreeBytes = keep;
  assert.match(t.db.prepare('SELECT error FROM movies WHERE id = ?').get(m).error, /Not enough free disk space/);
  assert.ok(fs.existsSync(path.join(t.dirs.incoming, 'space.mp4')));
  const { estimateEncode } = await import('../server/storage.js');
  const e = estimateEncode(9000, 10.8 * 1024 ** 3);
  assert.ok(e.worstCaseBytes >= e.estOutputBytes, 'worst case is never below typical');
  assert.ok(e.worstCaseBytes > 3.5 * 1024 ** 3 && e.worstCaseBytes < 5 * 1024 ** 3, `2.5 h at the 3.5 Mb/s cap is about 4 GB, got ${e.worstCaseBytes}`);
});

test('an administrator can cancel a running encode; the original and the live film are untouched', async () => {
  const big = makeVideo(path.join(t.dataDir, 'long.mp4'), 240, { size: '1920x1080' });
  const m = await newMovie('Cancelme');
  fs.copyFileSync(big, path.join(t.dirs.incoming, 'long.mp4'));
  await admin.post(`/api/admin/movies/${m}/import`, { file: 'long.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'processing', { timeout: 20000 });
  assert.equal((await admin.post(`/api/admin/movies/${m}/cancel-encode`)).json.was, 'running');
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'failed', { timeout: 20000 });
  assert.match(t.db.prepare('SELECT error FROM movies WHERE id = ?').get(m).error, /Cancelled/);
  assert.ok(fs.existsSync(path.join(t.dirs.incoming, 'long.mp4')));
  assert.ok(!fs.readdirSync(t.dirs.media).some((n) => /tmp-/.test(n)), 'partial output removed');
  assert.equal((await admin.post(`/api/admin/movies/${m}/cancel-encode`)).status, 409, 'nothing left to cancel');
});

test('a stuck encode is killed after the configured time limit', async () => {
  const m = await newMovie('Timeout'); const keep = t.config.encode.timeoutHours;
  fs.copyFileSync(path.join(t.dataDir, 'long.mp4'), path.join(t.dirs.incoming, 'long2.mp4'));
  t.config.encode.timeoutHours = 0.0003;             // about one second
  await admin.post(`/api/admin/movies/${m}/import`, { file: 'long2.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'failed', { timeout: 30000 });
  t.config.encode.timeoutHours = keep;
  assert.match(t.db.prepare('SELECT error FROM movies WHERE id = ?').get(m).error, /exceeded/);
});

test('a queued encode can be cancelled before it starts', async () => {
  const a = await newMovie('Busy'), b = await newMovie('Queued');
  fs.copyFileSync(path.join(t.dataDir, 'long.mp4'), path.join(t.dirs.incoming, 'busy.mp4'));
  fs.copyFileSync(src, path.join(t.dirs.incoming, 'queued.mp4'));
  await admin.post(`/api/admin/movies/${a}/import`, { file: 'busy.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(a).encode_state === 'processing', { timeout: 20000 });
  await admin.post(`/api/admin/movies/${b}/import`, { file: 'queued.mp4' });
  assert.equal(t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(b).encode_state, 'queued');
  assert.equal((await admin.post(`/api/admin/movies/${b}/cancel-encode`)).json.was, 'queued');
  assert.equal(t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(b).encode_state, 'failed');
  await admin.post(`/api/admin/movies/${a}/cancel-encode`);
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(a).encode_state === 'failed', { timeout: 20000 });
});

test('shell metacharacters in names are inert (ffmpeg is spawned with an argument array)', async () => {
  const m = await newMovie('Inject');
  const evil = 'a; touch PWNED && echo $(id) `id`.mp4';
  fs.copyFileSync(src, path.join(t.dirs.incoming, evil));
  const r = await admin.post(`/api/admin/movies/${m}/import`, { file: evil });
  assert.equal(r.status, 200);
  await waitFor(() => t.db.prepare('SELECT status FROM movies WHERE id = ?').get(m).status === 'ready', { timeout: 60000 });
  assert.ok(!fs.existsSync(path.join(process.cwd(), 'PWNED')) && !fs.existsSync(path.join(t.dirs.incoming, 'PWNED')));
});

test('health: /healthz answers without secrets; ffmpeg status is reported to admins', async () => {
  const h = await t.client().get('/healthz');
  assert.deepEqual(h.json, { ok: true });
  assert.equal((await admin.get('/api/admin/stats')).json.ffmpegOk, true);
  assert.equal((await t.client().get('/api/admin/stats')).status, 401);
});

test('originals and private directories are not reachable over HTTP by any path', async () => {
  const name = fs.readdirSync(t.dirs.source)[0] || 'x.mp4';
  const c = t.client();
  for (const u of [`/private/source/${name}`, `/data/private/source/${name}`, `/uploads/../private/source/${name}`, `/uploads/%2e%2e/private/source/${name}`, `/${name}`,
    '/portfolio.sqlite', '/uploads/../portfolio.sqlite', '/incoming/long.mp4', '/media/1/../../private/source', '/.env', '/package.json', '/server/config.js', '/node_modules/express/package.json']) {
    const r = await c.get(u);
    assert.ok([301, 400, 401, 404].includes(r.status) && !/SQLite format|"express"|JWT_SECRET/.test(r.text), `${u} -> ${r.status}`);
  }
});
