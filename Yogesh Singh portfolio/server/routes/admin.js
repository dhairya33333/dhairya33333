import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, allSettings, setSetting, getSetting, tx } from '../db.js';
import { dirs, config } from '../config.js';
import { requireAdmin, asyncHandler, randomId } from '../auth.js';
import { hlsDir, usageReport } from '../storage.js';
import { enqueueTranscode, cancelEncode, checkFfmpeg } from '../transcode.js';
import { syncInstagram } from '../instagram.js';
import { refreshEmbed } from '../instagram-meta.js';
import { optimizeImage, removeUploaded } from '../images.js';
import { funnel } from '../analytics.js';
import { normalise as normCode, validCode, couponUses } from '../coupons.js';
import { parseSubtitles, toVtt, LIMITS as SUB_LIMITS } from '../subtitles.js';
import { SITE_DEFAULTS, EDITABLE_KEYS } from '../defaults.js';
import uploadRoutes from './uploads.js';
import { LEGAL_DEFAULTS, LEGAL_TITLES } from '../legal-defaults.js';

import { adminRevoke } from '../payments/ledger.js';
import { log } from '../log.js';
import { mailConfigured, sendMail, notifyAddress } from '../mailer.js';

const r = Router();
r.use(requireAdmin);

// Audit log: who changed something, and what. Records the route and result only, never request bodies (they can hold passwords or tokens).
r.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const admin = { id: req.user.id, email: req.user.email };
  res.on('finish', () => {
    try {
      const url = req.originalUrl.split('?')[0].replace(/^\/api\/admin/, '').slice(0, 160);
      if (/^\/uploads\/[^/]+\/chunk/.test(url)) return;                      // a 10 GB upload is hundreds of chunks: log the start and the end, not each piece
      db.prepare('INSERT INTO audit_log (admin_id, admin_email, action, status) VALUES (?, ?, ?, ?)').run(admin.id, admin.email, `${req.method} ${url}`, res.statusCode);
    } catch { /* never affects the response */ }
  });
  next();
});
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
    legal_placeholders: Object.keys(LEGAL_TITLES).reduce((n, k) => n + placeholderCount(getSetting(`legal_${k}`, LEGAL_DEFAULTS[k])), 0),
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
  credits: String(b.credits ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60).map((l) => l.slice(0, 160)).join('\n'),
});

r.get('/movies', (_req, res) => res.json({ movies: db.prepare('SELECT * FROM movies ORDER BY id DESC').all().map(adminMovie) }));

r.post('/movies', (req, res) => {
  const f = movieFields(req.body);
  if (!f.title) return bad(res, 'Title is required.');
  let slug = slugify(f.title);
  while (db.prepare('SELECT 1 FROM movies WHERE slug = ?').get(slug)) slug += '-' + randomId(2);
  const { lastInsertRowid } = db.prepare('INSERT INTO movies (slug, title, tagline, description, year, price_paise, preview_sec, published, featured, credits) VALUES (?,?,?,?,?,?,?,0,0,?)')
    .run(slug, f.title, f.tagline, f.description, f.year,
      has(req.body.price_rupees) ? f.price_paise : 29900,                 // blank price = default Rs 299
      has(req.body.preview_minutes) ? f.preview_sec : 1800, f.credits);   // blank preview = default 30 minutes
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
    db.prepare('UPDATE movies SET title=?, tagline=?, description=?, year=?, price_paise=?, preview_sec=?, published=?, featured=?, credits=? WHERE id=?')
      .run(f.title, f.tagline, f.description, f.year, f.price_paise, f.preview_sec, f.published, f.featured, 'credits' in req.body ? f.credits : m.credits, m.id);
  });
  res.json({ ok: true });
});

for (const kind of ['poster', 'trailer']) {
  r.post(`/movies/:id/${kind}`, imageUpload.single('file'), (req, res) => {
    const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id));
    if (!m || !req.file) return bad(res, 'Choose an image (jpg, png, webp) or, for a trailer, mp4/webm.');
    unlink(m[kind]);
    if (kind === 'poster') {                                            // posters are resized and stripped of camera metadata
      return optimizeImage(req.file.path, { folder: 'posters', maxWidth: 1000, thumb: false }).then((img) => {
        db.prepare('UPDATE movies SET poster = ? WHERE id = ?').run(img.src, m.id); res.json({ url: img.src });
      }).catch((e) => bad(res, e.message));
    }
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

// ---------- Funnel, discounts, audit log, system health ----------
r.get('/funnel', (req, res) => res.json(funnel(Math.min(365, Math.max(1, Number(req.query.days) || 30)))));

r.get('/coupons', (_req, res) => res.json({ items: db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all().map((c) => ({ ...c, used: couponUses(c.code) })) }));
r.post('/coupons', (req, res) => {
  const code = normCode(req.body.code);
  if (!validCode(code)) return bad(res, 'Code: 3 to 24 letters, numbers, - or _.');
  const kind = req.body.kind === 'amount' ? 'amount' : 'percent', v = Number(req.body.value);
  if (kind === 'percent' && !(Number.isInteger(v) && v >= 1 && v <= 100)) return bad(res, 'Percent must be a whole number from 1 to 100.');
  if (kind === 'amount' && !(Number.isFinite(v) && v >= 1)) return bad(res, 'Rupees off must be at least 1.');
  const max = has(req.body.max_uses) ? Math.max(1, Math.floor(Number(req.body.max_uses))) : null;
  const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.expires_on || '')) ? req.body.expires_on : null;
  const movie = has(req.body.movie_id) ? Number(req.body.movie_id) : null;
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(code)) return bad(res, 'That code already exists.', 409);
  db.prepare('INSERT INTO coupons (code, percent, amount_paise, max_uses, expires_on, movie_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(code, kind === 'percent' ? v : null, kind === 'amount' ? Math.round(v * 100) : null, max, exp, movie);
  res.json({ ok: true, code });
});
r.put('/coupons/:code', (req, res) => {
  const out = db.prepare('UPDATE coupons SET active = ? WHERE code = ?').run(req.body.active ? 1 : 0, normCode(req.params.code));
  out.changes ? res.json({ ok: true }) : bad(res, 'Not found.', 404);
});
r.delete('/coupons/:code', (req, res) => {
  const code = normCode(req.params.code);
  if (db.prepare('SELECT 1 FROM orders WHERE coupon_code = ? LIMIT 1').get(code)) return bad(res, 'This code has been used. Switch it off instead of deleting, so past orders stay explainable.', 409);
  const out = db.prepare('DELETE FROM coupons WHERE code = ?').run(code);
  out.changes ? res.json({ ok: true }) : bad(res, 'Not found.', 404);
});

r.get('/audit', (_req, res) => res.json({ items: db.prepare('SELECT at, admin_email, action, status FROM audit_log ORDER BY id DESC LIMIT 300').all() }));

r.get('/health', (_req, res) => {
  let newest = null, status = null;
  try {
    const files = fs.readdirSync(dirs.backups).filter((f) => /^portfolio-.*\.sqlite$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dirs.backups, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    newest = files[0]?.t ?? null;
    try { status = JSON.parse(fs.readFileSync(path.join(dirs.backups, 'status.json'), 'utf8')); } catch { /* no off-server status yet */ }
  } catch { /* no backup folder yet */ }
  const ageH = newest ? Math.round((Date.now() - newest) / 36e5) : null;
  const disk = usageReport(), ff = checkFfmpeg();
  const quick = Object.values(db.prepare('PRAGMA quick_check').get())[0] === 'ok';
  const checks = [
    { key: 'database', label: 'Database integrity', ok: quick, detail: quick ? 'Passes the SQLite integrity check.' : 'FAILED the integrity check. Restore from a backup.' },
    { key: 'backup', label: 'Nightly backup', ok: ageH !== null && ageH < 36, detail: ageH === null ? 'No backup found yet. Set up the nightly job (docs/DEPLOYMENT.md).' : `Last database backup ${ageH} hour(s) ago.` },
    { key: 'offsite', label: 'Off-server copy', ok: !!status?.remote_ok, detail: status ? (status.remote_ok ? `Last copied off the server at ${status.at}.` : status.remote ? 'The last off-server copy FAILED.' : 'Not configured. A copy on the same server is not a real backup.') : 'No backup status recorded yet.' },
    { key: 'disk', label: 'Disk space', ok: !disk.low_disk, detail: `${disk.free_gb} GB free of ${disk.total_gb} GB (keeps ${disk.reserve_gb} GB in reserve).` },
    { key: 'ffmpeg', label: 'Video processing (ffmpeg)', ok: ff.ok, detail: ff.ok ? 'Installed.' : 'Not found. Films cannot be processed.' },
    { key: 'payments', label: 'Payments', ok: ['razorpay', 'cashfree'].includes(config.paymentsMode), detail: config.paymentsMode === 'demo' ? 'Demo mode: no real payments.' : config.paymentsMode === 'unconfigured' ? 'Not configured.' : `Live via ${config.paymentsMode}.` },
    { key: 'email', label: 'Email', ok: mailConfigured(), detail: mailConfigured() ? 'SMTP configured. Use "Send test email" to confirm it works.' : 'Not configured. Contact alerts, receipts and password emails are off.' },
    { key: 'https', label: 'Public address uses https', ok: config.siteUrl.startsWith('https://'), detail: config.siteUrl },
    { key: 'legal', label: 'Legal pages filled in', ok: Object.keys(LEGAL_TITLES).every((k) => placeholderCount(getSetting(`legal_${k}`, LEGAL_DEFAULTS[k])) === 0), detail: 'Privacy, Terms and Refund pages must not contain [placeholders].' },
    { key: 'twofa', label: 'Two-step sign-in for you', ok: !!_req.user.totp_enabled, detail: _req.user.totp_enabled ? 'On.' : 'Off. Turn it on under Security.' },
  ];
  res.json({ checks, ok: checks.filter((c) => !['offsite', 'email', 'twofa'].includes(c.key)).every((c) => c.ok), node: process.version, uptimeHours: Math.round(process.uptime() / 360) / 10 });
});

// ---------- Subtitles ----------
const subUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SUB_LIMITS.bytes, files: 1 } });
r.get('/movies/:id/subtitles', (req, res) => res.json({ items: db.prepare('SELECT lang, label, created_at FROM subtitles WHERE movie_id = ? ORDER BY label').all(Number(req.params.id)) }));
r.post('/movies/:id/subtitles', subUpload.single('file'), (req, res) => {
  const m = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Not found.', 404);
  const lang = String(req.body.lang || '').trim().toLowerCase(), label = String(req.body.label || '').trim().slice(0, 40);
  if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(lang)) return bad(res, 'Language code looks like "en" or "hi" (2 or 3 letters).');
  if (!label) return bad(res, 'Give the language a name viewers will see, for example English.');
  if (!req.file) return bad(res, 'Choose an .srt or .vtt file (up to 2 MB).');
  let vtt; try { vtt = toVtt(parseSubtitles(req.file.buffer.toString('utf8'))); } catch (e) { return bad(res, e.message); }
  db.prepare('INSERT INTO subtitles (movie_id, lang, label, vtt) VALUES (?, ?, ?, ?) ON CONFLICT (movie_id, lang) DO UPDATE SET label = excluded.label, vtt = excluded.vtt, created_at = datetime(\'now\')').run(m.id, lang, label, vtt);
  res.json({ ok: true });
});
r.delete('/movies/:id/subtitles/:lang', (req, res) => {
  const out = db.prepare('DELETE FROM subtitles WHERE movie_id = ? AND lang = ?').run(Number(req.params.id), String(req.params.lang));
  out.changes ? res.json({ ok: true }) : bad(res, 'Not found.', 404);
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
const READONLY = new Set(['portrait']);   // changed only through its own upload route, never as free text
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
  for (const k of EDITABLE_KEYS) if (k in req.body && !READONLY.has(k)) setSetting(k, String(req.body[k]).trim().slice(0, 8000));
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

// Sends one test message to the owner's notification address so email setup can be checked without waiting for a real sale.
r.post('/email/test', asyncHandler(async (_req, res) => {
  if (!mailConfigured()) return bad(res, 'Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM in the server settings.');
  const to = notifyAddress(); if (!to) return bad(res, 'Set NOTIFY_EMAIL on the server, or a contact email under Site content, so there is somewhere to send it.');
  const out = await sendMail({ to, subject: 'Test email from your website', text: 'If you can read this, email from your website works.' });
  out.ok ? res.json({ ok: true, to: to.replace(/^(.).*(@.*)$/, '$1***$2') }) : bad(res, 'The mail server refused or could not be reached. Check the SMTP settings and the server log.', 502);
}));

// ---------- Portrait and gallery ----------
const photoUpload = multer({
  storage: multer.diskStorage({ destination: dirs.tmp, filename: (_q, f, cb) => cb(null, 'img-' + randomId() + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (_q, f, cb) => cb(null, /\.(jpe?g|png|webp)$/i.test(f.originalname)),
});

r.post('/portrait', photoUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return bad(res, 'Choose a JPG, PNG or WebP photo (up to 25 MB).');
  let img; try { img = await optimizeImage(req.file.path, { folder: 'site', maxWidth: 1400, thumb: false }); } catch (e) { return bad(res, e.message); }
  const old = getSetting('portrait'); setSetting('portrait', img.src); removeUploaded(old);
  res.json({ ok: true, url: img.src });
}));
r.delete('/portrait', (_req, res) => { removeUploaded(getSetting('portrait')); setSetting('portrait', ''); res.json({ ok: true }); });

r.get('/gallery', (_req, res) => res.json({ items: db.prepare('SELECT * FROM gallery ORDER BY sort, id').all() }));
r.post('/gallery', photoUpload.array('files', 20), asyncHandler(async (req, res) => {
  if (!req.files?.length) return bad(res, 'Choose one or more JPG, PNG or WebP photos (up to 25 MB each).');
  const caption = String(req.body.caption || '').slice(0, 300); let added = 0; const errors = [];
  for (const f of req.files) {
    try {
      const img = await optimizeImage(f.path, { folder: 'gallery' });
      const max = db.prepare('SELECT COALESCE(MAX(sort), 0) v FROM gallery').get().v;
      db.prepare('INSERT INTO gallery (src, thumb, w, h, caption, sort) VALUES (?, ?, ?, ?, ?, ?)').run(img.src, img.thumb, img.w, img.h, caption, max + 1); added++;
    } catch (e) { errors.push(e.message); }
  }
  if (!added) return bad(res, errors[0] || 'No photo could be added.');
  res.json({ ok: true, added, errors });
}));
r.put('/gallery/:id', (req, res) => {
  const id = Number(req.params.id), g = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id);
  if (!g) return bad(res, 'Not found.', 404);
  if ('caption' in req.body) db.prepare('UPDATE gallery SET caption = ? WHERE id = ?').run(String(req.body.caption || '').slice(0, 300), id);
  if ('hidden' in req.body) db.prepare('UPDATE gallery SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, id);
  if (req.body.move === 'up' || req.body.move === 'down') {          // swap places with the neighbour
    const n = req.body.move === 'up'
      ? db.prepare('SELECT * FROM gallery WHERE (sort < ? OR (sort = ? AND id < ?)) ORDER BY sort DESC, id DESC LIMIT 1').get(g.sort, g.sort, g.id)
      : db.prepare('SELECT * FROM gallery WHERE (sort > ? OR (sort = ? AND id > ?)) ORDER BY sort, id LIMIT 1').get(g.sort, g.sort, g.id);
    if (n) tx(() => { db.prepare('UPDATE gallery SET sort = ? WHERE id = ?').run(n.sort === g.sort ? (req.body.move === 'up' ? g.sort - 1 : g.sort + 1) : n.sort, g.id); db.prepare('UPDATE gallery SET sort = ? WHERE id = ?').run(g.sort, n.id); });
  }
  res.json({ ok: true });
});
r.delete('/gallery/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM gallery WHERE id = ?').get(Number(req.params.id));
  if (!g) return bad(res, 'Not found.', 404);
  db.prepare('DELETE FROM gallery WHERE id = ?').run(g.id); removeUploaded(g.src, g.thumb);
  res.json({ ok: true });
});

// ---------- Legal pages ----------
export const placeholderCount = (t) => (String(t).match(/\[[^\]\n]{2,}\]/g) || []).length;
r.get('/legal', (_req, res) => res.json({
  updated: getSetting('legal_updated', ''),
  pages: Object.keys(LEGAL_TITLES).map((slug) => { const body = getSetting(`legal_${slug}`, LEGAL_DEFAULTS[slug]); return { slug, title: LEGAL_TITLES[slug], body, placeholders: placeholderCount(body), customised: getSetting(`legal_${slug}`, null) !== null }; }),
}));
r.put('/legal', (req, res) => {
  for (const slug of Object.keys(LEGAL_TITLES)) {
    if (!(slug in req.body)) continue;
    const v = String(req.body[slug]).replace(/\r\n/g, '\n').trim();
    if (v.length < 100) return bad(res, `${LEGAL_TITLES[slug]} is too short.`);
    if (v.length > 40000) return bad(res, `${LEGAL_TITLES[slug]} is too long.`);
    setSetting(`legal_${slug}`, v);
  }
  setSetting('legal_updated', new Date().toISOString().slice(0, 10));
  res.json({ ok: true });
});

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
r.post('/social/:id/cover', coverUpload.single('file'), asyncHandler(async (req, res) => {
  const p = db.prepare("SELECT * FROM social_posts WHERE id = ? AND source = 'embed'").get(Number(req.params.id));
  if (!p || !req.file) return bad(res, 'Choose a JPG, PNG or WebP image (up to 8 MB).');
  let img; try { img = await optimizeImage(req.file.path, { folder: 'covers', maxWidth: 1000, thumb: false }); } catch (e) { return bad(res, e.message); }
  if (p.cover_source === 'uploaded') removeUploaded(p.thumb);
  db.prepare("UPDATE social_posts SET thumb = ?, cover_source = 'uploaded' WHERE id = ?").run(img.src, p.id);
  res.json({ ok: true, url: img.src });
}));
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
