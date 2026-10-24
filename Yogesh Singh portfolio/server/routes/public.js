import { Router } from 'express';
import { db, allSettings } from '../db.js';
import { SITE_DEFAULTS, EDITABLE_KEYS } from '../defaults.js';
import { LEGAL_DEFAULTS, LEGAL_TITLES } from '../legal-defaults.js';
import { getSetting } from '../db.js';
import { config } from '../config.js';
import { playlistInfo } from '../hls.js';
import { canWatchFull } from './media.js';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth.js';
import { count, CLIENT_STEPS } from '../analytics.js';
import { parseSubtitles, toVtt, trimToPreview } from '../subtitles.js';

const r = Router();

const movieCard = (m) => ({
  id: m.id, slug: m.slug, title: m.title, tagline: m.tagline, description: m.description, year: m.year,
  poster: m.poster, trailer: m.trailer, duration_sec: m.duration_sec, preview_sec: m.preview_sec,
  price_paise: m.price_paise, featured: !!m.featured, ready: m.status === 'ready',
  credits: parseCredits(m.credits),
});
/** "Role|Name" per line, grouped for display. */
export function parseCredits(text) {
  return String(text || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] && p[1]).slice(0, 60).map(([role, name]) => ({ role, name }));
}

export function publicSettings() {
  const s = { ...SITE_DEFAULTS, ...allSettings() };
  return Object.fromEntries(EDITABLE_KEYS.map((k) => [k, s[k]]));
}

r.get('/site', (_req, res) => {
  const movies = db.prepare('SELECT * FROM movies WHERE published = 1 ORDER BY featured DESC, id DESC').all().map(movieCard);
  const works = db.prepare('SELECT id, kind, title, subtitle, period, url FROM works ORDER BY sort, id').all();
  const social = db.prepare('SELECT id, caption, media_type, thumb, permalink, posted_at FROM social_posts WHERE hidden = 0 AND thumb IS NOT NULL ORDER BY COALESCE(posted_at, \'\') DESC, id DESC LIMIT 12').all();
  res.json({ settings: publicSettings(), movies, works, social, paymentsMode: config.paymentsMode });
});

r.get('/movies/:slug', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!m) return res.status(404).json({ error: 'Film not found.' });
  const owns = !!req.user && (req.user.role === 'admin' ||
    !!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND movie_id = ?').get(req.user.id, m.id));
  res.json({ movie: movieCard(m), owns, paymentsMode: config.paymentsMode });
});

// Tells the player what it may load. The decision is the server's, never the browser's.
r.get('/movies/:slug/playback', (req, res) => {
  const m = db.prepare("SELECT * FROM movies WHERE slug = ? AND published = 1 AND status = 'ready'").get(req.params.slug);
  if (!m) return res.status(404).json({ error: 'Film not found.' });
  const info = playlistInfo(m);
  const full = canWatchFull(req.user, m);
  res.set('Cache-Control', 'private, no-store').json({
    mode: full ? 'full' : 'preview',
    url: full ? `/media/${m.id}/full.m3u8` : (info.hasPreview ? `/media/${m.id}/preview.m3u8` : null),
    previewSeconds: info.previewSeconds, durationSec: m.duration_sec, movieId: m.id,
    subtitles: db.prepare('SELECT lang, label FROM subtitles WHERE movie_id = ? ORDER BY label').all(m.id).map((x) => ({ ...x, url: `/api/movies/${encodeURIComponent(m.slug)}/subtitles/${x.lang}.vtt` })),
  });
});

// Subtitle track. Without the film purchased, only the cues inside the free preview are returned.
r.get('/movies/:slug/subtitles/:lang.vtt', (req, res) => {
  const m = db.prepare("SELECT * FROM movies WHERE slug = ? AND published = 1 AND status = 'ready'").get(req.params.slug);
  const row = m && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(req.params.lang) && db.prepare('SELECT vtt FROM subtitles WHERE movie_id = ? AND lang = ?').get(m.id, req.params.lang);
  if (!row) return res.status(404).end();
  let body = row.vtt;
  if (!canWatchFull(req.user, m)) body = toVtt(trimToPreview(parseSubtitles(row.vtt), m.preview_sec));
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).type('text/vtt').send(body);
});

// Anonymous funnel counter: only a step name is accepted, nothing identifies the visitor.
const trackLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { ok: true } });
r.post('/track', trackLimit, (req, res) => { if (CLIENT_STEPS.includes(req.body?.name)) count(req.body.name); res.status(204).end(); });

// Where the signed-in viewer stopped. Saved on the server so it follows them to another phone or computer.
const placeFor = (user, m) => db.prepare('SELECT position_sec FROM progress WHERE user_id = ? AND movie_id = ?').get(user.id, m.id)?.position_sec || 0;
r.get('/progress/:slug', requireAuth, (req, res) => {
  const m = db.prepare("SELECT * FROM movies WHERE slug = ? AND published = 1").get(req.params.slug);
  if (!m) return res.status(404).json({ error: 'Film not found.' });
  const cap = canWatchFull(req.user, m) ? Infinity : m.preview_sec;
  res.set('Cache-Control', 'private, no-store').json({ position: Math.min(placeFor(req.user, m), cap) });
});
r.post('/progress', requireAuth, (req, res) => {
  const m = db.prepare("SELECT * FROM movies WHERE slug = ? AND published = 1 AND status = 'ready'").get(String(req.body.slug || ''));
  const pos = Number(req.body.position);
  if (!m || !Number.isFinite(pos) || pos < 0) return res.status(400).json({ error: 'Invalid position.' });
  const max = canWatchFull(req.user, m) ? (m.duration_sec || pos) : m.preview_sec;      // cannot claim to be past what they may watch
  db.prepare("INSERT INTO progress (user_id, movie_id, position_sec, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT (user_id, movie_id) DO UPDATE SET position_sec = excluded.position_sec, updated_at = excluded.updated_at")
    .run(req.user.id, m.id, Math.min(pos, max));
  res.json({ ok: true });
});
r.get('/my/continue', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT m.slug, m.title, m.poster, m.duration_sec, p.position_sec FROM progress p JOIN movies m ON m.id = p.movie_id
    WHERE p.user_id = ? AND m.published = 1 AND p.position_sec > 30 ORDER BY p.updated_at DESC LIMIT 6`).all(req.user.id)
    .filter((x) => !x.duration_sec || x.position_sec < x.duration_sec - 60);
  res.set('Cache-Control', 'private, no-store').json({ items: rows });
});

export const legalText = (slug) => getSetting(`legal_${slug}`, LEGAL_DEFAULTS[slug]);
export const legalVersion = () => getSetting('legal_updated', 'initial');
r.get('/legal/:slug', (req, res) => {
  const slug = req.params.slug;
  if (!LEGAL_TITLES[slug]) return res.status(404).json({ error: 'Not found.' });
  res.set('Cache-Control', 'no-cache').json({ slug, title: LEGAL_TITLES[slug], body: legalText(slug), updated: legalVersion() });
});

r.get('/gallery', (_req, res) => {
  const set = publicSettings();
  res.json({ title: set.gallery_title, intro: set.gallery_intro, items: db.prepare('SELECT id, src, thumb, w, h, caption FROM gallery WHERE hidden = 0 ORDER BY sort, id').all() });
});

// Social page data. Embeds are built from a validated shortcode only: the browser never receives a free-form URL.
r.get('/social', (_req, res) => {
  const set = publicSettings();
  const embeds = db.prepare("SELECT id, ext_id, media_type, caption, author, thumb FROM social_posts WHERE source = 'embed' AND hidden = 0 ORDER BY id DESC LIMIT 60").all()
    .map((p) => ({ id: p.id, code: p.ext_id, kind: p.media_type === 'REEL' ? 'reel' : 'p', caption: p.caption || '', author: p.author || '', thumb: p.thumb || '' }));
  const posts = db.prepare("SELECT id, caption, media_type, thumb, permalink FROM social_posts WHERE hidden = 0 AND thumb IS NOT NULL AND source <> 'embed' ORDER BY COALESCE(posted_at, '') DESC, id DESC LIMIT 24").all();
  res.json({ title: set.social_title, intro: set.social_intro, profile: set.social_instagram || '', embeds, posts });
});

r.get('/my/purchases', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  const rows = db.prepare(`SELECT m.slug, m.title, m.poster, p.created_at FROM purchases p JOIN movies m ON m.id = p.movie_id WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(req.user.id);
  res.json({ purchases: rows });
});

export default r;
