// Page weight report: how many bytes (raw and gzip) a first visit downloads for each public page, counting the page, its
// stylesheets and scripts (including modules they import) and its API data. External fonts are not counted.
//   BASE_URL=http://localhost:3000 npm run measure-pages
import zlib from 'node:zlib';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const get = async (path) => { const r = await fetch(BASE + path); const b = Buffer.from(await r.arrayBuffer()); return { ok: r.ok, raw: b.length, gz: zlib.gzipSync(b, { level: 6 }).length, text: b.toString('utf8') }; };
const refs = (html, base = '/') => [...html.matchAll(/(?:href|src)="([^"#]+\.(?:css|js))"/g)].map((m) => m[1]).filter((u) => u.startsWith('/'));
const imports = (js, from) => [...js.matchAll(/from\s+'(\.\/[^']+|\/[^']+)'|import\('(\.\/[^']+)'\)/g)].map((m) => { const u = m[1] || m[2]; return u.startsWith('/') ? u : new URL(u, BASE + from).pathname; });

const PAGES = [['Home', '/', ['/api/site', '/api/social']], ['Films', '/films', ['/api/site']], ['Film', '/film/kya-yahi-sach-hai', ['/api/movies/kya-yahi-sach-hai', '/api/movies/kya-yahi-sach-hai/playback']], ['About', '/about', ['/api/site']], ['Gallery', '/gallery', ['/api/site', '/api/gallery']], ['Social', '/social', ['/api/site', '/api/social']], ['Contact', '/contact', ['/api/site']], ['Sign in', '/login.html', ['/api/auth/config']]];
const rows = [];
for (const [name, url, api] of PAGES) {
  const page = await get(url); if (!page.ok) { rows.push([name, 'unavailable']); continue; }
  const seen = new Map(), queue = refs(page.text);
  while (queue.length) {
    const u = queue.shift(); if (seen.has(u)) continue; const a = await get(u); seen.set(u, a);
    if (u.endsWith('.js')) queue.push(...imports(a.text, u));
  }
  let raw = page.raw, gz = page.gz; for (const a of [...seen.values(), ...(await Promise.all(api.map(get)))]) { raw += a.raw; gz += a.gz; }
  rows.push([name, `${(raw / 1024).toFixed(0)} KB`, `${(gz / 1024).toFixed(0)} KB`, seen.size + 1 + api.length]);
}
console.log('Page'.padEnd(10), 'raw'.padStart(8), 'gzip'.padStart(8), 'requests'.padStart(9));
for (const r of rows) console.log(String(r[0]).padEnd(10), String(r[1]).padStart(8), String(r[2] ?? '').padStart(8), String(r[3] ?? '').padStart(9));
