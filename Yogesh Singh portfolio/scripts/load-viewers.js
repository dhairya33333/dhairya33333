// Controlled viewer load against a throw-away server: N virtual viewers each stream a film's HLS segments at real-time pace
// (one 6 s segment per 6 s after a short initial burst) as a signed-in PURCHASER (database entitlement check on every request).
// This measures what THIS SERVER can do over loopback (CPU, memory, latency, errors). It does NOT measure internet bandwidth.
//   node scripts/load-viewers.js <hls-dir-with-index.m3u8> [viewers,viewers,...] [seconds]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const hlsSrc = process.argv[2]; const levels = (process.argv[3] || '10,50,100').split(',').map(Number); const SECONDS = Number(process.argv[4] || 30);
if (!hlsSrc || !fs.existsSync(path.join(hlsSrc, 'index.m3u8'))) { console.error('Usage: node scripts/load-viewers.js <dir containing index.m3u8 + seg_*.ts> [10,50,100] [seconds]'); process.exit(1); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-load-'));
const port = 25000 + Math.floor(Math.random() * 4000), base = `http://127.0.0.1:${port}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: dir, PORT: String(port), JWT_SECRET: 'x'.repeat(40), RATE_LIMIT_AUTH: '100000', RATE_LIMIT_API: '10000000' };
spawnSync(process.execPath, ['scripts/create-admin.js', 'A', 'l@admin.com', 'load-admin-pass-1'], { env });
const server = spawn(process.execPath, ['server/index.js'], { env, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 150)); }

const jar = {}; const call = async (who, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie?.()[0]; if (sc) jar[who] = sc.split(';')[0]; return res;
};
await call('a', 'POST', '/api/auth/login', { email: 'l@admin.com', password: 'load-admin-pass-1' });
const mid = (await (await call('a', 'POST', '/api/admin/movies', { title: 'Load' })).json()).id;
fs.cpSync(hlsSrc, path.join(dir, 'private', 'media', String(mid)), { recursive: true });
const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path.join(dir, 'portfolio.sqlite'));
db.prepare("UPDATE movies SET status='ready', validated=1, published=1, preview_sec=1800 WHERE id=?").run(mid);
await call('b', 'POST', '/api/auth/register', { name: 'Buyer', email: 'buyer@x.com', password: 'buyer-password-1' });
db.prepare("INSERT INTO purchases (user_id, movie_id) SELECT id, ? FROM users WHERE email='buyer@x.com'").run(mid); db.close();
const names = fs.readFileSync(path.join(hlsSrc, 'index.m3u8'), 'utf8').split('\n').filter((l) => l.endsWith('.ts'));
const segBytes = names.reduce((a, n) => a + fs.statSync(path.join(hlsSrc, n)).size, 0) / names.length;
const durs = [...fs.readFileSync(path.join(hlsSrc, 'index.m3u8'), 'utf8').matchAll(/#EXTINF:([\d.]+)/g)].map((m) => +m[1]); const segSec = durs.reduce((a, b) => a + b, 0) / durs.length;

const proc = () => { const s = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8'), f = fs.readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1].split(' '); return { rss: +/VmRSS:\s+(\d+)/.exec(s)[1] / 1024, ticks: +f[11] + +f[12] }; };
const pct = (a, p) => a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const results = [];
for (const n of levels) {
  const lat = []; let errors = 0, bytes = 0, requests = 0; const start = Date.now(), p0 = proc();
  let peak = p0.rss; const mon = setInterval(() => { peak = Math.max(peak, proc().rss); }, 250);
  await Promise.all(Array.from({ length: n }, async (_, v) => {
    await new Promise((r) => setTimeout(r, (v / n) * segSec * 1000));            // viewers start spread across one segment length
    let i = Math.floor(Math.random() * 20), fetched = 0;
    const pl = await call('b', 'GET', `/media/${mid}/full.m3u8`); if (!pl.ok) { errors++; return; } await pl.text();
    while ((Date.now() - start) / 1000 < SECONDS) {
      const t = performance.now();
      try {
        const res = await fetch(`${base}/media/${mid}/${names[i % names.length]}`, { headers: { cookie: jar.b } });
        const buf = await res.arrayBuffer(); requests++; if (!res.ok) errors++; else { bytes += buf.byteLength; lat.push(performance.now() - t); }
      } catch { errors++; }
      i++;
      fetched++;
      // a player fills a small buffer first (3 segments back to back), then fetches one segment per segment-duration
      await new Promise((r) => setTimeout(r, fetched < 3 ? 0 : segSec * 1000));
    }
  }));
  clearInterval(mon);
  const p1 = proc(), wall = (Date.now() - start) / 1000;
  results.push({ viewers: n, seconds: Math.round(wall), requests, errors, avg_mbps_delivered: +((bytes * 8) / wall / 1e6).toFixed(1),
    per_viewer_mbps_needed: +((segBytes * 8) / segSec / 1e6).toFixed(2), segment_latency_ms: { p50: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)), p99: Math.round(pct(lat, 0.99)) },
    server_cpu_percent_of_one_core: +(((p1.ticks - p0.ticks) / 100 / wall) * 100).toFixed(1), server_rss_mb_peak: Math.round(peak) });
}
console.log(JSON.stringify({ machine: { cpus: os.cpus().length, ram_mb: Math.round(os.totalmem() / 1048576) }, segment: { seconds: +segSec.toFixed(2), mb: +(segBytes / 1048576).toFixed(2) }, note: 'loopback test: measures server CPU/memory/latency, not internet bandwidth', results }, null, 2));
server.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true });
