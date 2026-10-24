import express from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, dirs, ROOT } from './config.js';
import { db } from './db.js';
import { attachUser, sameOrigin, purgeRevoked } from './auth.js';
import { WORKS_SEED } from './defaults.js';
import { recoverInterrupted, cleanupStaleUploads, checkFfmpeg } from './transcode.js';
import { log } from './log.js';
import { publicSettings } from './routes/public.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import mediaRoutes from './routes/media.js';
import paymentRoutes, { webhook } from './routes/payments.js';
import adminRoutes from './routes/admin.js';

/** Content-Security-Policy that only allows third parties for integrations that are actually configured. */
export function buildCsp() {
  const script = ["'self'"], frame = [], connect = ["'self'"], style = ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'];
  if (config.google.clientId) {
    script.push('https://accounts.google.com/gsi/client'); frame.push('https://accounts.google.com/gsi/');
    connect.push('https://accounts.google.com/gsi/'); style.push('https://accounts.google.com/gsi/style');
  }
  if (config.paymentsMode === 'razorpay') {
    script.push('https://checkout.razorpay.com'); frame.push('https://api.razorpay.com', 'https://checkout.razorpay.com');
    connect.push('https://api.razorpay.com', 'https://lumberjack.razorpay.com');
  }
  if (config.paymentsMode === 'cashfree') {
    script.push('https://sdk.cashfree.com'); frame.push('https://sdk.cashfree.com', 'https://payments.cashfree.com', 'https://sandbox.cashfree.com');
    connect.push('https://sdk.cashfree.com', 'https://api.cashfree.com', 'https://sandbox.cashfree.com');
  }
  return [
    "default-src 'self'", `script-src ${script.join(' ')}`, `style-src ${style.join(' ')}`, "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", "media-src 'self' blob:", `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.length ? frame.join(' ') : "'none'"}`, "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'",
    "form-action 'self' https://payments.cashfree.com https://sandbox.cashfree.com", "frame-ancestors 'self'",
  ].join('; ');
}

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// JSON-LD is embedded in a <script> block: escape "<" so no value can close the tag.
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const abs = (p) => (p && p.startsWith('/') ? config.siteUrl + p : p);

function withMeta(file, meta) {
  const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  const canonical = abs(meta.path);
  const head = [
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta property="og:site_name" content="${esc(meta.siteName || '')}"><meta property="og:type" content="${meta.ogType || 'website'}">`,
    `<meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.description)}"><meta property="og:url" content="${esc(canonical)}">`,
    meta.image ? `<meta property="og:image" content="${esc(abs(meta.image))}">` : '',
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(meta.title)}"><meta name="twitter:description" content="${esc(meta.description)}">`,
    meta.jsonLd ? ld(meta.jsonLd) : '',
  ].join('');
  return html.replace(/<title>.*?<\/title>/, `<title>${esc(meta.title)}</title>`).replace('</head>', head + '</head>');
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const csp = buildCsp();

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': csp,
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',   // Google sign-in popup needs this relaxed value
    });
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Webhooks need the untouched bytes for signature checking, so they go before express.json().
  app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), webhook);

  app.get('/healthz', (_req, res) => { try { db.prepare('SELECT 1').get(); res.set('Cache-Control', 'no-store').json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: config.rate.api, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
  app.use('/api', sameOrigin);

  app.use('/api/auth', authRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', publicRoutes);
  app.use('/media', mediaRoutes);

  app.use('/uploads', express.static(dirs.uploads, { maxAge: '7d', index: false, dotfiles: 'deny' }));
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /media/\nDisallow: /account.html\nDisallow: /login.html\nDisallow: /reset-password.html\nDisallow: /payment-return.html\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml', (_req, res) => {
    const films = db.prepare('SELECT slug FROM movies WHERE published = 1 ORDER BY id').all();
    const urls = ['/', '/films', ...films.map((f) => `/film/${f.slug}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(config.siteUrl + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
  });

  app.use('/vendor/hls.js', express.static(path.join(ROOT, 'node_modules/hls.js/dist/hls.min.js'), { maxAge: '30d' }));

  // Admin shell is only handed to admins; the API enforces this independently.
  app.get('/admin', (req, res) => req.user?.role === 'admin' ? res.sendFile(path.join(ROOT, 'public/admin/index.html')) : res.redirect('/login.html?next=/admin'));
  app.use('/admin', (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(404).end()), express.static(path.join(ROOT, 'public/admin')));

  app.get('/film/:slug', (req, res) => {
    const m = db.prepare('SELECT * FROM movies WHERE slug = ? AND published = 1').get(req.params.slug);
    if (!m) return res.status(404).sendFile(path.join(ROOT, 'public/404.html'));
    const set = publicSettings();
    const description = (m.tagline || m.description || `${m.title}, a film by ${set.hero_name}.`).slice(0, 200);
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Movie', name: m.title, description, url: `${config.siteUrl}/film/${m.slug}`,
      ...(m.poster ? { image: abs(m.poster) } : {}), ...(/^\d{4}$/.test(m.year) ? { datePublished: m.year } : {}),
      ...(m.duration_sec ? { duration: `PT${Math.floor(m.duration_sec / 3600)}H${Math.floor((m.duration_sec % 3600) / 60)}M` } : {}),
      director: { '@type': 'Person', name: set.hero_name },
      offers: { '@type': 'Offer', price: (m.price_paise / 100).toFixed(2), priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `${config.siteUrl}/film/${m.slug}` },
    };
    res.type('html').send(withMeta('film.html', { title: `${m.title} — ${set.hero_name}`, description, image: m.poster, path: `/film/${m.slug}`, siteName: set.hero_name, ogType: 'video.movie', jsonLd }));
  });
  app.get('/films', (_req, res) => {
    const set = publicSettings();
    res.type('html').send(withMeta('films.html', { title: `Films — ${set.hero_name}`, description: `Films by ${set.hero_name}. The first part of every film is free to watch; one payment unlocks the rest.`, path: '/films', siteName: set.hero_name }));
  });
  app.get('/', (_req, res) => {
    const s = publicSettings();
    const first = db.prepare('SELECT poster FROM movies WHERE published = 1 ORDER BY featured DESC, id DESC LIMIT 1').get();
    const sameAs = ['social_instagram', 'social_youtube', 'social_x', 'social_facebook', 'social_linkedin'].map((k) => s[k]).filter(Boolean);
    const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: s.hero_name, url: config.siteUrl, description: s.meta_description, ...(sameAs.length ? { sameAs } : {}) };
    res.type('html').send(withMeta('index.html', { title: s.site_title, description: s.meta_description, image: first?.poster, path: '/', siteName: s.hero_name, jsonLd }));
  });

  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
  app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, 'public/404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // Malformed bodies are not logged at all: a JSON parse message can quote part of the body (e.g. a password).
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large.' });
    console.error(err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : String(err));   // never sent to the client
    res.status(500).json({ error: 'Something went wrong.' });
  });
  return app;
}

/** Startup housekeeping, run once by the real server (tests call it explicitly when they need it). */
export function runStartupTasks() {
  if (db.prepare('SELECT COUNT(*) c FROM works').get().c === 0 && !db.prepare("SELECT 1 FROM settings WHERE key = 'works_seeded'").get()) {
    const ins = db.prepare('INSERT INTO works (kind,title,subtitle,period,sort) VALUES (?,?,?,?,?)');
    WORKS_SEED.forEach((w) => ins.run(...w));
    db.prepare("INSERT INTO settings (key, value) VALUES ('works_seeded', '1')").run();
  }
  recoverInterrupted();
  cleanupStaleUploads();
  purgeRevoked();
  const ff = checkFfmpeg();
  if (!ff.ok) log('error', 'ffmpeg.missing', { note: 'ffmpeg/ffprobe not found for this user: film processing will fail until it is installed' });
}
