// Renders index.html frame-by-frame (deterministic) with Playwright.
// Usage: node render.js <fps> <startSec> <endSec> <outDir> [workers]
//        node render.js shots <outDir> t1 t2 t3 ...   (stills for review)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// FILE=vertical.html W=1080 H=1920 node render.js ...   (defaults: index.html 1920x1080)
const FILE = process.env.FILE || 'index.html';
const VW = +(process.env.W || 1920), VH = +(process.env.H || 1080);
const url = 'file://' + path.join(__dirname, FILE);

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.REEL) {   // reels.html: inject the script for this reel
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'reels.json'), 'utf8'))[process.env.REEL];
    await page.evaluate(s => window.init(s), spec);
  }
  return page;
}

(async () => {
  const args = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-gpu'] });
  if (args[0] === 'shots') {
    const out = args[1]; fs.mkdirSync(out, { recursive: true });
    const page = await open(browser);
    for (const ts of args.slice(2)) {
      await page.evaluate(t => window.render(t), parseFloat(ts));
      await page.screenshot({ path: path.join(out, `t${ts}.png`) });
    }
    await browser.close(); return;
  }
  const [fps, a, b, out, workers = '4'] = args;
  const F = +fps, start = Math.round(+a * F), W = +workers;
  let endSec = +b;
  if (b === 'auto') { const p0 = await open(browser); endSec = await p0.evaluate(() => window.TOTAL); }
  const end = Math.round(endSec * F);
  fs.mkdirSync(out, { recursive: true });
  let next = start;
  async function worker() {
    const page = await open(browser);
    while (true) {
      const i = next++; if (i >= end) break;
      await page.evaluate(t => window.render(t), i / F);
      await page.screenshot({ path: path.join(out, `f${String(i).padStart(5, '0')}.png`) });
      if (i % 60 === 0) console.log('frame', i, '/', end);
    }
  }
  await Promise.all(Array.from({ length: W }, worker));
  await browser.close();
})();
