// Optional browser smoke test (not part of `npm test`; needs Playwright + ffmpeg).
//   DATA_DIR=/tmp/yp-e2e GOOGLE_CLIENT_ID=test.apps.googleusercontent.com PORT=3333 node server/index.js &
//   node scripts/create-admin.js Admin admin@test.com 'admin-password-123'   (same DATA_DIR)
//   NODE_PATH=$(npm root -g) node tests/e2e/smoke.cjs /tmp/out-dir
const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const B = process.env.BASE || 'http://localhost:3333', OUT = process.argv[2] || '/tmp';
(async () => {
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30', '-pix_fmt', 'yuv420p', OUT + '/e2e.mp4']);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // stub Google's script so the button wiring can be exercised offline
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(o){window.__cb=o.callback},renderButton(el){el.innerHTML='<button id="fake-google">Continue with Google</button>';el.firstChild.onclick=()=>window.__cb('x'.repeat(40))}}}}` }));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  await p.goto(B + '/login.html'); await p.waitForSelector('#fake-google');
  await p.click('#fake-google'); await p.waitForFunction(() => { const t = document.querySelector('#msg').textContent; return t.length > 0 && !/Signing/.test(t); });
  ok(/Google sign-in/.test(await p.textContent('#msg')), 'Google button: invalid token shows a clear error, no sign-in');

  await p.fill('input[name=email]', 'admin@test.com'); await p.fill('input[name=password]', 'admin-password-123'); await p.click('#go'); await p.waitForURL(B + '/');
  await p.goto(B + '/admin#films'); await p.fill('#nt', 'E2E Film'); await p.click('#nadd'); await p.waitForSelector('#vid');
  await p.fill('#f-tag', 'A tagline'); await p.fill('#f-desc', 'Description text'); await p.fill('#f-prev', '0.2'); await p.click('#save');
  await p.setInputFiles('#vid', OUT + '/e2e.mp4');
  await p.waitForFunction(() => /Ready to stream/.test(document.body.innerText), null, { timeout: 90000, polling: 1000 });
  ok(true, 'Admin UI: chunked upload + encode finished and passed validation');
  await p.screenshot({ path: OUT + '/e2e-admin-film.png' });
  await p.check('#f-pub'); await p.check('#f-feat'); await p.click('#save'); await p.waitForTimeout(500);

  await p.goto(B + '/films'); await p.waitForSelector('.fcard');
  ok((await p.textContent('.fcard')).includes('E2E Film'), 'Library page lists the film');
  await p.screenshot({ path: OUT + '/e2e-films.png' });

  const vctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const v = await vctx.newPage();; /* separate browser profile: a real viewer, not the admin */ await v.goto(B + '/film/e2e-film'); await v.waitForTimeout(2500);
  ok(/free preview/i.test(await v.textContent('#preview-note')), 'Film page explains the free preview');
  await v.screenshot({ path: OUT + '/e2e-film.png' });
  await v.evaluate(() => { const x = document.getElementById('video'); x.muted = true; x.currentTime = x.duration - 0.3; x.play(); });
  await v.waitForSelector('#paywall.show', { timeout: 15000 }); ok(true, 'Paywall appears when the preview ends');
  const dur = await v.evaluate(() => document.getElementById('video').duration);
  ok(dur <= 12.1, `Preview duration ${dur}s respects the 12 s boundary`);
  await v.click('#paywall-buy'); await v.waitForURL(/login/);
  await v.click('#sw'); await v.fill('input[name=name]', 'Viewer'); await v.fill('input[name=email]', 'v@e2e.com'); await v.fill('input[name=password]', 'password-12345'); await v.click('#go');
  await v.waitForURL(/film\/e2e-film/); await v.waitForSelector('#modal.open'); await v.fill('#phone', '9876543210'); await v.screenshot({ path: OUT + '/e2e-modal.png' });
  await v.click('#pay-go'); await v.waitForFunction(() => document.getElementById('badge').textContent === 'Full film', null, { timeout: 15000 });
  const full = await v.evaluate(() => new Promise((r) => { const x = document.getElementById('video'); x.addEventListener('durationchange', () => r(x.duration)); if (x.duration) r(x.duration); }));
  ok(full > 25, `After purchase the whole film plays (${full}s)`);
  await v.screenshot({ path: OUT + '/e2e-film-owned.png' });
  console.log(errs.length ? 'JS errors: ' + errs.join(' | ') : 'No JS errors'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
