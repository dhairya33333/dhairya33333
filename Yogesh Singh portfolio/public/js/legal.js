import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';
import { format } from './format.js';

const slug = location.pathname.replace(/^\//, '');
const site = await api('/site');
await mountChrome({ active: '/' + slug, settings: site.settings });
const PAGES = [['privacy', 'Privacy Policy'], ['terms', 'Terms of Use'], ['refunds', 'Refund Policy']];
$('#lnav').innerHTML = PAGES.map(([s, t]) => `<a href="/${s}" ${s === slug ? 'aria-current="page"' : ''}>${t}</a>`).join('');

try {
  const d = await api(`/legal/${encodeURIComponent(slug)}`);
  document.title = `${d.title} — ${site.settings.hero_name}`;
  $('#title').textContent = d.title;
  $('#updated').textContent = d.updated && d.updated !== 'initial' ? `Last updated ${d.updated}` : '';
  $('#body').innerHTML = format(d.body);
} catch { $('#title').textContent = 'Page not found'; }
initMotion();
