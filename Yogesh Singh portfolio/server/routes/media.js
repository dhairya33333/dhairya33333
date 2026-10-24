import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { hlsDir } from '../storage.js';
import { playlistInfo } from '../hls.js';

const r = Router();
const SEG = /^seg_\d{5}\.ts$/;

// Entitlement is always derived from the signed-in session (req.user) and the movie row. Nothing in the URL or body
// can name a different user, so changing ids cannot reach someone else's purchase.
function load(req, res) {
  const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : 0;
  const m = db.prepare("SELECT * FROM movies WHERE id = ? AND status = 'ready'").get(id);
  if (!m || (!m.published && req.user?.role !== 'admin')) { res.status(404).end(); return null; }
  return m;
}
export const canWatchFull = (user, m) => !!user && (user.role === 'admin' ||
  !!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND movie_id = ?').get(user.id, m.id));

const noStore = (res) => res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
const deny = (req, res) => res.status(req.user ? 403 : 401).json({ error: 'Purchase required.' });

function sendFile(res, file, type, headers) {
  const s = fs.createReadStream(file);
  s.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  res.set(headers).type(type);
  s.pipe(res);
}

// Free preview: public, but this playlist physically contains only the free window.
r.get('/:id/preview.m3u8', (req, res) => {
  const m = load(req, res); if (!m) return;
  const info = playlistInfo(m);
  if (!info.hasPreview) return res.status(404).json({ error: 'This film has no free preview.' });
  noStore(res).type('application/vnd.apple.mpegurl').send(info.previewPlaylist);
});

// Full film: purchasers and admins only.
r.get('/:id/full.m3u8', (req, res) => {
  const m = load(req, res); if (!m) return;
  if (!canWatchFull(req.user, m)) return deny(req, res);
  sendFile(res, path.join(hlsDir(m.id), 'index.m3u8'), 'application/vnd.apple.mpegurl', { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
});

// Segments: free-window segments are open; every later one needs an entitlement, checked on every request.
r.get('/:id/:file', (req, res) => {
  const m = load(req, res); if (!m) return;
  const { file } = req.params;
  if (!SEG.test(file)) return res.status(404).end();
  if (!playlistInfo(m).previewNames.has(file) && !canWatchFull(req.user, m)) return res.status(req.user ? 403 : 401).end();
  sendFile(res, path.join(hlsDir(m.id), file), 'video/mp2t', { 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
});

export default r;
