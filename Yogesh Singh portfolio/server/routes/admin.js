import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, allSettings, setSetting, tx } from '../db.js';
import { dirs, config } from '../config.js';
import { requireAdmin, asyncHandler, randomId } from '../auth.js';
import { hlsDir, usageReport } from '../storage.js';
import { enqueueTranscode, cancelEncode, checkFfmpeg } from '../transcode.js';
import { syncInstagram } from '../instagram.js';
import { refreshEmbed } from '../instagram-meta.js';
import { SITE_DEFAULTS, EDITABLE_KEYS } from '../defaults.js';
import uploadRoutes from './uploads.js';
import { adminRevoke } from '../payments/ledger.js';
import { log } from '../log.js';

const r = Router();
r.use(requireAdmin);
r.use(uploadRoutes);

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'film';
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Small images / short trailers only. Feature films go through the chunked upload route.
const imageUpload = multer({
  storage: multer.diskStorage({ destination: dirs.uploads, filename: (_q, f, cb) => cb(null, randomId() + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, /\.(jpe?g|png|webp|avif|mp4|webm)$/i.test(f.originalname)),
});
const unlink = (rel) => { if (rel?.startsWith('/uploads/')) fs.rm(path.join(dirs.uploads, path.basename(rel)), () => {}); };

/** What the admin UI may see about a film. Server file paths never leave the server. */
const adminMovie = ({ source_file, ...m }) => ({ ...m, has_source: !!source_file, source_in_library: !!source_file?.startsWith(dirs.source) });

// ---------- Dashboard ----------
r.get('/stats', (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    revenue_paise: one("SELECT COALESCE(SUM(amount_paise),0) v FROM orders WHERE status='PAID'").v,
    orders_paid: one("SELECT COUNT(*) v FROM orders WHERE status='PAID'").v,
    orders_refunded: one("SELECT COUNT(*) v FROM orders WHERE status='REFUNDED'").v,
    users: one("SELECT COUNT(*) v FROM users WHERE role='user'").v,
    movies: one('SELECT COUNT(*) v FROM movies').v,
    recent: db.prepare(`SELECT o.order_id, o.amount_paise, o.paid_at, u.name, m.title FROM orders o JOIN users u ON u.id=o.user_id JOIN movies m ON m.id=o.movie_id WHERE o.status='PAID' ORDER BY o.paid_at DESC LIMIT 8`).all(),
    paymentsMode: config.paymentsMode,
    googleConfigured: !!config.google.clientId,
    unread_messages: one('SELECT COUNT(*) v FROM messages WHERE is_read = 0').v,
    ffmpegOk: checkFfmpeg().ok,
  });
});

r.get('/storage', (_req, res) => res.json(usageReport()));

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

r.get('/movies', (_req, res) => res.json({ movies: db.prepare('SELECT * FROM movies ORDER BY id DESC').all().map(adminMovie) }));

r.post('/movies', (req, res) => {
  const f = movieFields(req.body);
  if (!f.title) return bad(res, 'Title is required.');
  let slug = slugify(f.title);
  while (db.prepare('SELECT 1 FROM movies WHERE slug = ?').get(slug)) slug += '-' + randomId(2);
  const { lastInsertRowid } = db.prepare('INSERT INTO movies (slug, title, tagline, description, year, price_paise, preview_sec, published, featured) VALUES (?,?,?,?,?,?,?,0,0)')
    .run(slug, f.title, f.tagline, f.description, f.year,
      has(req.body.price_rupees) ? f.price_paise : 29900,                 // blank price = default Rs 299
      has(req.body.preview_minutes) ? f.preview_sec : 1800);              // blank preview = default 30 minutes
  res.json({ id: Number(lastInsertRowid) });
});

r.put('/movies/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  const f = movieFields({ price_rupees: m.price_paise / 100, preview_minutes: m.preview_sec / 60, ...req.body });
  if (!f.title) return bad(res, 'Title is required.');
  if (f.published && !(m.status === 'ready' && m.validated)) return bad(res, 'Upload and process the film (and let it pass validation) before publishing it.');
  tx(() => {
    if (f.featured) db.prepare('UPDATE movies SET featured = 0').run();
    db.prepare('UPDATE movies SET title=?, tagline=?, description=?, year=?, price_paise=?, preview_sec=?, published=?, featured=? WHERE id=?')
      .run(f.title, f.tagline, f.description, f.year, f.price_paise, f.preview_sec, f.published, f.featured, m.id);
  });
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

r.post('/movies/:id/cancel-encode', (req, res) => {
  const what = cancelEncode(Number(req.params.id));
  if (!what) return bad(res, 'Nothing is being processed for this film.', 409);
  log('warn', 'encode.cancelled', { movie: Number(req.params.id), admin: req.user.id });
  res.json({ ok: true, was: what });
});

r.post('/movies/:id/reprocess', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m?.source_file || !fs.existsSync(m.source_file)) return bad(res, 'The original file is no longer on the server. Upload it again.');
  if (['queued', 'processing'].includes(m.encode_state)) return bad(res, 'This film is already being processed.', 409);
  enqueueTranscode(m.id, m.source_file);
  res.json({ ok: true });
});

// Explicit, typed-confirmation removal of an uploaded original, allowed only once validated output exists.
r.post('/movies/:id/cleanup-source', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  if (req.body.confirm !== 'DELETE') return bad(res, 'Type DELETE to confirm.');
  if (!(m.status === 'ready' && m.validated && m.encode_state === 'idle')) return bad(res, 'The processed film must be ready and validated first.', 409);
  if (!m.source_file?.startsWith(dirs.source + path.sep) || !fs.existsSync(m.source_file)) return bad(res, 'There is no uploaded original to remove. (Files in the incoming folder are never touched.)', 409);
  fs.rmSync(m.source_file, { force: true });
  db.prepare('UPDATE movies SET source_file = NULL WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

r.delete('/movies/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  if (db.prepare('SELECT 1 FROM purchases WHERE movie_id = ? LIMIT 1').get(m.id) || db.prepare("SELECT 1 FROM orders WHERE movie_id = ? AND status IN ('PAID','REFUNDED') LIMIT 1").get(m.id))
    return bad(res, 'This film has paying customers or payment history. Unpublish it instead of deleting.', 409);
  if (m.source_file?.startsWith(dirs.source + path.sep) && fs.existsSync(m.source_file))
    return bad(res, 'The original movie file is still stored on the server. Originals are never deleted automatically: use "Remove original" (after the film is validated) or remove it manually, then delete the film.', 409);
  tx(() => {
    db.prepare('DELETE FROM uploads WHERE movie_id = ?').run(m.id);
    db.prepare('DELETE FROM orders WHERE movie_id = ?').run(m.id);
    db.prepare('DELETE FROM movies WHERE id = ?').run(m.id);
  });
  unlink(m.poster); unlink(m.trailer);
  fs.rmSync(hlsDir(m.id), { recursive: true, force: true });   // processed output only; incoming-folder originals are never touched
  res.json({ ok: true });
});

// ---------- Orders / users ----------
r.get('/orders', (_req, res) => res.json({ orders: db.prepare(`SELECT o.order_id, o.amount_paise, o.refunded_paise, o.dispute_status, o.status, o.provider, o.failure_reason, o.created_at, o.paid_at, u.name, u.email, m.title FROM orders o JOIN users u ON u.id=o.user_id JOIN movies m ON m.id=o.movie_id ORDER BY o.id DESC LIMIT 300`).all() }));

// Admin decision to withdraw access (e.g. a chargeback handled outside the gateway). Logged and irreversible from the UI.
r.post('/orders/:orderId/revoke', (req, res) => {
  const out = adminRevoke(String(req.params.orderId));
  if (!out.ok) return bad(res, 'Order not found.', 404);
  log('warn', 'order.admin_revoke', { order: req.params.orderId, admin: req.user.id });
  res.json({ ok: true });
});

r.get('/users', (_req, res) => res.json({
  users: db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, (u.google_sub IS NOT NULL) AS google, (SELECT COUNT(*) FROM purchases p WHERE p.user_id=u.id) purchases FROM users u ORDER BY u.id DESC LIMIT 500`).all(),
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

// One-time password-reset link, valid 60 minutes. Only a hash is stored; the link is shown once, to this admin.
r.post('/users/:id/reset-link', (req, res) => {
  const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return bad(res, 'User not found.', 404);
  const token = randomId(24);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), u.id, Date.now() + 60 * 60 * 1000, req.user.id);
  log('info', 'password_reset.issued', { user: u.id, admin: req.user.id });
  res.json({ url: `${config.siteUrl}/reset-password.html?token=${token}`, expiresInMinutes: 60 });
});

r.post('/users/:id/role', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 'You cannot change your own role.');
  db.prepare('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?').run(req.body.role === 'admin' ? 'admin' : 'user', id);
  res.json({ ok: true });
});

// ---------- Site content ----------
const isUrl = (v) => { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } };
const URL_KEYS = new Set(['social_instagram', 'social_youtube', 'social_x', 'social_facebook', 'social_linkedin']);

r.get('/settings', (_req, res) => {
  const s = { ...SITE_DEFAULTS, ...allSettings() };
  res.json({
    settings: Object.fromEntries(EDITABLE_KEYS.map((k) => [k, s[k]])),
    instagram: { user_id: s.ig_user_id || '', hasToken: !!s.ig_token, status: s.ig_last_status || 'Never synced' },
  });
});

r.put('/settings', (req, res) => {
  for (const k of EDITABLE_KEYS) {
    if (!(k in req.body)) continue;
    const v = String(req.body[k]).trim().slice(0, 8000);
    if (URL_KEYS.has(k) && v && !isUrl(v)) return bad(res, `${k.replace('social_', '')} must be a full http(s) link.`);
  }
  for (const k of EDITABLE_KEYS) if (k in req.body) setSetting(k, String(req.body[k]).trim().slice(0, 8000));
  res.json({ ok: true });
});

// ---------- Journey / articles ----------
const KINDS = ['career', 'book', 'film', 'talk', 'article', 'honour'];
const workFields = (b) => ({
  kind: KINDS.includes(b.kind) ? b.kind : 'career',
  title: String(b.title || '').trim().slice(0, 160),
  subtitle: String(b.subtitle || '').trim().slice(0, 400),
  period: String(b.period || '').trim().slice(0, 40),
  url: String(b.url || '').trim().slice(0, 400),
  sort: Number(b.sort) || 0,
});
r.get('/works', (_req, res) => res.json({ works: db.prepare('SELECT * FROM works ORDER BY sort, id').all() }));
r.post('/works', (req, res) => {
  const w = workFields(req.body); if (!w.title) return bad(res, 'Title is required.');
  if (w.url && !isUrl(w.url)) return bad(res, 'The link must start with http:// or https://');
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) v FROM works').get().v;
  const { lastInsertRowid } = db.prepare('INSERT INTO works (kind,title,subtitle,period,url,sort) VALUES (?,?,?,?,?,?)').run(w.kind, w.title, w.subtitle, w.period, w.url, w.sort || max + 1);
  res.json({ id: Number(lastInsertRowid) });
});
r.put('/works/:id', (req, res) => {
  const w = workFields(req.body); if (!w.title) return bad(res, 'Title is required.');
  if (w.url && !isUrl(w.url)) return bad(res, 'The link must start with http:// or https://');
  db.prepare('UPDATE works SET kind=?,title=?,subtitle=?,period=?,url=?,sort=? WHERE id=?').run(w.kind, w.title, w.subtitle, w.period, w.url, w.sort, Number(req.params.id));
  res.json({ ok: true });
});
r.delete('/works/:id', (req, res) => { db.prepare('DELETE FROM works WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ---------- Contact inbox ----------
r.get('/messages', (_req, res) => res.json({
  messages: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all(),
  unread: db.prepare('SELECT COUNT(*) c FROM messages WHERE is_read = 0').get().c,
}));
r.put('/messages/:id', (req, res) => { db.prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(req.body.read === false ? 0 : 1, Number(req.params.id)); res.json({ ok: true }); });
r.delete('/messages/:id', (req, res) => { db.prepare('DELETE FROM messages WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ---------- Social / Instagram ----------
/** Accepts only real Instagram post/reel links. Returns { code, kind } or null. Lookalike hosts, other schemes and extra path are refused. */
export function parseInstagramLink(input) {
  let u; try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(u.hostname) || u.username || u.password || u.port) return null;
  const m = /^\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})\/?$/.exec(u.pathname);
  return m ? { code: m[2], kind: m[1] === 'p' ? 'p' : 'reel' } : null;
}

r.post('/social/embed', asyncHandler(async (req, res) => {
  const link = parseInstagramLink(req.body.url);
  if (!link) return bad(res, 'Paste a link to an Instagram post or reel, like https://www.instagram.com/p/XXXXXXXXXXX/ or https://www.instagram.com/reel/XXXXXXXXXXX/');
  const exists = db.prepare("SELECT id FROM social_posts WHERE source = 'embed' AND ext_id = ?").get(link.code);
  if (exists) return bad(res, 'That post is already on the Social page.', 409);
  db.prepare("INSERT INTO social_posts (source, ext_id, caption, media_type, permalink, posted_at) VALUES ('embed', ?, ?, ?, ?, datetime('now'))")
    .run(link.code, String(req.body.caption || '').slice(0, 600), link.kind === 'reel' ? 'REEL' : 'POST', `https://www.instagram.com/${link.kind}/${link.code}/`);
  const id = db.prepare("SELECT id FROM social_posts WHERE source = 'embed' AND ext_id = ?").get(link.code).id;
  const meta = await refreshEmbed(id);                      // cover image + caption, best effort
  res.json({ ok: true, id, cover: meta.cover, note: meta.note });
}));

r.post('/social/:id/refresh', asyncHandler(async (req, res) => {
  const out = await refreshEmbed(Number(req.params.id));
  if (out.note === 'not_found') return bad(res, 'Post not found.', 404);
  res.json(out);
}));

// Admin-supplied cover image for a link post (used when Instagram does not hand one over)
const coverUpload = multer({
  storage: multer.diskStorage({ destination: dirs.uploads, filename: (_q, f, cb) => cb(null, 'cover-' + randomId() + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, /\.(jpe?g|png|webp)$/i.test(f.originalname)),
});
r.post('/social/:id/cover', coverUpload.single('file'), (req, res) => {
  const p = db.prepare("SELECT * FROM social_posts WHERE id = ? AND source = 'embed'").get(Number(req.params.id));
  if (!p || !req.file) return bad(res, 'Choose a JPG, PNG or WebP image (up to 8 MB).');
  if (p.cover_source === 'uploaded') unlink(p.thumb);
  db.prepare("UPDATE social_posts SET thumb = ?, cover_source = 'uploaded' WHERE id = ?").run('/uploads/' + req.file.filename, p.id);
  res.json({ ok: true, url: '/uploads/' + req.file.filename });
});
r.put('/instagram', (req, res) => {
  if ('user_id' in req.body) setSetting('ig_user_id', String(req.body.user_id).trim());
  if (req.body.token) { setSetting('ig_token', String(req.body.token).trim()); setSetting('ig_token_refreshed_at', Date.now()); }
  res.json({ ok: true });
});
r.post('/instagram/sync', asyncHandler(async (_req, res) => res.json(await syncInstagram())));

r.get('/social', (_req, res) => res.json({ posts: db.prepare("SELECT * FROM social_posts ORDER BY COALESCE(posted_at,'') DESC, id DESC LIMIT 100").all() }));
r.post('/social', imageUpload.single('file'), (req, res) => {
  if (!req.file) return bad(res, 'Choose an image.');
  const link = String(req.body.permalink || '').trim().slice(0, 400);
  if (link && !isUrl(link)) return bad(res, 'The link must start with http:// or https://');
  db.prepare("INSERT INTO social_posts (source, ext_id, caption, media_type, thumb, permalink, posted_at) VALUES ('manual', ?, ?, 'IMAGE', ?, ?, datetime('now'))")
    .run(randomId(), String(req.body.caption || '').slice(0, 500), '/uploads/' + req.file.filename, link);
  res.json({ ok: true });
});
r.put('/social/:id', (req, res) => {
  const id = Number(req.params.id);
  if ('hidden' in req.body) db.prepare('UPDATE social_posts SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, id);
  if ('caption' in req.body) db.prepare('UPDATE social_posts SET caption = ? WHERE id = ?').run(String(req.body.caption || '').slice(0, 600), id);
  res.json({ ok: true });
});
r.delete('/social/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(Number(req.params.id));
  if (p?.source === 'manual' || p?.cover_source === 'uploaded') unlink(p.thumb);
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default r;
