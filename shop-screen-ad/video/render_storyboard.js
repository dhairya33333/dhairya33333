const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-gpu','--allow-file-access-from-files'] });
  const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.join(__dirname, 'storyboard2.html'));
  await p.waitForSelector('body[data-ready]'); await p.waitForTimeout(500);
  await p.pdf({ path: path.join(__dirname, 'Devdha-shop-screen-storyboard-v2.pdf'), format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
  await p.setViewportSize({width:1123,height:794});
  await b.close(); console.log('ok');
})();
