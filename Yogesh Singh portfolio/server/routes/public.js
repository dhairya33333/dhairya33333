import { Router } from 'express';
import { db, allSettings } from '../db.js';
import { SITE_DEFAULTS, EDITABLE_KEYS } from '../defaults.js';
import { config } from '../config.js';

const r = Router();

const movieCard = (m) => ({
  id: m.id, slug: m.slug, title: m.title, tagline: m.tagline, description: m.description, year: m.year,
  poster: m.poster, trailer: m.trailer, duration_sec: m.duration_sec, preview_sec: m.preview_sec,
  price_paise: m.price_paise, featured: !!m.featured, ready: m.status === 'ready',
});

export function publicSettings() {
  const s = { ...SITE_DEFAULTS, ...allSettings() };
  return Object.fromEntries(EDITABLE_KEYS.map((k) => [k, s[k]]));
}

r.get('/site', (_req, res) => {
  const movies = db.prepare('SELECT * FROM movies WHERE published = 1 ORDER BY featured DESC, id DESC').all().map(movieCard);
  const works = db.prepare('SELECT id, kind, title, subtitle, period FROM works ORDER BY sort, id').all();
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

r.get('/my/purchases', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  const rows = db.prepare(`SELECT m.slug, m.title, m.poster, p.created_at FROM purchases p JOIN movies m ON m.id = p.movie_id WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(req.user.id);
  res.json({ purchases: rows });
});

export default r;
