import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, allSettings, setSetting, getSetting } from '../db.js';
import { dirs, config } from '../config.js';
import { requireAdmin, asyncHandler, hashPassword } from '../auth.js';
import { enqueueTranscode, hlsDir } from '../transcode.js';
import { syncInstagram } from '../instagram.js';
import { SITE_DEFAULTS, EDITABLE_KEYS } from '../defaults.js';

const r = Router();
r.use(requireAdmin);

const rand = () => crypto.randomBytes(8).toString('hex');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'film';
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const imageUpload = multer({
  storage: multer.diskStorage({ destination: dirs.uploads, filename: (_q, f, cb) => cb(null, rand() + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, /\.(jpe?g|png|webp|avif|mp4|webm)$/i.test(f.originalname)),
});
const videoUpload = multer({
  storage: multer.diskStorage({ destination: dirs.source, filename: (_q, f, cb) => cb(null, rand() + path.extname(f.originalname).toLowerCase()) }),
  fileFilter: (_q, f, cb) => cb(null, /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(f.originalname)),
});

const unlink = (rel) => { if (rel?.startsWith('/uploads/')) fs.rm(path.join(dirs.uploads, path.basename(rel)), () => {}); };

// ---------- Dashboard ----------
r.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    revenue_paise: one("SELECT COALESCE(SUM(amount_paise),0) v FROM orders WHERE status='PAID'").v,
    orders_paid: one("SELECT COUNT(*) v FROM orders WHERE status='PAID'").v,
    users: one("SELECT COUNT(*) v FROM users WHERE role='user'").v,
    movies: one('SELECT COUNT(*) v FROM movies').v,
    recent: db.prepare(`SELECT o.order_id, o.amount_paise, o.paid_at, u.name, m.title FROM orders o JOIN users u ON u.id=o.user_id JOIN movies m ON m.id=o.movie_id WHERE o.status='PAID' ORDER BY o.paid_at DESC LIMIT 8`).all(),
    paymentsMode: config.paymentsMode,
  });
});

// ---------- Movies ----------
const movieFields = (b) => ({
  title: String(b.title || '').trim().slice(0, 120),
  tagline: String(b.tagline || '').trim().slice(0, 200),
  description: String(b.description || '').trim().slice(0, 4000),
  year: String(b.year || '').trim().slice(0, 10),
  price_paise: Math.max(100, Math.round(Number(b.price_rupees) * 100) || 0),
  preview_sec: Math.max(0, Math.round(Number(b.preview_minutes) * 60)),
  published: b.published ? 1 : 0,
  featured: b.featured ? 1 : 0,
});

r.get('/movies', (_req, res) => res.json({ movies: db.prepare('SELECT * FROM movies ORDER BY id DESC').all() }));

r.post('/movies', (req, res) => {
  const f = movieFields(req.body);
  if (!f.title) return bad(res, 'Title is required.');
  let slug = slugify(f.title);
  while (db.prepare('SELECT 1 FROM movies WHERE slug = ?').get(slug)) slug += '-' + rand().slice(0, 3);
  const { lastInsertRowid } = db.prepare('INSERT INTO movies (slug, title, tagline, description, year, price_paise, preview_sec, published, featured) VALUES (?,?,?,?,?,?,?,0,0)')
    .run(slug, f.title, f.tagline, f.description, f.year, f.price_paise || 29900, f.preview_sec || 1800);
  res.json({ id: Number(lastInsertRowid) });
});

r.put('/movies/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  const f = movieFields({ ...{ price_rupees: m.price_paise / 100, preview_minutes: m.preview_sec / 60 }, ...req.body });
  if (!f.title) return bad(res, 'Title is required.');
  if (f.published && m.status !== 'ready') return bad(res, 'Upload and process the film before publishing it.');
  db.exec('BEGIN');
  if (f.featured) db.prepare('UPDATE movies SET featured = 0').run();
  db.prepare('UPDATE movies SET title=?, tagline=?, description=?, year=?, price_paise=?, preview_sec=?, published=?, featured=? WHERE id=?')
    .run(f.title, f.tagline, f.description, f.year, f.price_paise, f.preview_sec, f.published, f.featured, m.id);
  db.exec('COMMIT');
  res.json({ ok: true });
});

for (const kind of ['poster', 'trailer']) {
  r.post(`/movies/:id/${kind}`, imageUpload.single('file'), (req, res) => {
    const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
    if (!m || !req.file) return bad(res, 'Choose an image (jpg, png, webp) or, for a trailer, mp4/webm.');
    unlink(m[kind]);
    const rel = '/uploads/' + req.file.filename;
    db.prepare(`UPDATE movies SET ${kind} = ? WHERE id = ?`).run(rel, m.id);
    res.json({ url: rel });
  });
}

r.post('/movies/:id/video', videoUpload.single('file'), (req, res) => {
  const m = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m || !req.file) return bad(res, 'Choose a video file (mp4, mov, mkv…).');
  enqueueTranscode(m.id, req.file.path);
  res.json({ ok: true });
});

r.get('/incoming', (_req, res) => {
  const files = fs.readdirSync(dirs.incoming).filter((f) => /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(f))
    .map((f) => ({ name: f, size: fs.statSync(path.join(dirs.incoming, f)).size }));
  res.json({ dir: dirs.incoming, files });
});

r.post('/movies/:id/import', (req, res) => {
  const m = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.params.id));
  const file = path.join(dirs.incoming, path.basename(String(req.body.file || '')));
  if (!m || !fs.existsSync(file)) return bad(res, 'File not found in the incoming folder.');
  enqueueTranscode(m.id, file);
  res.json({ ok: true });
});

r.post('/movies/:id/reprocess', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m?.source_file || !fs.existsSync(m.source_file)) return bad(res, 'The original file is no longer on the server. Upload it again.');
  enqueueTranscode(m.id, m.source_file);
  res.json({ ok: true });
});

r.delete('/movies/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  if (db.prepare('SELECT 1 FROM purchases WHERE movie_id = ? LIMIT 1').get(m.id)) return bad(res, 'This film has buyers. Unpublish it instead of deleting.');
  db.prepare('DELETE FROM orders WHERE movie_id = ?').run(m.id);
  db.prepare('DELETE FROM movies WHERE id = ?').run(m.id);
  unlink(m.poster); unlink(m.trailer);
  fs.rmSync(hlsDir(m.id), { recursive: true, force: true });
  if (m.source_file?.startsWith(dirs.source)) fs.rm(m.source_file, () => {});
  res.json({ ok: true });
});

// ---------- Orders / users ----------
r.get('/orders', (_req, res) => res.json({ orders: db.prepare(`SELECT o.order_id, o.amount_paise, o.status, o.gateway, o.created_at, o.paid_at, u.name, u.email, m.title FROM orders o JOIN users u ON u.id=o.user_id JOIN movies m ON m.id=o.movie_id ORDER BY o.id DESC LIMIT 300`).all() }));

r.get('/users', (_req, res) => res.json({
  users: db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, (SELECT COUNT(*) FROM purchases p WHERE p.user_id=u.id) purchases FROM users u ORDER BY u.id DESC LIMIT 500`).all(),
}));

r.post('/grant', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const m = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.body.movieId));
  if (!u) return bad(res, 'No user with that email. They must sign up first.');
  if (!m) return bad(res, 'Choose a film.');
  db.prepare('INSERT OR IGNORE INTO purchases (user_id, movie_id, order_id) VALUES (?, ?, NULL)').run(u.id, m.id);
  res.json({ ok: true });
});

r.post('/users/:id/role', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 'You cannot change your own role.');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role === 'admin' ? 'admin' : 'user', id);
  res.json({ ok: true });
});

r.post('/password', (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 10) return bad(res, 'Use at least 10 characters for the admin password.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), req.user.id);
  res.json({ ok: true });
});

// ---------- Site content ----------
r.get('/settings', (_req, res) => {
  const s = { ...SITE_DEFAULTS, ...allSettings() };
  res.json({
    settings: Object.fromEntries(EDITABLE_KEYS.map((k) => [k, s[k]])),
    instagram: { user_id: s.ig_user_id || '', hasToken: !!s.ig_token, status: s.ig_last_status || 'Never synced' },
  });
});

r.put('/settings', (req, res) => {
  for (const k of EDITABLE_KEYS) if (k in req.body) setSetting(k, String(req.body[k]).slice(0, 8000));
  res.json({ ok: true });
});

// ---------- Works (timeline) ----------
const workFields = (b) => ({
  kind: ['career', 'film', 'talk', 'honour'].includes(b.kind) ? b.kind : 'career',
  title: String(b.title || '').trim().slice(0, 160),
  subtitle: String(b.subtitle || '').trim().slice(0, 400),
  period: String(b.period || '').trim().slice(0, 40),
  sort: Number(b.sort) || 0,
});
r.get('/works', (_req, res) => res.json({ works: db.prepare('SELECT * FROM works ORDER BY sort, id').all() }));
r.post('/works', (req, res) => {
  const w = workFields(req.body); if (!w.title) return bad(res, 'Title is required.');
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) v FROM works').get().v;
  const { lastInsertRowid } = db.prepare('INSERT INTO works (kind,title,subtitle,period,sort) VALUES (?,?,?,?,?)').run(w.kind, w.title, w.subtitle, w.period, w.sort || max + 1);
  res.json({ id: Number(lastInsertRowid) });
});
r.put('/works/:id', (req, res) => {
  const w = workFields(req.body); if (!w.title) return bad(res, 'Title is required.');
  db.prepare('UPDATE works SET kind=?,title=?,subtitle=?,period=?,sort=? WHERE id=?').run(w.kind, w.title, w.subtitle, w.period, w.sort, Number(req.params.id));
  res.json({ ok: true });
});
r.delete('/works/:id', (req, res) => { db.prepare('DELETE FROM works WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ---------- Social / Instagram ----------
r.put('/instagram', (req, res) => {
  if ('user_id' in req.body) setSetting('ig_user_id', String(req.body.user_id).trim());
  if (req.body.token) { setSetting('ig_token', String(req.body.token).trim()); setSetting('ig_token_refreshed_at', Date.now()); }
  res.json({ ok: true });
});
r.post('/instagram/sync', asyncHandler(async (_req, res) => res.json(await syncInstagram())));

r.get('/social', (_req, res) => res.json({ posts: db.prepare("SELECT * FROM social_posts ORDER BY COALESCE(posted_at,'') DESC, id DESC LIMIT 100").all() }));
r.post('/social', imageUpload.single('file'), (req, res) => {
  if (!req.file) return bad(res, 'Choose an image.');
  db.prepare("INSERT INTO social_posts (source, ext_id, caption, media_type, thumb, permalink, posted_at) VALUES ('manual', ?, ?, 'IMAGE', ?, ?, datetime('now'))")
    .run(rand(), String(req.body.caption || '').slice(0, 500), '/uploads/' + req.file.filename, String(req.body.permalink || '').slice(0, 400));
  res.json({ ok: true });
});
r.put('/social/:id', (req, res) => { db.prepare('UPDATE social_posts SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, Number(req.params.id)); res.json({ ok: true }); });
r.delete('/social/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(Number(req.params.id));
  if (p?.source === 'manual') unlink(p.thumb);
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default r;
