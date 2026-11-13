import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, signedInAdmin, signedUpUser } from './helpers.js';

let t, admin;
before(async () => { t = await boot({ SITE_URL: 'https://films.example.test' }); admin = await signedInAdmin(t); });
after(async () => { await t.close(); });
const SLUGS = ['story', 'law', 'books', 'speaking', 'family'];

test('each text page is served with its own title and canonical, appears in the sitemap and has the client\'s content', async () => {
  const facts = { story: ['Wardha, Akola and Solapur', 'Gold Medal', 'left the IPS in 2004', 'The rot in the police machinery'], law: ['Raheja Centre', 'Nariman Point', 'Police training for investigation'], books: ['Carnage by Angels', 'Vultures in Love', 'Indian Supari Company', 'Kya Yahi Sach Hai'], speaking: ['@lifetainmentenglish', '@lifetainmenthindi', 'Whistleblowing', 'powerful and clean'], family: ['Samar Bahadur Singh', 'Abha Singh', 'Isha Singh'] };
  const map = (await t.client().get('/sitemap.xml')).text;
  for (const slug of SLUGS) {
    const d = (await t.client().get(`/api/page/${slug}`)).json; assert.ok(d.title && d.eyebrow && d.lede && d.body, slug);
    for (const f of facts[slug]) assert.ok(d.body.includes(f), `${slug} mentions ${f}`);
    assert.equal(d.pages.length, 5);
    const html = await t.client().get(`/${slug}`); assert.equal(html.status, 200);
    assert.match(html.text, new RegExp(`rel="canonical" href="https://films\\.example\\.test/${slug}"`)); assert.ok(map.includes(`/${slug}<`));
  }
});

test('unknown page names, including object-prototype names, are 404', async () => {
  for (const bad of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '..%2fetc']) assert.equal((await t.client().get(`/api/page/${bad}`)).status, 404, bad);
});

test('the admin edits pages (length checked, admin only); edited text is public; reset to nothing is not allowed', async () => {
  const user = await signedUpUser(t, 'pg@example.com');
  assert.equal((await user.get('/api/admin/pages')).status, 403); assert.equal((await user.put('/api/admin/pages', { law: 'x'.repeat(50) })).status, 403); assert.equal((await t.client().put('/api/admin/pages', {})).status, 401);
  const list = (await admin.get('/api/admin/pages')).json.pages; assert.equal(list.length, 5); assert.ok(list.every((p) => !p.customised && p.body.length > 50));
  assert.equal((await admin.put('/api/admin/pages', { law: 'short' })).status, 400); assert.equal((await admin.put('/api/admin/pages', { law: 'y'.repeat(30001) })).status, 400);
  assert.equal((await admin.put('/api/admin/pages', { law: '## New heading\nA new paragraph written by the owner for the law page.', nonsense: 'ignored' })).status, 200);
  assert.match((await t.client().get('/api/page/law')).json.body, /A new paragraph written by the owner/);
  assert.equal((await admin.get('/api/admin/pages')).json.pages.find((p) => p.slug === 'law').customised, true);
});

test('contact details, WhatsApp, Instagram handles and cards come from the client\'s inputs and are editable', async () => {
  const s = (await t.client().get('/api/site')).json.settings;
  assert.equal(s.contact_email, 'ypsinghfilms@gmail.com'); assert.equal(s.contact_whatsapp.replace(/\D/g, ''), '919821008221'); assert.match(s.contact_location, /Raheja Centre.*Nariman Point.*400021/);
  assert.equal(s.social_instagram_en, 'https://www.instagram.com/lifetainmentenglish/'); assert.equal(s.social_instagram_hi, 'https://www.instagram.com/lifetainmenthindi/');
  assert.equal(s.hero_roles, 'Former IPS Officer, Lawyer, Author, Filmmaker'); assert.match(s.hero_tagline, /^Twenty years in uniform\./);
  assert.equal(s.pillars.split('\n').length, 4); assert.match(s.quote, /rot in the police machinery/);
  assert.equal((await admin.put('/api/admin/settings', { pillars: 'A|B|/law', contact_whatsapp: '+91 99999 99999' })).status, 200);
  assert.equal((await t.client().get('/api/site')).json.settings.pillars, 'A|B|/law');
});

test('the journey shows the client\'s timeline, and the home page has the three start links', async () => {
  const works = (await t.client().get('/api/site')).json.works.map((w) => w.title);
  for (const w of ['Indian Police Service', 'Law degree and Gold Medal', 'Carnage by Angels', 'Vultures in Love', 'Kya Yahi Sach Hai', 'Indian Supari Company']) assert.ok(works.includes(w), w);
  const home = (await t.client().get('/')).text; for (const id of ['sl-en', 'sl-hi', 'href="/films"']) assert.ok(home.includes(id), id);
  const contact = (await t.client().get('/js/contact.js')).text; assert.match(contact, /wa\.me/);
});

test('an unedited placeholder journey from an older install is replaced once; an edited one is left alone', () => {
  const run = (dir, script) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: dir, JWT_SECRET: 'x'.repeat(40) } }).stdout.trim();
  const OLD = ['Indian Police Service', 'Lawyer & activist, Mumbai', 'Carnage by Angels', 'Kya Yahi Sach Hai', 'Motivational speaking'];
  const prep = (titles) => `const { db } = await import('./server/db.js'); db.exec('DELETE FROM works'); for (const t of ${JSON.stringify(titles)}) db.prepare("INSERT INTO works (kind,title,subtitle,period,sort) VALUES ('career',?, '', '', 1)").run(t); db.exec('PRAGMA user_version = 11'); db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('works_seeded','1')").run();`;
  const count = `const { db } = await import('./server/db.js'); console.log(JSON.stringify([db.prepare('SELECT COUNT(*) c FROM works').get().c, !!db.prepare("SELECT 1 FROM settings WHERE key='works_seeded'").get(), db.prepare('PRAGMA user_version').get().user_version]));`;
  const untouched = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-mig-')); run(untouched, prep(OLD)); assert.deepEqual(JSON.parse(run(untouched, count)), [0, false, 12], 'old seed removed, flag cleared so the new journey is seeded at start-up');
  const edited = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-mig-')); run(edited, prep([...OLD.slice(0, 4), 'My own entry'])); assert.deepEqual(JSON.parse(run(edited, count)), [5, true, 12], 'owner\'s edits are never touched');
});
