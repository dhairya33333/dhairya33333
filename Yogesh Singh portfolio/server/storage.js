import fs from 'node:fs';
import path from 'node:path';
import { config, dirs } from './config.js';

export const hlsDir = (movieId) => path.join(dirs.media, String(movieId));
export const VIDEO_EXT = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;

/** Free bytes on the filesystem that holds `dir`. */
export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
export function totalBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.blocks) * Number(s.bsize);
}

export function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* vanished */ } }
  }
  return total;
}

/** Display-only name: never used to build a path. */
export const safeDisplayName = (name) => path.basename(String(name || 'video')).replace(/[^\w.\- ()]/g, '_').slice(0, 120);

/** Rough output size/time before encoding, from duration and the configured bitrate cap. Real numbers are logged after each job. */
export function estimateEncode(durationSec) {
  const kbps = Math.min(config.encode.estVideoKbps, config.encode.maxrateKbps) + 128;
  return {
    durationSec,
    estOutputBytes: Math.round((durationSec * kbps * 1000) / 8),
    estEncodeSeconds: Math.round(durationSec / config.encode.speedX),
  };
}

/** True when `target` resolves (symlinks included) to a regular file inside `base`. */
export function insideDir(base, target) {
  try {
    const rb = fs.realpathSync(base), rt = fs.realpathSync(target);
    return rt.startsWith(rb + path.sep) && fs.statSync(rt).isFile();
  } catch { return false; }
}

export function usageReport() {
  const sizeOf = (d) => dirSize(d);
  const gb = (n) => Math.round((n / 1024 ** 3) * 100) / 100;
  const parts = {
    originals_uploaded: sizeOf(dirs.source), originals_incoming: sizeOf(dirs.incoming), processed_hls: sizeOf(dirs.media),
    posters_and_images: sizeOf(dirs.uploads), partial_uploads: sizeOf(dirs.tmp), backups: sizeOf(dirs.backups),
  };
  const free = freeBytes(dirs.data);
  return {
    free_gb: gb(free), total_gb: gb(totalBytes(dirs.data)), reserve_gb: gb(config.limits.reserveFreeBytes),
    low_disk: free < config.limits.reserveFreeBytes * 1.5,
    parts_gb: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, gb(v)])),
  };
}
