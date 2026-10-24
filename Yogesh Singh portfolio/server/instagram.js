import fs from 'node:fs';
import path from 'node:path';
import { dirs } from './config.js';
import { db, getSetting, setSetting } from './db.js';

const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const igDir = path.join(dirs.uploads, 'ig');
fs.mkdirSync(igDir, { recursive: true });

async function saveThumb(id, url) {
  const file = path.join(igDir, `${id}.jpg`);
  // Instagram CDN links expire, so keep our own copy (refreshed every sync).
  const res = await fetch(url);
  if (!res.ok) throw new Error('thumb ' + res.status);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return `/uploads/ig/${id}.jpg`;
}

/** Long-lived tokens last 60 days; refresh roughly monthly so they never lapse. */
async function maybeRefreshToken(token) {
  const last = Number(getSetting('ig_token_refreshed_at', '0'));
  if (Date.now() - last < 1000 * 60 * 60 * 24 * 25) return token;
  try {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.access_token) { setSetting('ig_token', data.access_token); setSetting('ig_token_refreshed_at', Date.now()); return data.access_token; }
  } catch { /* try again next sync */ }
  return token;
}

export async function syncInstagram() {
  let token = getSetting('ig_token');
  if (!token) return { ok: false, message: 'No Instagram access token saved yet.' };
  token = await maybeRefreshToken(token);

  const res = await fetch(`https://graph.instagram.com/me/media?fields=${FIELDS}&limit=24&access_token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    setSetting('ig_last_status', `Failed: ${msg}`);
    return { ok: false, message: msg };
  }

  const upsert = db.prepare(`
    INSERT INTO social_posts (source, ext_id, caption, media_type, thumb, permalink, posted_at)
    VALUES ('instagram', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, ext_id) DO UPDATE SET caption = excluded.caption, media_type = excluded.media_type,
      thumb = excluded.thumb, permalink = excluded.permalink`);
  let count = 0;
  for (const m of data.data || []) {
    const src = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
    let thumb = null;
    try { if (src) thumb = await saveThumb(m.id, src); } catch { /* keep going */ }
    upsert.run(m.id, m.caption || '', m.media_type, thumb, m.permalink, m.timestamp);
    count++;
  }
  setSetting('ig_last_status', `OK · ${count} posts · ${new Date().toISOString()}`);
  return { ok: true, count };
}

export function startInstagramScheduler() {
  const tick = () => syncInstagram().catch((e) => console.error('[instagram]', e.message));
  setTimeout(tick, 15_000);
  setInterval(tick, 60 * 60 * 1000);
}
