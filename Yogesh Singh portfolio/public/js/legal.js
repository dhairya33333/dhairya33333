import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const slug = location.pathname.replace(/^\//, '');
const site = await api('/site');
await mountChrome({ active: '/' + slug, settings: site.settings });
const PAGES = [['privacy', 'Privacy Policy'], ['terms', 'Terms of Use'], ['refunds', 'Refund Policy']];
$('#lnav').innerHTML = PAGES.map(([s, t]) => `<a href="/${s}" ${s === slug ? 'aria-current="page"' : ''}>${t}</a>`).join('');

// small, safe formatter: "## heading", "- list item", blank line = paragraph, **bold**. Everything is escaped first.
function format(text) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; } };
  for (const block of text.split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      if (/^##\s+/.test(line)) { flush(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); }
      else if (/^-\s+/.test(line)) list.push(line.replace(/^-\s+/, ''));
      else if (line.trim()) { flush(); out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
  }
  return out.join('');
}
try {
  const d = await api(`/legal/${encodeURIComponent(slug)}`);
  document.title = `${d.title} — ${site.settings.hero_name}`;
  $('#title').textContent = d.title;
  $('#updated').textContent = d.updated && d.updated !== 'initial' ? `Last updated ${d.updated}` : '';
  $('#body').innerHTML = format(d.body);
} catch { $('#title').textContent = 'Page not found'; }
initMotion();
