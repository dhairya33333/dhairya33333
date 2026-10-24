// Verifies the preview boundary on REAL encoded media: playlist, segment timestamps, A/V sync, seeking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { boot, hasFfmpeg, signedInAdmin, makeVideo, ffprobeJson, uploadAndEncode } from './helpers.js';

const PREVIEW_SEC = 30;
let t, admin, movieId, work, segDur;

// Downloads a playlist and its segments exactly as a player would, into a local folder ffprobe/ffmpeg can open.
async function download(client, url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const pl = await client.get(url);
  assert.equal(pl.status, 200);
  fs.writeFileSync(path.join(dir, 'p.m3u8'), pl.text);
  const names = pl.text.split('\n').filter((l) => l.endsWith('.ts'));
  for (const n of names) {
    const r = await fetch(`${t.base}/media/${movieId}/${n}`, { headers: client.cookie ? { cookie: client.cookie } : {} });
    assert.equal(r.status, 200, n);
    fs.writeFileSync(path.join(dir, n), Buffer.from(await r.arrayBuffer()));
  }
  return { names, text: pl.text };
}
const probeLocal = (dir) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-allowed_extensions', 'ALL', '-show_streams', '-show_format', '-of', 'json', path.join(dir, 'p.m3u8')]).stdout);
// Per-stream media time measured from the actual packets: [first pts, last pts + its duration].
function span(dir, kind) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-allowed_extensions', 'ALL', '-select_streams', kind, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', path.join(dir, 'p.m3u8')], { maxBuffer: 1 << 28 }).stdout.toString().trim().split('\n').map((l) => l.split(',').map(Number)).filter((r) => Number.isFinite(r[0]));
  const start = Math.min(...out.map((r) => r[0])), end = Math.max(...out.map((r) => r[0] + (r[1] || 0)));
  return { start, end, length: end - start };
}
const decodeErrors = (dir, extra = []) => spawnSync('ffmpeg', ['-v', 'error', '-allowed_extensions', 'ALL', ...extra, '-i', path.join(dir, 'p.m3u8'), '-f', 'null', '-']).stderr.toString().trim();

before(async (ctx) => {
  if (!hasFfmpeg) return ctx.skip('ffmpeg not installed');
  t = await boot();
  admin = await signedInAdmin(t);
  work = path.join(t.dataDir, 'work');
  // 23.976 fps film-style source, 48 s, with audio: segment lengths are 6.006 s, not a tidy 6.000
  const src = path.join(t.dataDir, 'ntsc.mp4');
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24000/1001', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '48', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', src]);
  assert.equal(r.status, 0, r.stderr?.toString());
  ({ movieId } = await uploadAndEncode(t, admin, src, { previewMinutes: PREVIEW_SEC / 60 }));
  await admin.put(`/api/admin/movies/${movieId}`, { title: 'Test Film', price_rupees: 299, preview_minutes: PREVIEW_SEC / 60, published: true });
});
after(async () => { if (t) await t.close(); });

test('preview: whole segments only, total media time is at or below the boundary, never above', async () => {
  const dir = path.join(work, 'prev');
  const { names, text } = await download(t.client(), `/media/${movieId}/preview.m3u8`, dir);
  const durs = [...text.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => parseFloat(m[1]));
  segDur = durs[0];
  assert.ok(Math.abs(segDur - 6.006) < 0.02, `segments really are ${segDur}s (non-integer), so this is not a trivial case`);
  const total = durs.reduce((a, b) => a + b, 0);
  assert.ok(total <= PREVIEW_SEC, `${total}s must not pass ${PREVIEW_SEC}s`);
  assert.equal(names.length, 4, 'a 5th segment would end at 30.03 s, past the boundary, so it is excluded');
  const info = probeLocal(dir);
  assert.ok(parseFloat(info.format.duration) <= PREVIEW_SEC + 0.05, `container duration ${info.format.duration}`);
  assert.ok(Math.abs(parseFloat(info.format.duration) - total) < 0.1, 'measured media time matches the playlist');
});

test('preview decodes cleanly end to end and audio/video are in sync', async () => {
  const dir = path.join(work, 'prev');
  assert.equal(decodeErrors(dir), '', 'no decode errors across segment joins');
  const v = span(dir, 'v:0'), a = span(dir, 'a:0');
  assert.ok(Math.abs(v.length - a.length) < 0.25, `video ${v.length.toFixed(3)}s vs audio ${a.length.toFixed(3)}s`);
  assert.ok(Math.abs(v.start - a.start) < 0.25, `start offsets video ${v.start} vs audio ${a.start}`);
  assert.ok(v.length <= PREVIEW_SEC + 0.05 && a.length <= PREVIEW_SEC + 0.05, 'neither stream runs past the boundary');
});

test('segment timestamps are continuous: each starts where the previous ended (no gaps, no overlap)', async () => {
  const dir = path.join(work, 'prev'); const names = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
  let expect = null;
  for (const n of names) {
    const i = ffprobeJson(path.join(dir, n));
    const v = i.streams.find((s) => s.codec_type === 'video');
    const start = parseFloat(v.start_time), dur = parseFloat(v.duration);
    if (expect !== null) assert.ok(Math.abs(start - expect) < 0.1, `${n} starts ${start}, previous ended ${expect}`);
    expect = start + dur;
  }
});

test('seeking inside the preview works; seeking past it finds nothing (the content is not there)', async () => {
  const dir = path.join(work, 'prev');
  const frames = (ss) => spawnSync('ffmpeg', ['-v', 'error', '-allowed_extensions', 'ALL', '-ss', String(ss), '-i', path.join(dir, 'p.m3u8'), '-t', '2', '-f', 'null', '-', '-progress', 'pipe:1']).stdout.toString().match(/frame=(\d+)/g)?.pop()?.split('=')[1] ?? '0';
  assert.ok(Number(frames(10)) > 30, 'seeking to 10 s yields frames');
  assert.ok(Number(frames(23)) > 5, 'seeking near the end yields frames');
  assert.equal(Number(frames(31)), 0, 'seeking to 31 s (past the 30 s boundary) yields no frames');
  assert.equal(Number(frames(40)), 0, 'seeking to 40 s yields no frames');
  // and the server itself will not hand over what lies beyond: segments 5..8 are refused to a visitor
  for (const n of [4, 5, 6, 7]) assert.equal((await t.client().get(`/media/${movieId}/seg_${String(n).padStart(5, '0')}.ts`)).status, 401);
});

test('the full film (for the owner) is complete: same media, ~48 s, in sync, decodes cleanly', async () => {
  const dir = path.join(work, 'full');
  const { names } = await download(admin, `/media/${movieId}/full.m3u8`, dir);
  assert.equal(names.length, 8);
  const info = probeLocal(dir);
  assert.ok(Math.abs(parseFloat(info.format.duration) - 48) < 0.3, `duration ${info.format.duration}`);
  assert.equal(decodeErrors(dir), '');
  const vs = span(dir, 'v:0'), as = span(dir, 'a:0');
  assert.ok(Math.abs(vs.length - as.length) < 0.3, `video ${vs.length} vs audio ${as.length}`);
  assert.ok(Math.abs(vs.length - 48) < 0.3);
  const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
  assert.ok(v.height <= 720 && v.codec_name === 'h264' && a.codec_name === 'aac');
});

test('the preview is a strict prefix of the full film (same segments, same bytes)', async () => {
  for (const n of fs.readdirSync(path.join(work, 'prev')).filter((f) => f.endsWith('.ts'))) {
    assert.ok(fs.readFileSync(path.join(work, 'prev', n)).equals(fs.readFileSync(path.join(work, 'full', n))), n);
  }
});

test('preview boundary exactly at a segment edge (6 s segments, 30 min = 300 whole segments) keeps all 300', async () => {
  const { parsePlaylist } = await import('../server/hls.js');
  const { playlistInfo } = await import('../server/hls.js');
  // synthetic playlist: 2.5 h at 6.000 s per segment, preview 1800 s
  const dir = path.join(t.dirs.media, '9999'); fs.mkdirSync(dir, { recursive: true });
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:0'];
  for (let i = 0; i < 1500; i++) lines.push('#EXTINF:6.000000,', `seg_${String(i).padStart(5, '0')}.ts`);
  lines.push('#EXT-X-ENDLIST'); fs.writeFileSync(path.join(dir, 'index.m3u8'), lines.join('\n'));
  const info = playlistInfo({ id: 9999, preview_sec: 1800 });
  assert.equal(info.previewNames.size, 300); assert.equal(info.previewSeconds, 1800);
  assert.ok(info.previewNames.has('seg_00299.ts') && !info.previewNames.has('seg_00300.ts'));
  assert.equal(parsePlaylist(info.previewPlaylist).segs.length, 300);
  // 29.97 fps film: 6.006 s segments -> 299 segments = 1795.8 s (never 1801.8 s)
  const l2 = ['#EXTM3U', '#EXT-X-TARGETDURATION:7']; for (let i = 0; i < 1500; i++) l2.push('#EXTINF:6.006000,', `seg_${String(i).padStart(5, '0')}.ts`); l2.push('#EXT-X-ENDLIST');
  fs.writeFileSync(path.join(dir, 'index.m3u8'), l2.join('\n')); fs.utimesSync(path.join(dir, 'index.m3u8'), new Date(), new Date(Date.now() + 5000));
  const i2 = playlistInfo({ id: 9999, preview_sec: 1800 });
  assert.equal(i2.previewNames.size, 299); assert.ok(i2.previewSeconds <= 1800);
});
