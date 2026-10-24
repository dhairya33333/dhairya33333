// Reads the public preview data (cover image, caption, author) of an Instagram post or reel, the same data link-preview
// services use, so the Social page can show its own professionally laid-out cards. Best effort: Instagram may refuse (login
// wall, rate limit), in which case the post is still added and the admin can upload a cover image instead.
import fs from 'node:fs';
import path from 'node:path';
import { dirs } from './config.js';
import { db } from './db.js';
import { log } from './log.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Only Instagram's own image CDNs may be downloaded from: a page can never make this server fetch an arbitrary address.
const CDN_HOST = /^(?:[a-z0-9-]+\.)+(?:cdninstagram\.com|fbcdn\.net)$/i;
const MAX_IMAGE = 8 * 1024 * 1024, MAX_HTML = 600 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const igDir = path.join(dirs.uploads, 'ig'); fs.mkdirSync(igDir, { recursive: true });

export const decodeHtml = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function meta(html, prop) {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return decodeHtml((a || b)?.[1] || '');
}

/** og:description looks like:  49 likes, 3 comments - username on October 12, 2026: "the caption" */
export function parsePreview(html) {
  const description = meta(html, 'og:description'), title = meta(html, 'og:title');
  const cap = /:\s*["“]([\s\S]*?)["”]\.?\s*$/.exec(description) || /:\s*["“]([\s\S]*?)["”]\s*on Instagram/i.exec(title) || /on Instagram:\s*["“]([\s\S]*)["”]\s*$/i.exec(title);
  const author = /[-–]\s*([A-Za-z0-9._]{1,40}) on /.exec(description)?.[1] || /\(@([A-Za-z0-9._]{1,40})\)/.exec(title)?.[1] || '';
  return { image: meta(html, 'og:image'), caption: (cap?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 600), author };
}

async function limitedBody(res, max) {
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length; if (n > max) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Follows at most 2 redirects, re-checking every hop against the CDN allow-list. */
async function getFromCdn(url, hops = 0) {
  let u; try { u = new URL(url); } catch { throw new Error('bad url'); }
  if (u.protocol !== 'https:' || !CDN_HOST.test(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) throw new Error('image host not allowed');
  const res = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });
  if ([301, 302, 303, 307, 308].includes(res.status) && hops < 2) return getFromCdn(new URL(res.headers.get('location') || '', u).toString(), hops + 1);
  return res;
}

export async function downloadCover(imageUrl, code) {
  const res = await getFromCdn(imageUrl);
  if (!res.ok) throw new Error(`image ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) throw new Error('not an image');
  if (Number(res.headers.get('content-length')) > MAX_IMAGE) throw new Error('too large');
  const buf = await limitedBody(res, MAX_IMAGE);
  const rel = `ig/embed-${code}.${TYPES[type]}`;
  for (const ext of Object.values(TYPES)) if (ext !== TYPES[type]) fs.rmSync(path.join(dirs.uploads, `ig/embed-${code}.${ext}`), { force: true });
  fs.writeFileSync(path.join(dirs.uploads, rel), buf);
  return `/uploads/${rel}`;
}

/** Fetches preview data for one stored embed and fills in cover/caption/author. Never throws; reports what happened. */
export async function refreshEmbed(id) {
  const row = db.prepare("SELECT * FROM social_posts WHERE id = ? AND source = 'embed'").get(id);
  if (!row) return { ok: false, cover: false, note: 'not_found' };
  const kind = row.media_type === 'REEL' ? 'reel' : 'p';
  try {
    const res = await fetch(`https://www.instagram.com/${kind}/${row.ext_id}/`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!res.ok || /\/accounts\/login/.test(res.url || '')) return { ok: true, cover: false, note: 'instagram_asked_for_login' };
    const html = (await limitedBody(res, MAX_HTML).catch(() => Buffer.alloc(0))).toString('utf8');
    const p = parsePreview(html);
    const fields = {};
    if (p.author) fields.author = p.author.slice(0, 40);
    if (p.caption && !row.caption) fields.caption = p.caption;
    let cover = !!row.thumb;
    if (p.image && row.cover_source !== 'uploaded') {
      try { fields.thumb = await downloadCover(p.image, row.ext_id); fields.cover_source = 'fetched'; cover = true; }
      catch (e) { log('warn', 'instagram.cover_failed', { post: id, reason: e.message }); }
    }
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE social_posts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    return { ok: true, cover, note: cover ? 'ok' : (p.image ? 'cover_download_failed' : 'no_preview_data') };
  } catch (e) {
    log('warn', 'instagram.meta_failed', { post: id, reason: e.name === 'TimeoutError' ? 'timeout' : e.message });
    return { ok: true, cover: !!row.thumb, note: 'could_not_reach_instagram' };
  }
}
