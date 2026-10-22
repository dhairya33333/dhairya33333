// node render_mock.js <services_data.json> <outDir> [onlyIds comma list]  -> JPEGs (1000x1000)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const out = process.argv[3];
const only = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const slug = t => t.toLowerCase().replace(/&/g, 'and').replace(/[—/]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-gpu'] });
  const page = await (await b.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'mock.html')); await page.evaluate(() => document.fonts.ready);
  const rows = [];
  for (const s of data) {
    if (only && !only.includes(s.id)) continue;
    const plan = await page.evaluate(id => window.PLAN[id] ? true : false, s.id);
    if (!plan) { console.log('NO PLAN', s.id, s.name); continue; }
    const ps = `${s.id}-${slug(s.name)}`; fs.mkdirSync(path.join(out, ps), { recursive: true });
    const shots = [['mockup', 0], ['mockup-alt', 1], ['whats-included', 2]];
    let n = 0;
    for (const [view, i] of shots) {
      n++;
      const fn = `${ps}_digital-mockup_${String(n).padStart(2, '0')}-${view}.jpg`;
      try {
        if (i < 2) await page.evaluate(([id, k]) => { const [sc, o] = window.PLAN[id][k]; window.show(sc, o); }, [s.id, i]);
        else await page.evaluate(sv => window.show('info', { cat: sv.category, title: sv.name, desc: sv.desc, includes: sv.includes, turn: sv.turnaround || '—', deliv: sv.digital ? 'Digitally, online' : 'With your order' }), s);
        await page.screenshot({ path: path.join(out, ps, fn), type: 'jpeg', quality: 93 });
        const alt = i < 2 ? `Preview: illustrative mock-up of the ${s.name} service (not a physical product)` : `${s.name} — what is included and turnaround`;
        rows.push({ product_id: s.id, product: s.name, variant: 'digital-mockup', view, file: `${ps}/${fn}`, alt_text: alt, caption: i < 2 ? 'Preview: illustrative mock-up' : 'What is included' });
      } catch (e) { console.log('FAIL', s.id, view, e.message); }
    }
  }
  if (errs.length) console.log('PAGE ERRORS', [...new Set(errs)].slice(0, 5));
  fs.writeFileSync(path.join(out, 'manifest_digital.json'), JSON.stringify(rows, null, 1));
  await b.close(); console.log('rendered', rows.length);
})();
