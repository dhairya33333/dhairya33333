// Optional browser check of About / Contact / Social / admin Inbox (Playwright + a running server).
//   DATA_DIR=/tmp/yp-pages PORT=3444 node server/index.js &   (with an admin: admin@test.com / admin-password-123)
//   NODE_PATH=$(npm root -g) node tests/e2e/pages.cjs /tmp/out-dir
// Instagram is replaced by a local stand-in, because the real embed needs internet access.
const { chromium } = require('playwright');
(async () => {
  const S = process.argv[2], B = 'http://localhost:3444'; const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  // stand-in for Instagram's embed pages (no internet access here): a plausible-looking embed document
  await ctx.route('https://www.instagram.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<html><body style="margin:0;font-family:sans-serif"><div style="padding:16px;border-bottom:1px solid #eee"><b>yp_singh</b></div><div style="height:480px;background:linear-gradient(135deg,#d9bd82,#8a6d36);display:grid;place-items:center;color:#fff;font-size:30px">Instagram embed (stand-in)</div><div style="padding:16px">Caption text for ${new URL(r.request().url()).pathname}</div></body></html>` }));
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts/.test(m.text()) && errs.push(m.text()));
  // admin adds links
  await p.goto(B + '/login.html'); await p.fill('input[name=email]', 'admin@test.com'); await p.fill('input[name=password]', 'admin-password-123'); await p.click('#go'); await p.waitForURL(B + '/');
  await p.goto(B + '/admin#social'); await p.waitForSelector('#ig-link');
  for (const u of ['https://www.instagram.com/p/DAAAAAAAAA1/', 'https://www.instagram.com/reel/DBBBBBBBBB2/?igsh=x', 'https://www.instagram.com/p/DCCCCCCCCC3/']) { await p.fill('#ig-link', u); await p.click('#ig-add'); await p.waitForTimeout(500); }
  await p.screenshot({ path: S + '/pg-admin-social.png' });
  for (const [name, url] of [['about', '/about'], ['contact', '/contact'], ['social', '/social']]) {
    await p.goto(B + url); await p.waitForTimeout(1800);
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 140)); } scrollTo({ top: 0, behavior: 'instant' }); });
    await p.waitForTimeout(1200);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); console.log(name, 'overflow', o);
    await p.screenshot({ path: `${S}/pg-${name}.png`, fullPage: true });
  }
  // contact: invalid then valid submit
  await p.goto(B + '/contact?topic=speaking'); await p.waitForTimeout(1500);
  await p.click('#go'); await p.waitForTimeout(500); await p.screenshot({ path: S + '/pg-contact-errors.png' });
  await p.fill('input[name=name]', 'Asha Rao'); await p.fill('input[name=email]', 'asha@example.com'); await p.fill('textarea[name=message]', 'We would love to invite him to speak at our annual event.');
  await p.click('#go'); await p.waitForSelector('#sent.show'); await p.waitForTimeout(1600); await p.screenshot({ path: S + '/pg-contact-sent.png' });
  await p.goto(B + '/admin#inbox'); await p.waitForTimeout(900); await p.screenshot({ path: S + '/pg-admin-inbox.png' });
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); await m.route('https://www.instagram.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body>embed</body>' }));
  for (const [name, url] of [['about', '/about'], ['contact', '/contact'], ['social', '/social']]) { await m.goto(B + url); await m.waitForTimeout(1800); const o = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); console.log('mobile', name, 'overflow', o); await m.screenshot({ path: `${S}/pg-m-${name}.png`, fullPage: false }); }
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no JS errors'); await b.close();
})();
