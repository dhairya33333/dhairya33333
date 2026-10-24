import fs from 'node:fs';
import path from 'node:path';
import { hlsDir } from './storage.js';

export function parsePlaylist(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const head = [];
  const segs = [];
  let dur = null;
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8));
    else if (l && !l.startsWith('#')) { segs.push({ name: l, dur }); dur = null; }
    else if (!segs.length && l && !l.startsWith('#EXT-X-PLAYLIST-TYPE') && !l.startsWith('#EXTINF')) head.push(l);
  }
  return { head, segs, ended: lines.includes('#EXT-X-ENDLIST') };
}

const cache = new Map();

/**
 * The free preview is every segment that ENDS at or before preview_sec, so playback can never run past the
 * configured limit (it stops at the last whole segment, up to one segment length early). Only these segment
 * names are served to people who have not bought the film.
 */
export function playlistInfo(movie) {
  const file = path.join(hlsDir(movie.id), 'index.m3u8');
  const mtime = fs.statSync(file).mtimeMs;
  const key = `${movie.id}:${mtime}:${movie.preview_sec}`;
  if (cache.has(key)) return cache.get(key);

  const { head, segs } = parsePlaylist(fs.readFileSync(file, 'utf8'));
  let t = 0;
  const preview = [];
  for (const s of segs) {
    if (t + s.dur > movie.preview_sec + 0.001) break;
    preview.push(s); t += s.dur;
  }
  const body = (list) => list.map((s) => `#EXTINF:${s.dur.toFixed(6)},\n${s.name}`).join('\n');
  const info = {
    previewNames: new Set(preview.map((s) => s.name)),
    previewPlaylist: [...head, '#EXT-X-PLAYLIST-TYPE:VOD', body(preview), '#EXT-X-ENDLIST', ''].join('\n'),
    previewSeconds: Math.floor(t),
    hasPreview: preview.length > 0,
  };
  cache.clear();
  cache.set(key, info);
  return info;
}
