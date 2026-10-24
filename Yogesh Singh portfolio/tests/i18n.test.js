import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedInAdmin } from './helpers.js';

let t, admin;
before(async () => { t = await boot(); admin = await signedInAdmin(t); });
after(async () => { await t.close(); });

test('the Hindi dictionary is well formed: every entry is non-empty Devanagari, placeholders match, patterns work', async () => {
  const { DICT, PATTERNS } = await import('../public/js/i18n-hi.js');
  for (const [en, hi] of Object.entries(DICT)) {
    assert.ok(hi.trim().length > 0, en); assert.ok(/[ऀ-ॿ]|^(Google ✓|YouTube|Facebook|LinkedIn)$/.test(hi), `${en} has no Devanagari`);
    assert.deepEqual(en.match(/[₹][\d,.]+|\d{3,}/g) || [], hi.match(/[₹][\d,.]+|\d{3,}/g) || [], `numbers changed in: ${en}`);
  }
  const run = (s) => PATTERNS.reduce((acc, [re, fn]) => acc ?? (re.test(s) ? s.replace(re, fn) : undefined), undefined);
  assert.equal(run('Hello, Ravi'), 'नमस्ते, Ravi'); assert.equal(run('First 30 min free'), 'पहले 30 मिनट मुफ़्त');
  assert.match(run('You are watching the free preview: the first 30 minutes. When it ends, a one-time payment of ₹299 unlocks the rest of the film.'), /पहले 30 मिनट.*₹299/);
  assert.equal(run('Reels (3)'), 'रील (3)'); assert.equal(run('45 min watched of 150'), '45 मिनट देखा (कुल 150)');
});

test('every Hindi content field has a starting translation and the English field it belongs to', async () => {
  const { SITE_DEFAULTS, HI_KEYS } = await import('../server/defaults.js');
  for (const k of HI_KEYS) { assert.ok(k in SITE_DEFAULTS, k); assert.ok(/[ऀ-ॿ]/.test(SITE_DEFAULTS[`${k}_hi`]) || k === 'quote', `${k}_hi`); }
  const s = (await t.client().get('/api/site')).json.settings; assert.ok(s.about_body_hi.includes('योगेश'));
});

test('admin can save Hindi text for site content, films and journey entries; it is returned to the public API', async () => {
  assert.equal((await admin.put('/api/admin/settings', { about_title_hi: 'नया शीर्षक', quote_hi: 'एक उद्धरण' })).status, 200);
  const s = (await t.client().get('/api/site')).json.settings; assert.equal(s.about_title_hi, 'नया शीर्षक'); assert.equal(s.about_title, 'A career in service. A voice for the truth.');
  const id = (await admin.post('/api/admin/movies', { title: 'Hin Film' })).json.id;
  assert.equal((await admin.put(`/api/admin/movies/${id}`, { title: 'Hin Film', title_hi: 'हिन फ़िल्म', description_hi: 'विवरण' })).status, 200);
  assert.equal((await admin.put(`/api/admin/movies/${id}`, { title: 'Hin Film', tagline: 'x' })).status, 200);
  const m = t.db.prepare('SELECT * FROM movies WHERE id = ?').get(id); assert.equal(m.title_hi, 'हिन फ़िल्म', 'edits that omit Hindi keep it'); assert.equal(m.tagline_hi, '');
  t.db.prepare('UPDATE movies SET published = 1, status = ?, validated = 1 WHERE id = ?').run('ready', id);
  assert.equal((await t.client().get('/api/movies/' + m.slug)).json.movie.title_hi, 'हिन फ़िल्म');
  const w = (await admin.post('/api/admin/works', { kind: 'film', title: 'T', title_hi: 'शीर्षक', subtitle_hi: 'उपशीर्षक' })).json.id;
  assert.equal((await t.client().get('/api/site')).json.works.find((x) => x.id === w).title_hi, 'शीर्षक');
});

test('pages ship the toggle and the Hindi hook; legal text and admin stay English', async () => {
  const common = (await t.client().get('/js/common.js')).text; assert.match(common, /localise/); assert.match(common, /initI18n/);
  const i18n = (await t.client().get('/js/i18n.js')).text; assert.match(i18n, /yp-lang/); assert.match(i18n, /\/admin/);
  assert.match((await t.client().get('/privacy')).text, /data-no-i18n/);
  assert.equal((await t.client().get('/js/i18n-hi.js')).status, 200);
});
