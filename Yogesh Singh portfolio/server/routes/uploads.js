// Resumable chunked upload for very large originals (e.g. a 10.8 GB film) plus "import from the incoming folder".
// Chunks are streamed to disk, so memory use stays flat no matter how big the file is.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, dirs } from '../config.js';
import { db } from '../db.js';
import { asyncHandler, randomId } from '../auth.js';
import { freeBytes, safeDisplayName, insideDir, estimateEncode, VIDEO_EXT } from '../storage.js';
import { enqueueTranscode, probe } from '../transcode.js';
import { scrub, log } from '../log.js';

const r = Router();
const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });
const ID = /^[a-f0-9]{16}$/;
const publicUpload = (u) => ({ id: u.id, movie_id: u.movie_id, kind: u.kind, name: u.display_name, size: u.size, received: u.received, status: u.status, error: u.error, updated_at: u.updated_at });
const getUpload = (id) => (ID.test(id) ? db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) : null);
// An upload belongs to the admin who started it; another admin session cannot append to, finish or cancel it.
const mine = (u, req) => u && (u.created_by == null || u.created_by === req.user.id);
const inFlight = new Set();               // upload ids with a chunk currently being written (no two writers on one file)
const gb = (n) => (n / 1024 ** 3).toFixed(1);

function moveFile(from, to) {
  try { fs.renameSync(from, to); }
  catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(from, to); fs.unlinkSync(from); }   // tmp and source on different volumes
}

r.get('/movies/:id/uploads', (req, res) => {
  res.json({ uploads: db.prepare('SELECT * FROM uploads WHERE movie_id = ? ORDER BY created_at DESC LIMIT 20').all(Number(req.params.id)).map(publicUpload), chunkBytes: config.limits.chunkBytes, maxBytes: config.limits.maxUploadBytes });
});

r.post('/movies/:id/uploads', (req, res) => {
  const movie = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!movie) return bad(res, 'Film not found.', 404);
  const name = safeDisplayName(req.body.filename);
  const size = Number(req.body.size);
  if (!VIDEO_EXT.test(name)) return bad(res, 'Unsupported file type. Use mp4, mov, mkv, avi, webm or m4v.');
  if (!Number.isInteger(size) || size <= 0) return bad(res, 'The file size is missing.');
  if (size > config.limits.maxUploadBytes) return bad(res, `This file is ${gb(size)} GB, over the ${gb(config.limits.maxUploadBytes)} GB upload limit (MAX_UPLOAD_BYTES).`, 413);
  const free = freeBytes(dirs.tmp), need = size + config.limits.reserveFreeBytes;
  if (free < need) return bad(res, `Not enough disk space: ${gb(need)} GB needed (file plus reserve), ${gb(free)} GB free.`, 507);

  const id = randomId(8);
  const tmp = path.join(dirs.tmp, `${id}.part`);
  fs.writeFileSync(tmp, '');
  db.prepare("INSERT INTO uploads (id, movie_id, kind, display_name, size, path, created_by) VALUES (?, ?, 'upload', ?, ?, ?, ?)").run(id, movie.id, name, size, tmp, req.user.id);
  res.json({ upload: publicUpload(getUpload(id)), chunkBytes: config.limits.chunkBytes });
});

r.get('/uploads/:uid', (req, res) => {
  const u = getUpload(req.params.uid);
  if (!mine(u, req)) return bad(res, 'Upload not found.', 404);
  res.json({ upload: publicUpload(u), chunkBytes: config.limits.chunkBytes });
});

r.put('/uploads/:uid/chunk', asyncHandler(async (req, res) => {
  const u = getUpload(req.params.uid);
  if (!mine(u, req)) return bad(res, 'Upload not found.', 404);
  if (u.status !== 'uploading') return bad(res, `This upload is already ${u.status}.`, 409);
  const offset = Number(req.query.offset);
  if (!Number.isInteger(offset) || offset !== u.received) return bad(res, 'Chunk out of order. Resuming from the server position.', 409, { received: u.received });
  const len = Number(req.headers['content-length']);
  if (!len || len > config.limits.chunkBytes + 1024) return bad(res, 'Invalid chunk size.', 413);
  if (u.received + len > u.size) return bad(res, 'Chunk goes past the declared file size.');
  if (freeBytes(dirs.tmp) < len + config.limits.reserveFreeBytes / 2) return bad(res, 'The server ran out of disk space.', 507);

  if (inFlight.has(u.id)) return bad(res, 'Another chunk for this upload is still being written.', 409, { received: u.received });
  // Optional integrity check: the browser sends the SHA-256 of the piece; we hash while writing (streaming, no buffering).
  const expected = String(req.headers['x-chunk-sha256'] || '').toLowerCase();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) return bad(res, 'Invalid checksum header.');
  const hash = crypto.createHash('sha256');
  const hasher = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); cb(null, chunk); } });
  inFlight.add(u.id);
  try {
    const ws = fs.createWriteStream(u.path, { flags: 'r+', start: offset });
    await pipeline(req, hasher, ws);
    if (ws.bytesWritten !== len) throw new Error('short chunk');
    if (expected && hash.digest('hex') !== expected) {
      fs.truncateSync(u.path, u.received);
      return bad(res, 'The chunk arrived damaged (checksum mismatch). Retrying.', 422, { received: u.received });
    }
  } catch {
    fs.truncateSync(u.path, u.received);              // drop a half-written chunk so the client can resend it
    return res.headersSent ? undefined : bad(res, 'Chunk upload interrupted. Please retry.', 400, { received: u.received });
  } finally { inFlight.delete(u.id); }
  db.prepare("UPDATE uploads SET received = ?, updated_at = datetime('now') WHERE id = ?").run(offset + len, u.id);
  res.json({ received: offset + len });
}));

r.post('/uploads/:uid/complete', asyncHandler(async (req, res) => {
  const u = getUpload(req.params.uid);
  if (!mine(u, req)) return bad(res, 'Upload not found.', 404);
  if (inFlight.has(u.id)) return bad(res, 'A chunk is still being written.', 409);
  if (u.status !== 'uploading') return bad(res, `This upload is already ${u.status}.`, 409);
  if (u.received !== u.size || fs.statSync(u.path).size !== u.size) return bad(res, 'The upload is incomplete.', 400, { received: u.received });

  const final = path.join(dirs.source, `${u.id}${path.extname(u.display_name).toLowerCase()}`);
  moveFile(u.path, final);
  db.prepare("UPDATE uploads SET path = ?, status = 'queued', updated_at = datetime('now') WHERE id = ?").run(final, u.id);
  let estimate = null;
  try { const info = await probe(final); estimate = estimateEncode(info.duration, info.bytes); }
  catch (e) {  // not a video: keep the file (never deleted automatically), report clearly, do not queue
    db.prepare("UPDATE uploads SET status = 'failed', error = ? WHERE id = ?").run(scrub(e.message), u.id);
    return bad(res, scrub(e.message), 422);
  }
  log('info', 'upload.completed', { upload: u.id, movie: u.movie_id, bytes: u.size });
  enqueueTranscode(u.movie_id, final, u.id);
  res.json({ ok: true, estimate });
}));

r.delete('/uploads/:uid', (req, res) => {
  const u = getUpload(req.params.uid);
  if (!mine(u, req)) return bad(res, 'Upload not found.', 404);
  if (u.status !== 'uploading') return bad(res, 'Only an unfinished upload can be cancelled.', 409);
  if (u.path?.startsWith(dirs.tmp)) fs.rmSync(u.path, { force: true });
  db.prepare("UPDATE uploads SET status = 'failed', error = 'Cancelled.' WHERE id = ?").run(u.id);
  res.json({ ok: true });
});

r.get('/incoming', (_req, res) => {
  const files = fs.readdirSync(dirs.incoming).filter((f) => VIDEO_EXT.test(f))
    .map((f) => ({ name: f, size: fs.statSync(path.join(dirs.incoming, f)).size }));
  res.json({ files });   // directory path intentionally not returned
});

r.post('/movies/:id/import', (req, res) => {
  const movie = db.prepare('SELECT id FROM movies WHERE id = ?').get(Number(req.params.id));
  if (!movie) return bad(res, 'Film not found.', 404);
  const name = path.basename(String(req.body.file || ''));
  const file = path.join(dirs.incoming, name);
  if (!VIDEO_EXT.test(name) || !insideDir(dirs.incoming, file)) return bad(res, 'File not found in the incoming folder.');
  const id = randomId(8);
  const size = fs.statSync(file).size;
  db.prepare("INSERT INTO uploads (id, movie_id, kind, display_name, size, received, path, created_by) VALUES (?, ?, 'import', ?, ?, ?, ?, ?)").run(id, movie.id, safeDisplayName(name), size, size, fs.realpathSync(file), req.user.id);
  enqueueTranscode(movie.id, fs.realpathSync(file), id);   // the original stays in the incoming folder
  res.json({ ok: true });
});

export default r;
