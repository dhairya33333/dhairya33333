import fs from 'node:fs';
import path from 'node:path';
import { hlsDir } from './transcode.js';

const cache = new Map();

/** Parse the encoded playlist once and work out which segments belong to the free preview. */
export function playlistInfo(movie) {
  const file = path.join(hlsDir(movie.id), 'index.m3u8');
  const mtime = fs.statSync(file).mtimeMs;
  const key = `${movie.id}:${mtime}:${movie.preview_sec}`;
  if (cache.has(key)) return cache.get(key);

  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  const head = [];
  const segs = [];
  let dur = null;
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8));
    else if (l && !l.startsWith('#')) { segs.push({ name: l, dur }); dur = null; }
    else if (!segs.length && l && !l.startsWith('#EXT-X-PLAYLIST-TYPE')) head.push(l);
  }
  let t = 0;
  const preview = [];
  for (const s of segs) {
    if (t >= movie.preview_sec) break;
    preview.push(s); t += s.dur;
  }
  const body = (list) => list.map((s) => `#EXTINF:${s.dur.toFixed(6)},\n${s.name}`).join('\n');
  const info = {
    previewNames: new Set(preview.map((s) => s.name)),
    previewPlaylist: [...head, '#EXT-X-PLAYLIST-TYPE:VOD', body(preview), '#EXT-X-ENDLIST', ''].join('\n'),
    previewSeconds: t,
  };
  cache.clear(); // tiny cache, one movie is typically hot
  cache.set(key, info);
  return info;
}
