import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, signedInAdmin, signedUpUser } from './helpers.js';

let t, admin, S, parseSubtitles, toVtt, trimToPreview, parseCredits;
before(async () => {
  t = await boot({ RATE_LIMIT_AUTH: '500' }); admin = await signedInAdmin(t);
  ({ parseSubtitles, toVtt, trimToPreview } = await import('../server/subtitles.js')); ({ parseCredits } = await import('../server/routes/public.js'));
  t.db.prepare("INSERT INTO movies (slug, title, price_paise, preview_sec, duration_sec, published, status, validated) VALUES ('extras','Extras Film',9900,60,600,1,'ready',1)").run();
  S = t.db.prepare("SELECT * FROM movies WHERE slug = 'extras'").get();
  const dir = path.join(t.dirs.media, String(S.id)); fs.mkdirSync(dir, { recursive: true });       // a playlist is enough: no segments are fetched here
  fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n' + Array.from({ length: 100 }, (_, i) => `#EXTINF:6.000,\nseg_${String(i).padStart(5, '0')}.ts`).join('\n') + '\n#EXT-X-ENDLIST\n');
});
after(async () => { await t.close(); });

const SRT = `1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>there</i><script>alert(1)</script>\r\n\r\n2\r\n00:00:58,000 --> 00:01:05,000\r\nStraddles the end\r\n\r\n3\r\n00:02:00,000 --> 00:02:04,000\r\nThe secret ending is paid\r\n`;
const form = (o, file) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.append(k, v); if (file) fd.append('file', new Blob([file]), 'x.srt'); return fd; };

test('SRT is parsed to clean WebVTT: no scripts, only i/b/u kept, times converted, junk rejected', () => {
  const cues = parseSubtitles(SRT); assert.equal(cues.length, 3);
  const vtt = toVtt(cues); assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:03\.500\nHello <i>there<\/i>alert\(1\)/); assert.ok(!vtt.includes('<script'));
  assert.equal(parseSubtitles(vtt).length, 3, 'round trip through VTT');
  assert.throws(() => parseSubtitles('just some prose'), /No subtitles/); assert.throws(() => parseSubtitles('a\u0000b'), /subtitle/);
});

test('preview trimming drops cues after the free window and cuts a straddling cue', () => {
  const out = trimToPreview(parseSubtitles(SRT), 60); assert.equal(out.length, 2); assert.equal(out[1].end, 60);
});

test('credits parse "Role|Name" lines and ignore malformed ones', () => {
  assert.deepEqual(parseCredits('Director|A B\nbadline\n|x\nCast | C D '), [{ role: 'Director', name: 'A B' }, { role: 'Cast', name: 'C D' }]);
});

test('admin adds subtitles and credits; validation and permissions hold', async () => {
  const add = (o, f) => admin.req('POST', `/api/admin/movies/${S.id}/subtitles`, { raw: form(o, f) });
  assert.equal((await add({ lang: 'en', label: 'English' }, SRT)).status, 200);
  assert.equal((await add({ lang: 'hi', label: 'Hindi' }, SRT)).status, 200);
  assert.equal((await add({ lang: 'e', label: 'x' }, SRT)).status, 400); assert.equal((await add({ lang: '../x', label: 'x' }, SRT)).status, 400);
  assert.equal((await add({ lang: 'fr', label: '' }, SRT)).status, 400); assert.equal((await add({ lang: 'fr', label: 'French' }, 'not subtitles')).status, 400);
  assert.equal((await add({ lang: 'en', label: 'English (new)' }, SRT)).status, 200, 'same language replaces');
  assert.equal((await admin.get(`/api/admin/movies/${S.id}/subtitles`)).json.items.length, 2);
  assert.equal((await admin.put(`/api/admin/movies/${S.id}`, { title: 'Extras Film', published: true, credits: 'Director|Yogesh Pratap Singh\nCast|Someone' })).status, 200);
  const user = await signedUpUser(t, 'sub@example.com');
  assert.equal((await user.req('POST', `/api/admin/movies/${S.id}/subtitles`, { raw: form({ lang: 'en', label: 'x' }, SRT) })).status, 403);
  const film = (await t.client().get('/api/movies/extras')).json.movie; assert.deepEqual(film.credits[0], { role: 'Director', name: 'Yogesh Pratap Singh' });
  assert.equal((await admin.put(`/api/admin/movies/${S.id}`, { title: 'Extras Film', published: true })).status, 200);
  assert.equal((await t.client().get('/api/movies/extras')).json.movie.credits.length, 2, 'saving without credits keeps them');
});

test('subtitle tracks: listed in playback, preview-only for non-buyers, whole for buyers, 404 for bad input', async () => {
  const pb = (await t.client().get('/api/movies/extras/playback')).json; assert.deepEqual(pb.subtitles.map((x) => x.lang), ['en', 'hi'].sort((a, b) => (a === 'en' ? 'English (new)' : 'Hindi').localeCompare(b === 'en' ? 'English (new)' : 'Hindi')));
  const anon = await t.client().get(pb.subtitles[0].url); assert.equal(anon.status, 200); assert.match(anon.headers.get('content-type'), /text\/vtt/);
  assert.match(anon.text, /Hello/); assert.ok(!anon.text.includes('secret ending'), 'paid cues are not sent to non-buyers');
  assert.match(anon.text, /00:00:58\.000 --> 00:01:00\.000/);
  const buyer = await signedUpUser(t, 'buyer-sub@example.com'); const uid = t.db.prepare("SELECT id FROM users WHERE email='buyer-sub@example.com'").get().id;
  assert.ok(!(await buyer.get(pb.subtitles[0].url)).text.includes('secret ending'), 'signed in but not bought');
  t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (?, ?)').run(uid, S.id);
  assert.match((await buyer.get(pb.subtitles[0].url)).text, /secret ending/);
  for (const bad of ['/api/movies/extras/subtitles/xx.vtt', '/api/movies/nope/subtitles/en.vtt', '/api/movies/extras/subtitles/..%2f..%2fetc.vtt']) assert.equal((await t.client().get(bad)).status, 404, bad);
  assert.equal((await admin.del(`/api/admin/movies/${S.id}/subtitles/hi`)).status, 200); assert.equal((await admin.del(`/api/admin/movies/${S.id}/subtitles/hi`)).status, 404);
});

test('server-side progress: needs sign-in, is capped to what the viewer may watch, follows the account, appears in "continue watching"', async () => {
  const c = await signedUpUser(t, 'resume@example.com');
  assert.equal((await t.client().post('/api/progress', { slug: 'extras', position: 100 })).status, 401);
  assert.equal((await c.post('/api/progress', { slug: 'extras', position: 'x' })).status, 400); assert.equal((await c.post('/api/progress', { slug: 'nope', position: 5 })).status, 400);
  assert.equal((await c.post('/api/progress', { slug: 'extras', position: 400 })).status, 200);
  assert.equal((await c.get('/api/progress/extras')).json.position, 60, 'free viewer capped at the preview');
  assert.equal((await c.get('/api/my/continue')).json.items.length, 1);
  const uid = t.db.prepare("SELECT id FROM users WHERE email='resume@example.com'").get().id;
  t.db.prepare('INSERT INTO purchases (user_id, movie_id) VALUES (?, ?)').run(uid, S.id);
  await c.post('/api/progress', { slug: 'extras', position: 400 });
  assert.equal((await c.get('/api/progress/extras')).json.position, 400);
  const other = t.client(); assert.equal((await other.post('/api/auth/login', { email: 'resume@example.com', password: 'password-12345' })).status, 200);
  assert.equal((await other.get('/api/progress/extras')).json.position, 400, 'a second device sees it');
  assert.equal((await c.get('/api/my/continue')).json.items[0].position_sec, 400);
  await c.post('/api/progress', { slug: 'extras', position: 590 }); assert.equal((await c.get('/api/my/continue')).json.items.length, 0, 'finished films are not offered again');
  const stranger = await signedUpUser(t, 'stranger@example.com'); assert.equal((await stranger.get('/api/progress/extras')).json.position, 0, 'progress is per account');
});

test('the film page ships the credits, track and progress code', async () => {
  assert.match((await t.client().get('/film/extras')).text, /id="credits"/);
  const js = (await t.client().get('/js/film.js')).text; assert.match(js, /\/progress/); assert.match(js, /kind: 'subtitles'/);
});
