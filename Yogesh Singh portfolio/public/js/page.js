import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';
import { format } from './format.js';

const path = location.pathname.replace(/\/$/, '');
const site = await api('/site');
const slug = { '/story': 'story', '/law': 'law', '/books': 'books', '/speaking': 'speaking', '/family': 'family' }[path];
await mountChrome({ active: path, settings: site.settings });
try {
  const d = await api(`/page/${slug}`);
  document.title = `${d.title} — ${site.settings.hero_name}`;
  $('#eyebrow').textContent = d.eyebrow; $('#title').textContent = d.title; $('#lede').textContent = d.lede;
  $('#pnav').innerHTML = d.pages.map((p) => `<a href="${p.path}" ${p.slug === slug ? 'aria-current="page"' : ''}>${esc(p.title)}</a>`).join('');
  $('#body').innerHTML = format(d.body);
} catch { $('#title').textContent = 'Page not found'; }
initMotion();
