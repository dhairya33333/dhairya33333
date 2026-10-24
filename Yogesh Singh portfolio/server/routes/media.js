import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { hlsDir } from '../transcode.js';
import { playlistInfo } from '../hls.js';

const r = Router();
const SEG = /^seg_\d{5}\.ts$/;

function load(req, res) {
  const m = db.prepare("SELECT * FROM movies WHERE id = ? AND status = 'ready'").get(Number(req.params.id));
  if (!m || (!m.published && req.user?.role !== 'admin')) { res.status(404).end(); return null; }
  return m;
}
const canWatchFull = (user, m) => !!user && (user.role === 'admin' ||
  !!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND movie_id = ?').get(user.id, m.id));

const noStore = (res) => res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });

// Free preview: public, but only the first N minutes exist in this playlist.
r.get('/:id/preview.m3u8', (req, res) => {
  const m = load(req, res); if (!m) return;
  noStore(res).type('application/vnd.apple.mpegurl').send(playlistInfo(m).previewPlaylist);
});

// Full film: only for purchasers (and admins).
r.get('/:id/full.m3u8', (req, res) => {
  const m = load(req, res); if (!m) return;
  if (!canWatchFull(req.user, m)) return res.status(req.user ? 403 : 401).json({ error: 'Purchase required.' });
  noStore(res).type('application/vnd.apple.mpegurl');
  fs.createReadStream(path.join(hlsDir(m.id), 'index.m3u8')).pipe(res);
});

// Segments: preview segments are open, everything after the free window needs entitlement.
r.get('/:id/:file', (req, res) => {
  const m = load(req, res); if (!m) return;
  const { file } = req.params;
  if (!SEG.test(file)) return res.status(404).end();
  if (!playlistInfo(m).previewNames.has(file) && !canWatchFull(req.user, m)) return res.status(req.user ? 403 : 401).end();
  const p = path.join(hlsDir(m.id), file);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set({ 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).type('video/mp2t');
  fs.createReadStream(p).pipe(res);
});

export default r;
