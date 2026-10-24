// Uploads N GB of dummy data through the REAL chunked-upload API into a throw-away server and reports
// server memory, throughput and disk use. Proves the server never holds the file in RAM.
//   SIZE_GB=10.8 node scripts/measure-upload.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const SIZE = Math.round(Number(process.env.SIZE_GB || 1) * 1024 ** 3);
const dir = fs.mkdtempSync(path.join(process.env.MEASURE_TMP || os.tmpdir(), 'yp-upload-'));
const port = 24000 + Math.floor(Math.random() * 5000), base = `http://127.0.0.1:${port}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: dir, PORT: String(port), JWT_SECRET: 'x'.repeat(40), RATE_LIMIT_AUTH: '100000', RATE_LIMIT_API: '1000000', MAX_UPLOAD_BYTES: String(20 * 1024 ** 3), MIN_FREE_BYTES: '1073741824' };
spawnSync(process.execPath, ['scripts/create-admin.js', 'A', 'm@admin.com', 'measure-admin-pass-1'], { env });
const server = spawn(process.execPath, ['server/index.js'], { env, stdio: 'ignore' });
const rss = () => { try { const s = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8'); return { now: +/VmRSS:\s+(\d+)/.exec(s)[1] / 1024, peak: +/VmHWM:\s+(\d+)/.exec(s)[1] / 1024 }; } catch { return { now: 0, peak: 0 }; } };
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 150)); }

let cookie = '';
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(typeof body === 'string' || body === undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : body });
  const sc = res.headers.getSetCookie?.()[0]; if (sc) cookie = sc.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
await call('POST', '/api/auth/login', JSON.stringify({ email: 'm@admin.com', password: 'measure-admin-pass-1' }));
const movie = (await call('POST', '/api/admin/movies', JSON.stringify({ title: 'Measure' }))).json.id;
const init = await call('POST', `/api/admin/movies/${movie}/uploads`, JSON.stringify({ filename: 'measure.mp4', size: SIZE }));
if (init.status !== 200) { console.error('init refused:', init.json); server.kill('SIGKILL'); process.exit(1); }
const { id, } = init.json.upload, chunkBytes = init.json.chunkBytes;
const chunk = crypto.randomBytes(chunkBytes);                              // one random chunk reused: content does not matter, bytes on disk do
const samples = []; const t0 = Date.now();
for (let off = 0; off < SIZE; off += chunkBytes) {
  const len = Math.min(chunkBytes, SIZE - off); const body = len === chunkBytes ? chunk : chunk.subarray(0, len);
  const r = await call('PUT', `/api/admin/uploads/${id}/chunk?offset=${off}`, body, { 'content-type': 'application/octet-stream', 'x-chunk-sha256': crypto.createHash('sha256').update(body).digest('hex') });
  if (r.status !== 200) { console.error('chunk failed', off, r.status, r.json); server.kill('SIGKILL'); process.exit(1); }
  if (samples.length === 0 || (off / chunkBytes) % 20 === 0) samples.push(rss().now);
}
const secs = (Date.now() - t0) / 1000;
const partSize = fs.statSync(path.join(dir, 'private', 'tmp', `${id}.part`)).size;
const done = await call('POST', `/api/admin/uploads/${id}/complete`);          // dummy bytes are not a video: expected 422, file kept
const r = rss();
console.log(JSON.stringify({
  uploaded_gb: +(SIZE / 1024 ** 3).toFixed(2), file_on_disk_matches: partSize === SIZE, seconds: +secs.toFixed(1), mb_per_s: Math.round(SIZE / 1048576 / secs),
  server_rss_mb: { at_start: Math.round(samples[0]), min_during: Math.round(Math.min(...samples)), max_during: Math.round(Math.max(...samples)), peak_ever: Math.round(r.peak) },
  complete_response: `${done.status} ${done.json.error || ''}`.trim(), chunk_mb: chunkBytes / 1048576,
}, null, 2));
server.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true });
