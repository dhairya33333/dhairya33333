// Shared test harness. Each test file runs in its own process, so it gets its own temp DATA_DIR and fresh config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

export async function boot(env = {}) {
  process.env.NODE_ENV = 'test';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-test-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir, JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
    SITE_URL: 'http://localhost', MIN_FREE_BYTES: '1024', RATE_LIMIT_AUTH: '10000', RATE_LIMIT_PAYMENTS: '10000', HLS_SEGMENT_SECONDS: '6', ...env,
  });
  const cfg = await import('../server/config.js');
  const dbm = await import('../server/db.js');
  const appm = await import('../server/app.js');
  const authm = await import('../server/auth.js');
  appm.runStartupTasks();
  const server = appm.createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, dataDir, config: cfg.config, dirs: cfg.dirs, db: dbm.db, auth: authm,
    close: () => new Promise((r) => server.close(r)),
    client: () => new Client(base),
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, { body, headers = {}, raw } = {}) {
    const res = await fetch(this.base + url, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined && raw === undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      if (pair.slice(0, i) === 'yp_session') this.cookie = pair.slice(i + 1) ? pair : '';
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, body, o) { return this.req('POST', u, { body, ...o }); }
  put(u, body, o) { return this.req('PUT', u, { body, ...o }); }
  del(u, o) { return this.req('DELETE', u, o); }
}

export function makeAdmin(t, email = 'admin@test.com', password = 'admin-password-123') {
  const { db, auth } = t;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { email, password };
  db.prepare("INSERT INTO users (name, email, password_hash, role, email_verified) VALUES ('Admin', ?, ?, 'admin', 1)").run(email, auth.hashPassword(password));
  return { email, password };
}
export async function signedInAdmin(t) {
  const a = makeAdmin(t); const c = t.client();
  await c.post('/api/auth/login', a);
  return c;
}
export async function signedUpUser(t, email, name = 'Viewer') {
  const c = t.client();
  const r = await c.post('/api/auth/register', { name, email, password: 'password-12345' });
  if (r.status !== 200) throw new Error('register failed ' + r.text);
  return c;
}

export function makeVideo(file, seconds = 30, { size = '640x360', audio = true } = {}) {
  const args = ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24`];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100');
  args.push('-t', String(seconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast');
  if (audio) args.push('-c:a', 'aac');
  args.push(file);
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  return file;
}

export function ffprobeJson(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(r.stdout.toString());
}

export async function waitFor(fn, { timeout = 60000, interval = 250, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Uploads a file through the real chunked admin API and waits for the encode to finish. Returns the movie id. */
export async function uploadAndEncode(t, admin, file, { title = 'Test Film', previewMinutes = 0.3, chunk = 1024 * 1024 } = {}) {
  const created = await admin.post('/api/admin/movies', { title, price_rupees: 299, preview_minutes: previewMinutes });
  const movieId = created.json.id;
  const size = fs.statSync(file).size;
  const init = await admin.post(`/api/admin/movies/${movieId}/uploads`, { filename: path.basename(file), size });
  if (init.status !== 200) throw new Error('init failed: ' + init.text);
  const uid = init.json.upload.id;
  const fd = fs.openSync(file, 'r');
  for (let off = 0; off < size; off += chunk) {
    const len = Math.min(chunk, size - off); const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, off);
    const r = await admin.req('PUT', `/api/admin/uploads/${uid}/chunk?offset=${off}`, { raw: buf, headers: { 'content-type': 'application/octet-stream' } });
    if (r.status !== 200) throw new Error('chunk failed: ' + r.text);
  }
  fs.closeSync(fd);
  const done = await admin.post(`/api/admin/uploads/${uid}/complete`);
  if (done.status !== 200) throw new Error('complete failed: ' + done.text);
  await waitFor(() => t.db.prepare('SELECT status FROM movies WHERE id = ?').get(movieId).status === 'ready', { label: 'encode', timeout: 120000 });
  return { movieId, uid };
}
