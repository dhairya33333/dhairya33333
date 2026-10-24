import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, hasFfmpeg, signedInAdmin, signedUpUser, makeVideo, uploadAndEncode, waitFor } from './helpers.js';

let t, admin, src, readyMovie;

before(async (ctx) => {
  if (!hasFfmpeg) return ctx.skip('ffmpeg not installed');
  t = await boot();
  admin = await signedInAdmin(t);
  src = makeVideo(path.join(t.dataDir, 'good.mp4'), 18);
  ({ movieId: readyMovie } = await uploadAndEncode(t, admin, src, { title: 'Ready Film', previewMinutes: 0.2 }));
});
after(async () => { if (t) await t.close(); });

const newMovie = async (title = 'M') => (await admin.post('/api/admin/movies', { title })).json.id;
const initUpload = (movie, body) => admin.post(`/api/admin/movies/${movie}/uploads`, body);
const chunk = (uid, offset, buf) => admin.req('PUT', `/api/admin/uploads/${uid}/chunk?offset=${offset}`, { raw: buf, headers: { 'content-type': 'application/octet-stream' } });

test('upload endpoints are admin-only', async () => {
  const user = await signedUpUser(t, 'viewer@example.com');
  assert.equal((await user.post(`/api/admin/movies/${readyMovie}/uploads`, { filename: 'a.mp4', size: 10 })).status, 403);
  assert.equal((await t.client().post(`/api/admin/movies/${readyMovie}/uploads`, { filename: 'a.mp4', size: 10 })).status, 401);
  assert.equal((await user.req('PUT', '/api/admin/uploads/aaaaaaaaaaaaaaaa/chunk?offset=0', { raw: Buffer.from('x') })).status, 403);
});

test('init rejects wrong types, missing/oversized files and a full disk with clear messages', async () => {
  const m = await newMovie();
  let r = await initUpload(m, { filename: 'virus.exe', size: 100 });
  assert.equal(r.status, 400); assert.match(r.json.error, /Unsupported file type/);
  r = await initUpload(m, { filename: 'a.mp4' });
  assert.equal(r.status, 400);
  r = await initUpload(m, { filename: 'a.mp4', size: -5 });
  assert.equal(r.status, 400);

  const oldMax = t.config.limits.maxUploadBytes; t.config.limits.maxUploadBytes = 1000;
  r = await initUpload(m, { filename: 'big.mp4', size: 5000 });
  assert.equal(r.status, 413); assert.match(r.json.error, /upload limit/);
  t.config.limits.maxUploadBytes = oldMax;

  const oldReserve = t.config.limits.reserveFreeBytes; t.config.limits.reserveFreeBytes = 1e18;
  r = await initUpload(m, { filename: 'a.mp4', size: 1000 });
  assert.equal(r.status, 507); assert.match(r.json.error, /Not enough disk space/);
  t.config.limits.reserveFreeBytes = oldReserve;

  assert.equal((await initUpload(999999, { filename: 'a.mp4', size: 10 })).status, 404);
});

test('the default limit comfortably allows the expected 10.8 GB original', () => {
  assert.ok(t.config.limits.maxUploadBytes >= 10.8 * 1024 ** 3);
});

test('hostile filenames never influence where bytes are stored', async () => {
  const m = await newMovie();
  const r = await initUpload(m, { filename: '../../../etc/cron.d/evil.mp4', size: 4 });
  assert.equal(r.status, 200);
  assert.equal(r.json.upload.name, 'evil.mp4');
  const row = t.db.prepare('SELECT path FROM uploads WHERE id = ?').get(r.json.upload.id);
  assert.ok(row.path.startsWith(t.dirs.tmp + path.sep) && /\.part$/.test(row.path));
  assert.ok(!fs.existsSync('/etc/cron.d/evil.mp4'));
  assert.equal((await admin.get('/api/admin/uploads/..%2f..%2fsecret')).status, 404, 'upload ids are validated');
});

test('chunks are order-checked, resumable, and interrupted/oversized chunks are rejected', async () => {
  const m = await newMovie();
  const data = fs.readFileSync(src); const size = data.length;
  const init = await initUpload(m, { filename: 'good.mp4', size });
  const uid = init.json.upload.id; const half = Math.floor(size / 2);

  assert.equal((await chunk(uid, 5, data.subarray(0, 100))).status, 409, 'must start at offset 0');
  assert.equal((await chunk(uid, 0, data.subarray(0, half))).status, 200);
  const stale = await chunk(uid, 0, data.subarray(0, half));
  assert.equal(stale.status, 409); assert.equal(stale.json.received, half, 'server tells the client where to resume');
  assert.equal((await chunk(uid, half, Buffer.alloc(size))).status, 400, 'a chunk past the declared size is refused');
  assert.equal((await admin.post(`/api/admin/uploads/${uid}/complete`)).status, 400, 'incomplete upload cannot be completed');
  assert.equal((await admin.get(`/api/admin/uploads/${uid}`)).json.upload.received, half, 'progress survives (resume after reload)');

  assert.equal((await chunk(uid, half, data.subarray(half))).status, 200);
  const done = await admin.post(`/api/admin/uploads/${uid}/complete`);
  assert.equal(done.status, 200);
  assert.ok(done.json.estimate.estOutputBytes > 0 && done.json.estimate.durationSec > 17, 'size/time estimate returned');
  await waitFor(() => t.db.prepare('SELECT status FROM movies WHERE id = ?').get(m).status === 'ready', { timeout: 60000 });
  assert.equal(t.db.prepare('SELECT status FROM uploads WHERE id = ?').get(uid).status, 'completed');
  assert.ok(!fs.existsSync(path.join(t.dirs.tmp, `${uid}.part`)), 'temp file moved, not left behind');
});

test('cancelling an unfinished upload removes its temp file', async () => {
  const m = await newMovie();
  const uid = (await initUpload(m, { filename: 'x.mp4', size: 50 })).json.upload.id;
  const p = path.join(t.dirs.tmp, `${uid}.part`);
  assert.ok(fs.existsSync(p));
  assert.equal((await admin.del(`/api/admin/uploads/${uid}`)).status, 200);
  assert.ok(!fs.existsSync(p));
  assert.equal(t.db.prepare('SELECT status FROM uploads WHERE id = ?').get(uid).status, 'failed');
});

test('stale partial uploads are cleaned up after the retention period; fresh ones are kept', async () => {
  const { cleanupStaleUploads } = await import('../server/transcode.js');
  const m = await newMovie();
  const old = (await initUpload(m, { filename: 'old.mp4', size: 50 })).json.upload.id;
  const fresh = (await initUpload(m, { filename: 'fresh.mp4', size: 50 })).json.upload.id;
  t.db.prepare("UPDATE uploads SET updated_at = datetime('now', '-30 days') WHERE id = ?").run(old);
  fs.writeFileSync(path.join(t.dirs.tmp, 'orphan.part'), 'x'); fs.utimesSync(path.join(t.dirs.tmp, 'orphan.part'), new Date(Date.now() - 3 * 86400_000), new Date(Date.now() - 3 * 86400_000));
  cleanupStaleUploads();
  assert.ok(!fs.existsSync(path.join(t.dirs.tmp, `${old}.part`)));
  assert.equal(t.db.prepare('SELECT status FROM uploads WHERE id = ?').get(old).status, 'failed');
  assert.ok(fs.existsSync(path.join(t.dirs.tmp, `${fresh}.part`)), 'recent upload stays resumable');
  assert.ok(!fs.existsSync(path.join(t.dirs.tmp, 'orphan.part')), 'orphan with no record removed');
});

test('a file that is not a video is reported clearly, not queued, and kept (never auto-deleted)', async () => {
  const m = await newMovie();
  const junk = Buffer.from('this is definitely not a movie '.repeat(20));
  const uid = (await initUpload(m, { filename: 'fake.mp4', size: junk.length })).json.upload.id;
  assert.equal((await chunk(uid, 0, junk)).status, 200);
  const r = await admin.post(`/api/admin/uploads/${uid}/complete`);
  assert.equal(r.status, 422); assert.match(r.json.error, /not a readable video/);
  assert.equal(t.db.prepare('SELECT status FROM uploads WHERE id = ?').get(uid).status, 'failed');
  assert.equal(t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state, 'idle', 'nothing was queued');
  assert.ok(fs.existsSync(path.join(t.dirs.source, `${uid}.mp4`)), 'the file is still on disk');
});

test('import: traversal, symlinks out of the folder and non-video names are refused', async () => {
  const m = await newMovie();
  fs.writeFileSync(path.join(t.dataDir, 'outside.mp4'), 'x');
  fs.symlinkSync(path.join(t.dataDir, 'outside.mp4'), path.join(t.dirs.incoming, 'link.mp4'));
  for (const file of ['../outside.mp4', '/etc/passwd', 'link.mp4', 'nope.mp4', 'notes.txt', '']) {
    const r = await admin.post(`/api/admin/movies/${m}/import`, { file });
    assert.equal(r.status, 400, `${file} -> ${r.status}`);
  }
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM uploads WHERE movie_id = ?").get(m).c, 0);
  const list = await admin.get('/api/admin/incoming');
  assert.ok(!list.text.includes(t.dataDir), 'server directory is not exposed');
});

test('failed FFmpeg job: movie and upload marked failed, partial output cleaned, original kept, live version still playable', async () => {
  // a previously good film whose source is replaced by something ffprobe accepts but ffmpeg cannot encode is hard to fake,
  // so use a corrupt file in the incoming folder against the already-ready movie
  fs.writeFileSync(path.join(t.dirs.incoming, 'corrupt.mp4'), Buffer.concat([fs.readFileSync(src).subarray(0, 4000), Buffer.alloc(2000, 7)]));
  const before = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(readyMovie);
  const liveFiles = fs.readdirSync(path.join(t.dirs.media, String(readyMovie))).length;
  const r = await admin.post(`/api/admin/movies/${readyMovie}/import`, { file: 'corrupt.mp4' });
  assert.equal(r.status, 200);
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(readyMovie).encode_state === 'failed', { timeout: 60000 });
  const after = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(readyMovie);
  assert.ok(after.error && after.error.length > 0, 'failure reason recorded');
  assert.equal(after.status, 'ready', 'the published film stays available');
  assert.equal(after.validated, 1);
  assert.equal(fs.readdirSync(path.join(t.dirs.media, String(readyMovie))).length, liveFiles, 'live output untouched');
  assert.ok(!fs.readdirSync(t.dirs.media).some((n) => /\.tmp-/.test(n)), 'temp output removed');
  assert.ok(fs.existsSync(path.join(t.dirs.incoming, 'corrupt.mp4')), 'original not deleted');
  assert.equal(t.db.prepare("SELECT status FROM uploads WHERE kind = 'import' ORDER BY created_at DESC LIMIT 1").get().status, 'failed');
  assert.ok(before.progress === 100);
});

test('a first-time encode that fails leaves the film "failed", never published, original kept', async () => {
  const m = await newMovie('Never Encoded');
  fs.writeFileSync(path.join(t.dirs.incoming, 'bad2.mp4'), Buffer.concat([fs.readFileSync(src).subarray(0, 3000), Buffer.alloc(3000, 1)]));
  await admin.post(`/api/admin/movies/${m}/import`, { file: 'bad2.mp4' });
  await waitFor(() => t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state === 'failed', { timeout: 60000 });
  assert.equal(t.db.prepare('SELECT status FROM movies WHERE id = ?').get(m).status, 'failed');
  const pub = await admin.put(`/api/admin/movies/${m}`, { title: 'Never Encoded', published: true });
  assert.equal(pub.status, 400, 'cannot publish an unvalidated film');
  assert.ok(fs.existsSync(path.join(t.dirs.incoming, 'bad2.mp4')));
});

test('output validation catches incomplete HLS (missing segment, no end marker, wrong length, empty segment)', async () => {
  const { validateOutput } = await import('../server/transcode.js');
  const good = path.join(t.dirs.media, String(readyMovie));
  const dur = 18;
  assert.equal((await validateOutput(good, dur)).ok, true);
  const copy = (name) => { const d = path.join(t.dataDir, name); fs.cpSync(good, d, { recursive: true }); return d; };
  let d = copy('v1'); fs.rmSync(path.join(d, 'seg_00001.ts'));
  assert.match((await validateOutput(d, dur)).error, /Missing segment/);
  d = copy('v2'); fs.writeFileSync(path.join(d, 'index.m3u8'), fs.readFileSync(path.join(d, 'index.m3u8'), 'utf8').replace('#EXT-X-ENDLIST', ''));
  assert.match((await validateOutput(d, dur)).error, /end marker/);
  assert.match((await validateOutput(good, 500)).error, /does not match the source/);
  d = copy('v3'); fs.writeFileSync(path.join(d, 'seg_00000.ts'), '');
  assert.match((await validateOutput(d, dur)).error, /Empty segment/);
  d = copy('v4'); fs.writeFileSync(path.join(d, 'seg_00000.ts'), Buffer.alloc(500, 3));
  assert.equal((await validateOutput(d, dur)).ok, false, 'undecodable segment');
});

test('encode concurrency is capped (never more than ENCODE_CONCURRENCY jobs running)', async () => {
  const movies = [await newMovie('c1'), await newMovie('c2'), await newMovie('c3')];
  for (const m of movies) fs.copyFileSync(src, path.join(t.dirs.incoming, `c${m}.mp4`));
  let maxActive = 0;
  const poll = setInterval(() => { maxActive = Math.max(maxActive, t.db.prepare("SELECT COUNT(*) c FROM movies WHERE encode_state = 'processing'").get().c); }, 40);
  for (const m of movies) await admin.post(`/api/admin/movies/${m}/import`, { file: `c${m}.mp4` });
  await waitFor(() => movies.every((m) => t.db.prepare('SELECT status FROM movies WHERE id = ?').get(m).status === 'ready'), { timeout: 120000 });
  clearInterval(poll);
  assert.equal(t.config.encode.concurrency, 1);
  assert.ok(maxActive <= 1, `saw ${maxActive} concurrent encodes`);
});

test('admin API never returns server paths or private fields', async () => {
  const movies = await admin.get('/api/admin/movies');
  assert.ok(!movies.text.includes(t.dataDir), 'no absolute paths');
  assert.ok(!movies.text.includes('source_file'));
  assert.equal(typeof movies.json.movies[0].has_source, 'boolean');
  const up = await admin.get(`/api/admin/movies/${readyMovie}/uploads`);
  assert.ok(!up.text.includes(t.dataDir) && !up.text.includes('"path"'));
  const settings = await admin.get('/api/admin/settings');
  assert.ok(!settings.text.includes('ig_token') || settings.json.instagram.hasToken === false);
  const stats = await admin.get('/api/admin/stats');
  assert.ok(!/KEY|SECRET|JWT/.test(stats.text));
});

test('original is only removed by an explicit, confirmed action after validation; deleting a film never deletes it', async () => {
  const movie = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(readyMovie);
  const file = movie.source_file;
  const hadSource = movie.source_file && fs.existsSync(movie.source_file);
  // the re-process source of this movie is now the corrupt incoming import; use a fresh uploaded one
  const { movieId: m2 } = await uploadAndEncode(t, admin, src, { title: 'Cleanup Film' });
  const row = t.db.prepare('SELECT source_file FROM movies WHERE id = ?').get(m2);
  assert.ok(row.source_file.startsWith(t.dirs.source));
  assert.equal((await admin.post(`/api/admin/movies/${m2}/cleanup-source`, {})).status, 400, 'needs typed confirmation');
  assert.equal((await admin.post(`/api/admin/movies/${m2}/cleanup-source`, { confirm: 'yes' })).status, 400);
  assert.ok(fs.existsSync(row.source_file));
  const del = await admin.del(`/api/admin/movies/${m2}`);
  assert.equal(del.status, 409, 'film delete refuses while the original is on the server');
  assert.ok(fs.existsSync(row.source_file));
  const ok = await admin.post(`/api/admin/movies/${m2}/cleanup-source`, { confirm: 'DELETE' });
  assert.equal(ok.status, 200);
  assert.ok(!fs.existsSync(row.source_file));
  assert.ok(fs.existsSync(path.join(t.dirs.media, String(m2), 'index.m3u8')), 'processed output intact');
  assert.equal((await admin.del(`/api/admin/movies/${m2}`)).status, 200);
  void file; void hadSource;
});

test('a film with paying customers cannot be deleted', async () => {
  const c = await signedUpUser(t, 'customer@example.com');
  const uid = t.db.prepare("SELECT id FROM users WHERE email='customer@example.com'").get().id;
  t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (?, ?)').run(uid, readyMovie);
  assert.equal((await admin.del(`/api/admin/movies/${readyMovie}`)).status, 409);
  void c;
});

test('storage accounting reports every bucket and free space', async () => {
  const r = await admin.get('/api/admin/storage');
  assert.equal(r.status, 200);
  for (const k of ['originals_uploaded', 'originals_incoming', 'processed_hls', 'posters_and_images', 'partial_uploads', 'backups']) assert.ok(k in r.json.parts_gb, k);
  assert.ok(r.json.free_gb > 0 && r.json.total_gb >= r.json.free_gb);
});

test('restart recovery: interrupted encodes become failed with originals untouched', async () => {
  const { recoverInterrupted } = await import('../server/transcode.js');
  const m = await newMovie('Interrupted');
  t.db.prepare("UPDATE movies SET encode_state = 'processing' WHERE id = ?").run(m);
  fs.mkdirSync(path.join(t.dirs.media, `${m}.tmp-dead`), { recursive: true });
  recoverInterrupted();
  assert.equal(t.db.prepare('SELECT encode_state FROM movies WHERE id = ?').get(m).encode_state, 'failed');
  assert.ok(!fs.existsSync(path.join(t.dirs.media, `${m}.tmp-dead`)));
});

test('new film defaults (Rs 299, 30 min free) apply when blank; fractional minutes survive an edit round-trip', async () => {
  const id = (await admin.post('/api/admin/movies', { title: 'Defaults' })).json.id;
  let m = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(id);
  assert.equal(m.price_paise, 29900); assert.equal(m.preview_sec, 1800);
  await admin.put(`/api/admin/movies/${id}`, { title: 'Defaults', price_rupees: '499.50', preview_minutes: '0.2' });
  m = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(id);
  assert.equal(m.price_paise, 49950); assert.equal(m.preview_sec, 12);
  const list = (await admin.get('/api/admin/movies')).json.movies.find((x) => x.id === id);
  assert.equal(+(list.preview_sec / 60).toFixed(2), 0.2);
});
