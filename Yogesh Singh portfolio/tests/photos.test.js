import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { boot, signedInAdmin, signedUpUser, hasFfmpeg } from './helpers.js';

let t, admin, dir;
before(async () => { t = await boot(); admin = await signedInAdmin(t); dir = fs.mkdtempSync(path.join(t.dataDir, 'src-')); });
after(async () => { await t.close(); });

function makeJpeg(name, w = 3000, h = 2000) {
  const f = path.join(dir, name);
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=1`, '-frames:v', '1', f]);
  const b = fs.readFileSync(f), note = Buffer.from('SECRET-GPS-LOCATION');           // a JPEG comment segment right after the start marker
  const seg = Buffer.concat([Buffer.from([0xff, 0xfe, 0, note.length + 2]), note]);
  fs.writeFileSync(f, Buffer.concat([b.subarray(0, 2), seg, b.subarray(2)]));
  return f;
}
const form = (field, files, extra = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(extra)) fd.append(k, v); for (const f of files) fd.append(field, new Blob([f.data]), f.name); return fd; };
const send = (c, url, fd, method = 'POST') => c.req(method, url, { raw: fd });
const read = (n) => ({ name: path.basename(n), data: fs.readFileSync(n) });
const onDisk = (rel) => path.join(t.dirs.uploads, rel.slice('/uploads/'.length));

test('gallery upload is resized, converted to WebP and stripped of metadata', { skip: !hasFfmpeg }, async () => {
  const jpg = makeJpeg('big.jpg');
  assert.ok(fs.readFileSync(jpg).includes('SECRET-GPS-LOCATION'), 'fixture really carries metadata');
  const r = await send(admin, '/api/admin/gallery', form('files', [read(jpg)], { caption: 'On set' }));
  assert.equal(r.status, 200, r.text); assert.equal(r.json.added, 1);
  const item = (await t.client().get('/api/gallery')).json.items[0];
  assert.equal(item.caption, 'On set'); assert.match(item.src, /^\/uploads\/gallery\/[0-9a-f]+\.webp$/); assert.ok(item.thumb.endsWith('-t.webp'));
  assert.ok(item.w <= 1800 && item.w > 1000 && item.h > 0);
  for (const rel of [item.src, item.thumb]) {
    const bytes = fs.readFileSync(onDisk(rel));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.ok(!bytes.includes('SECRET-GPS-LOCATION'));
  }
  assert.ok(fs.statSync(onDisk(item.thumb)).size < fs.statSync(onDisk(item.src)).size);
  assert.ok(fs.statSync(onDisk(item.src)).size < fs.statSync(jpg).size);
  assert.equal((await t.client().get(item.thumb)).status, 200);
  assert.deepEqual(fs.readdirSync(t.dirs.tmp).filter((x) => x.startsWith('img-')), [], 'originals are not left behind');
});

test('non-images are rejected even with an image name or extension', { skip: !hasFfmpeg }, async () => {
  const before = (await admin.get('/api/admin/gallery')).json.items.length;
  const fake = { name: 'evil.jpg', data: Buffer.from('<?php echo 1; ?> not an image at all') };
  assert.equal((await send(admin, '/api/admin/gallery', form('files', [fake]))).status, 400);
  assert.equal((await send(admin, '/api/admin/gallery', form('files', [{ name: 'x.svg', data: Buffer.from('<svg onload=alert(1)/>') }]))).status, 400);
  assert.equal((await send(admin, '/api/admin/portrait', form('file', [fake]))).status, 400);
  assert.equal((await admin.get('/api/admin/gallery')).json.items.length, before);
});

test('admin can caption, reorder, hide and delete; hidden photos are not public; files are removed', { skip: !hasFfmpeg }, async () => {
  await send(admin, '/api/admin/gallery', form('files', [read(makeJpeg('b.jpg', 800, 800)), read(makeJpeg('c.jpg', 800, 600))]));
  let items = (await admin.get('/api/admin/gallery')).json.items; assert.equal(items.length, 3);
  const [a, b, c] = items;
  assert.equal((await admin.put(`/api/admin/gallery/${c.id}`, { move: 'up' })).status, 200);
  assert.deepEqual((await admin.get('/api/admin/gallery')).json.items.map((x) => x.id), [a.id, c.id, b.id]);
  await admin.put(`/api/admin/gallery/${c.id}`, { move: 'up' }); await admin.put(`/api/admin/gallery/${c.id}`, { move: 'up' });
  assert.equal((await admin.get('/api/admin/gallery')).json.items[0].id, c.id);
  await admin.put(`/api/admin/gallery/${b.id}`, { hidden: true, caption: 'Edited' });
  const pub = (await t.client().get('/api/gallery')).json.items; assert.ok(!pub.some((x) => x.id === b.id));
  assert.equal((await admin.get('/api/admin/gallery')).json.items.find((x) => x.id === b.id).caption, 'Edited');
  assert.equal((await admin.del(`/api/admin/gallery/${b.id}`)).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!fs.existsSync(onDisk(b.src)) && !fs.existsSync(onDisk(b.thumb)));
  assert.equal((await admin.del('/api/admin/gallery/99999')).status, 404);
});

test('portrait: set, shown in site settings, replaced (old file removed), removed; not editable as free text', { skip: !hasFfmpeg }, async () => {
  assert.equal((await send(admin, '/api/admin/portrait', form('file', [read(makeJpeg('p1.jpg', 2400, 3000))]))).status, 200);
  const first = (await t.client().get('/api/site')).json.settings.portrait;
  assert.match(first, /^\/uploads\/site\/.+\.webp$/);
  await send(admin, '/api/admin/portrait', form('file', [read(makeJpeg('p2.jpg', 1200, 1500))]));
  const second = (await t.client().get('/api/site')).json.settings.portrait; assert.notEqual(first, second);
  await new Promise((r) => setTimeout(r, 300)); assert.ok(!fs.existsSync(onDisk(first)));
  await admin.put('/api/admin/settings', { portrait: 'https://evil.example/x.png' });
  assert.equal((await t.client().get('/api/site')).json.settings.portrait, second);
  await admin.del('/api/admin/portrait'); assert.equal((await t.client().get('/api/site')).json.settings.portrait, '');
});

test('photo admin routes require an admin', async () => {
  const user = await signedUpUser(t, 'v@example.com');
  for (const [m, u] of [['POST', '/api/admin/gallery'], ['POST', '/api/admin/portrait'], ['DELETE', '/api/admin/gallery/1'], ['GET', '/api/admin/gallery']]) {
    assert.equal((await t.client().req(m, u)).status, 401, u); assert.equal((await user.req(m, u)).status, 403, u);
  }
});

test('gallery page is served, in the sitemap and linked in the nav script', async () => {
  const p = await t.client().get('/gallery'); assert.equal(p.status, 200); assert.match(p.text, /<title>Gallery — /);
  assert.ok((await t.client().get('/sitemap.xml')).text.includes('/gallery<'));
  assert.match((await t.client().get('/js/layout.js')).text, /\/gallery/);
});
