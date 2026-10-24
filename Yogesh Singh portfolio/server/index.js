import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config, dirs, ROOT } from './config.js';
import { db } from './db.js';
import { attachUser, sameOrigin } from './auth.js';
import { recoverInterrupted } from './transcode.js';
import { startInstagramScheduler } from './instagram.js';
import { publicSettings } from './routes/public.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import mediaRoutes from './routes/media.js';
import paymentRoutes, { webhook } from './routes/payments.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://sdk.cashfree.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https://sdk.cashfree.com https://api.cashfree.com https://sandbox.cashfree.com",
      "frame-src https://sdk.cashfree.com https://payments.cashfree.com https://sandbox.cashfree.com https://www.youtube.com",
      "worker-src 'self' blob:",
      "object-src 'none'", "base-uri 'self'", "form-action 'self' https://payments.cashfree.com https://sandbox.cashfree.com",
    ].join('; '),
  });
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Webhook needs the untouched body for signature checking, so it goes before express.json().
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), webhook);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);
app.use('/api', sameOrigin);

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);
app.use('/media', mediaRoutes);

app.use('/uploads', express.static(dirs.uploads, { maxAge: '7d', index: false, dotfiles: 'deny' }));
app.use('/vendor/hls.js', express.static(path.join(ROOT, 'node_modules/hls.js/dist/hls.min.js'), { maxAge: '30d' }));

// Admin shell is only handed to admins; the API enforces this independently.
app.get('/admin', (req, res) => req.user?.role === 'admin' ? res.sendFile(path.join(ROOT, 'public/admin/index.html')) : res.redirect('/login.html?next=/admin'));
app.use('/admin', (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(404).end()), express.static(path.join(ROOT, 'public/admin')));

// Film pages: /film/<slug> with server-rendered share metadata.
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const withMeta = (file, meta) => {
  const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  return html
    .replace(/<title>.*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace('</head>', `<meta name="description" content="${esc(meta.description)}"><meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.description)}">${meta.image ? `<meta property="og:image" content="${esc(config.siteUrl + meta.image)}">` : ''}<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"></head>`);
};
app.get('/film/:slug', (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!m) return res.status(404).sendFile(path.join(ROOT, 'public/404.html'));
  res.type('html').send(withMeta('film.html', { title: `${m.title} — Yogesh Singh`, description: m.tagline || m.description.slice(0, 160), image: m.poster }));
});
app.get('/', (_req, res) => {
  const s = publicSettings();
  const first = db.prepare('SELECT poster FROM movies WHERE published = 1 ORDER BY featured DESC, id DESC LIMIT 1').get();
  res.type('html').send(withMeta('index.html', { title: s.site_title, description: s.meta_description, image: first?.poster }));
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, 'public/404.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large.' });
  res.status(500).json({ error: config.isProd ? 'Something went wrong.' : err.message });
});

recoverInterrupted();
startInstagramScheduler();
app.listen(config.port, () => console.log(`Portfolio running on ${config.siteUrl}  (payments: ${config.paymentsMode})`));
