// node render_pdf.js  -> Devdha-shop-screen-ad-storyboard.pdf (A4 landscape)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-gpu'] });
  const page = await b.newPage();
  await page.goto('file://' + path.join(__dirname, 'storyboard.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(__dirname, 'Devdha-shop-screen-ad-storyboard.pdf'), format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('pdf ok');
})();
