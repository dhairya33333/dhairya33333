import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, hasFfmpeg, signedInAdmin, signedUpUser, makeVideo, ffprobeJson, uploadAndEncode, hmacHex } from './helpers.js';

const WH = 'whsec_stream', KEY = 'key_secret_stream';
const SRC_SECONDS = 36;          // 6 segments of 6 s
const PREVIEW_MIN = 0.3;         // 18 s -> exactly 3 free segments
let t, admin, movieId, mediaDir;

before(async (ctx) => {
  if (!hasFfmpeg) return ctx.skip('ffmpeg not installed');
  t = await boot({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: KEY, RAZORPAY_WEBHOOK_SECRET: WH });
  admin = await signedInAdmin(t);
  const src = makeVideo(path.join(t.dataDir, 'src.mp4'), SRC_SECONDS);
  ({ movieId } = await uploadAndEncode(t, admin, src, { previewMinutes: PREVIEW_MIN }));
  const pub = await admin.put(`/api/admin/movies/${movieId}`, { title: 'Test Film', price_rupees: 299, preview_minutes: PREVIEW_MIN, published: true });
  assert.equal(pub.status, 200, pub.text);
  mediaDir = path.join(t.dirs.media, String(movieId));
});
after(async () => { if (t) await t.close(); });

const seg = (n) => `seg_${String(n).padStart(5, '0')}.ts`;

test('encoding produced a validated 720p-or-smaller H.264/AAC HLS set with in-sync audio', () => {
  const m = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  assert.equal(m.status, 'ready'); assert.equal(m.validated, 1); assert.equal(m.encode_state, 'idle');
  assert.equal(m.segments, 6); assert.ok(m.output_bytes > 0); assert.ok(m.encode_seconds > 0);
  const playlist = fs.readFileSync(path.join(mediaDir, 'index.m3u8'), 'utf8');
  assert.match(playlist, /#EXT-X-ENDLIST/);
  const info = ffprobeJson(path.join(mediaDir, seg(1)));
  const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264'); assert.equal(a.codec_name, 'aac');
  assert.ok(v.height <= 360, 'a 360p source is not upscaled to 720p');
  assert.ok(Math.abs(parseFloat(v.duration) - parseFloat(a.duration)) < 0.3, 'audio and video durations match');
  assert.ok(Math.abs(parseFloat(info.format.duration) - 6) < 0.6, 'segments are ~6 s');
  assert.ok(fs.existsSync(t.dirs.source) && fs.readdirSync(t.dirs.source).length === 1, 'original is still on disk');
});

test('upload tracking: the upload row reached "completed"', () => {
  assert.equal(t.db.prepare('SELECT status FROM uploads WHERE movie_id = ?').get(movieId).status, 'completed');
});

test('preview playlist is public and ends at or before the configured boundary', async () => {
  const r = await t.client().get(`/media/${movieId}/preview.m3u8`);
  assert.equal(r.status, 200);
  const names = r.text.split('\n').filter((l) => l.endsWith('.ts'));
  const total = [...r.text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + parseFloat(m[1]), 0);
  assert.deepEqual(names, [seg(0), seg(1), seg(2)]);
  assert.ok(total <= PREVIEW_MIN * 60 + 0.01, `preview ${total}s must not exceed ${PREVIEW_MIN * 60}s`);
  assert.match(r.text, /#EXT-X-ENDLIST/);
});

test('the preview never overshoots: boundary that falls mid-segment stops at the previous segment', async () => {
  t.db.prepare('UPDATE movies SET preview_sec = 20 WHERE id = ?').run(movieId);   // 20 s lands inside the 4th segment
  const r = await t.client().get(`/media/${movieId}/preview.m3u8`);
  assert.equal(r.text.split('\n').filter((l) => l.endsWith('.ts')).length, 3, 'only whole segments that end by 20 s');
  assert.equal((await t.client().get(`/media/${movieId}/${seg(3)}`)).status, 401);
  t.db.prepare('UPDATE movies SET preview_sec = ? WHERE id = ?').run(PREVIEW_MIN * 60, movieId);
});

test('anonymous: free segments play, paid segments and the full playlist are refused', async () => {
  const c = t.client();
  for (const n of [0, 1, 2]) assert.equal((await c.get(`/media/${movieId}/${seg(n)}`)).status, 200, `free ${n}`);
  for (const n of [3, 4, 5]) assert.equal((await c.get(`/media/${movieId}/${seg(n)}`)).status, 401, `paid ${n}`);
  assert.equal((await c.get(`/media/${movieId}/full.m3u8`)).status, 401);
});

test('signed-in but unpaid: still refused (403) on paid content', async () => {
  const c = await signedUpUser(t, 'unpaid@example.com');
  assert.equal((await c.get(`/media/${movieId}/full.m3u8`)).status, 403);
  assert.equal((await c.get(`/media/${movieId}/${seg(5)}`)).status, 403);
  assert.equal((await c.get(`/media/${movieId}/${seg(1)}`)).status, 200);
});

test('direct requests cannot bypass the gate: odd filenames, traversal, raw playlist, bad ids', async () => {
  const c = t.client();
  for (const u of [
    `/media/${movieId}/index.m3u8`, `/media/${movieId}/seg_3.ts`, `/media/${movieId}/${seg(3)}.bak`, `/media/${movieId}/..%2f..%2fportfolio.sqlite`,
    `/media/${movieId}/%2e%2e/%2e%2e/portfolio.sqlite`, `/media/${movieId}/seg_00001.ts%00.m3u8`, `/media/abc/preview.m3u8`, `/media/0/preview.m3u8`,
    `/media/${movieId}x/preview.m3u8`, `/media/99999/preview.m3u8`, `/media/${movieId}/${seg(99)}`,
  ]) {
    const r = await c.get(u);
    assert.ok([400, 401, 404].includes(r.status), `${u} -> ${r.status}`);
    assert.ok(!r.text.includes('SQLite format'), `${u} leaked the database`);
  }
  assert.equal((await c.get('/media/..%2fportfolio.sqlite')).status, 404);
});

test('the playback endpoint tells the player what it may load', async () => {
  const slug = t.db.prepare('SELECT slug FROM movies WHERE id = ?').get(movieId).slug;
  const anon = await t.client().get(`/api/movies/${slug}/playback`);
  assert.equal(anon.json.mode, 'preview'); assert.equal(anon.json.url, `/media/${movieId}/preview.m3u8`);
  assert.equal(anon.json.previewSeconds, 18);
  assert.equal((await admin.get(`/api/movies/${slug}/playback`)).json.mode, 'full');
});

test('unpublished films are invisible to the public, visible to admin', async () => {
  await admin.put(`/api/admin/movies/${movieId}`, { title: 'Test Film', published: false, price_rupees: 299, preview_minutes: PREVIEW_MIN });
  assert.equal((await t.client().get(`/media/${movieId}/preview.m3u8`)).status, 404);
  assert.equal((await t.client().get(`/media/${movieId}/${seg(0)}`)).status, 404);
  assert.equal((await admin.get(`/media/${movieId}/full.m3u8`)).status, 200);
  await admin.put(`/api/admin/movies/${movieId}`, { title: 'Test Film', published: true, price_rupees: 299, preview_minutes: PREVIEW_MIN });
});

test('payment completion followed by successful playback; another user gets nothing from it', async () => {
  const buyer = await signedUpUser(t, 'buyer@example.com');
  const other = await signedUpUser(t, 'bystander@example.com');
  assert.equal((await buyer.get(`/media/${movieId}/full.m3u8`)).status, 403, 'locked before paying');

  // real checkout route (gateway call mocked) then a signed webhook, exactly as Razorpay would send it
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).startsWith('https://api.razorpay.com') ? new Response(JSON.stringify({ id: 'order_STREAM1' }), { status: 200 }) : realFetch(u, i);
  const co = await buyer.post('/api/payments/checkout', { agree: true, movieId });
  globalThis.fetch = realFetch;
  assert.equal(co.status, 200, co.text);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_S1', order_id: 'order_STREAM1', amount: 29900, currency: 'INR' } } } });
  const wh = await t.client().req('POST', '/api/payments/webhook', { raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex(WH, raw), 'x-razorpay-event-id': 'evt_stream' } });
  assert.equal(wh.status, 200);

  const full = await buyer.get(`/media/${movieId}/full.m3u8`);
  assert.equal(full.status, 200);
  assert.equal(full.text.split('\n').filter((l) => l.endsWith('.ts')).length, 6, 'whole film');
  for (let n = 0; n < 6; n++) assert.equal((await buyer.get(`/media/${movieId}/${seg(n)}`)).status, 200);
  const slug = t.db.prepare('SELECT slug FROM movies WHERE id = ?').get(movieId).slug;
  assert.equal((await buyer.get(`/api/movies/${slug}/playback`)).json.mode, 'full');

  // IDOR: nothing a client sends can borrow the buyer's entitlement
  assert.equal((await other.get(`/media/${movieId}/full.m3u8?user=${co.json.orderId}&uid=1`)).status, 403);
  assert.equal((await other.get(`/media/${movieId}/${seg(5)}`, { headers: { 'x-user-id': '2' } })).status, 403);
  assert.equal((await other.get('/api/my/purchases')).json.purchases.length, 0);

  // refund revokes immediately, on the very next request
  const refund = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rf1', payment_id: 'pay_S1', amount: 29900 } }, payment: { entity: { id: 'pay_S1', order_id: 'order_STREAM1', amount: 29900 } } } });
  await t.client().req('POST', '/api/payments/webhook', { raw: refund, headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex(WH, refund), 'x-razorpay-event-id': 'evt_rf' } });
  assert.equal((await buyer.get(`/media/${movieId}/full.m3u8`)).status, 403);
  assert.equal((await buyer.get(`/media/${movieId}/${seg(5)}`)).status, 403);
});

test('the film page and library data never expose private paths', async () => {
  const site = await t.client().get('/api/site');
  assert.ok(!site.text.includes(t.dataDir) && !site.text.includes('source_file') && !site.text.includes('/private/'));
});
