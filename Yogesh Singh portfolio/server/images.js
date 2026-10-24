// Image handling for everything the admin uploads: checks it really is an image, resizes it, converts it to WebP and strips
// camera metadata (EXIF, including GPS location) so a photo cannot leak where it was taken. Uses ffmpeg with an argument array.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dirs } from './config.js';
import { randomId } from './auth.js';
import { log, scrub } from './log.js';

const SIGNATURES = [
  (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,                                      // JPEG
  (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,                     // PNG
  (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',   // WebP
];
export function looksLikeImage(file) {
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return SIGNATURES.some((f) => f(b)); } catch { return false; }
}

const run = (args, timeout = 30_000) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', args); let err = '';
  const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
  p.stderr.on('data', (d) => (err = (err + d).slice(-300)));
  p.on('error', (e) => { clearTimeout(timer); reject(e); });
  p.on('close', (c) => { clearTimeout(timer); c === 0 ? resolve() : reject(new Error(scrub(err.trim()) || `ffmpeg exited ${c}`)); });
});

function dims(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]); let out = '';
    p.stdout.on('data', (d) => (out += d)); p.on('error', () => resolve({})); p.on('close', () => { const [w, h] = out.trim().split(',').map(Number); resolve({ w: w || 0, h: h || 0 }); });
  });
}

/**
 * Takes a file the admin just uploaded (multer saved it in the uploads folder), validates and optimises it, deletes the original and
 * returns { src, thumb, w, h } as /uploads/... paths. If ffmpeg is unavailable the original is kept (still a validated image).
 */
export async function optimizeImage(uploadedPath, { folder = '', maxWidth = 1800, thumbWidth = 640, thumb = true } = {}) {
  if (!looksLikeImage(uploadedPath)) { fs.rmSync(uploadedPath, { force: true }); throw new Error('That file is not a JPG, PNG or WebP image.'); }
  const dir = path.join(dirs.uploads, folder); fs.mkdirSync(dir, { recursive: true });
  const id = randomId(8), rel = (name) => `/uploads/${folder ? folder + '/' : ''}${name}`;
  const main = path.join(dir, `${id}.webp`), small = path.join(dir, `${id}-t.webp`);
  const enc = (out, width, q) => run(['-y', '-nostdin', '-i', uploadedPath, '-map_metadata', '-1', '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-c:v', 'libwebp', '-quality', String(q), out]);
  try {
    await enc(main, maxWidth, 82);
    if (thumb) await enc(small, thumbWidth, 78);
    fs.rmSync(uploadedPath, { force: true });
    const { w, h } = await dims(main);
    return { src: rel(`${id}.webp`), thumb: thumb ? rel(`${id}-t.webp`) : rel(`${id}.webp`), w, h };
  } catch (e) {
    log('warn', 'image.optimize_failed', { reason: e.message });
    fs.rmSync(main, { force: true }); fs.rmSync(small, { force: true });
    const ext = path.extname(uploadedPath).toLowerCase(), keep = path.join(dir, `${id}${ext}`);   // fallback: keep the validated original
    fs.renameSync(uploadedPath, keep);
    const { w, h } = await dims(keep);
    return { src: rel(`${id}${ext}`), thumb: rel(`${id}${ext}`), w, h, unoptimised: true };
  }
}

/** Removes files for a stored /uploads/... path (and its -t thumbnail twin). Only paths inside the uploads folder are touched. */
export function removeUploaded(...rels) {
  for (const rel of rels) {
    if (!rel || !rel.startsWith('/uploads/')) continue;
    const full = path.resolve(dirs.uploads, rel.slice('/uploads/'.length));
    if (!full.startsWith(path.resolve(dirs.uploads) + path.sep)) continue;
    fs.rm(full, { force: true }, () => {});
  }
}
