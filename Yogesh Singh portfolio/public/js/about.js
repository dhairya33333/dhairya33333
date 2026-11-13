import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const KIND = { career: 'Service', book: 'Book', film: 'Cinema', talk: 'Speaking', article: 'Article', honour: 'Recognition' };
const site = await api('/site'); const s = site.settings;
await mountChrome({ active: '/about', settings: s });
document.title = `About — ${s.hero_name}`;

// headline: last word emphasised, revealed word by word
const words = s.hero_name.split(' ');
$('#title').innerHTML = words.map((w, i) => `<span style="display:inline-block;margin-right:.2em;animation:pgIn .9s var(--ease) ${i * 80}ms both">${i === words.length - 1 ? `<em>${esc(w)}</em>` : esc(w)}</span>`).join('');
$('#roles').textContent = s.hero_roles.split(',').map((r) => r.trim()).filter(Boolean).join('  ·  ');
$('#subhead').textContent = s.hero_tagline;
$('#body').innerHTML = s.about_body.split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
$('#stats').innerHTML = s.stats.split('\n').map((l) => l.split('|')).filter((p) => p[1]).map(([n, label]) => `<div class="stat"><b data-count="${esc(n.trim())}">${esc(n.trim())}</b><span>${esc(label.trim())}</span></div>`).join('');
const pillars = s.pillars.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] && p[1]);
if (pillars.length) { $('#pillars-sec').hidden = false; $('#pillars').innerHTML = pillars.map(([t, d, href], i) => {
  const head = `<span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(t)}</h3><p>${esc(d)}</p>`;
  if (href === 'instagram') {                       // this card carries the two Instagram accounts instead of one link
    const igs = [[s.social_instagram_en, 'English'], [s.social_instagram_hi, 'Hindi']].filter(([u]) => /^https?:\/\//.test(u || ''));
    return `<div class="pcard" data-reveal style="--i:${i}">${head}<div class="pig">${igs.map(([u, l]) => `<a href="${esc(u)}" target="_blank" rel="noopener">Instagram · ${l} ↗</a>`).join('')}</div></div>`;
  }
  return `<a class="pcard" ${href && /^(\/(?!\/)|https?:)/.test(href) ? `href="${esc(href)}"` : ''} data-reveal style="--i:${i}">${head}<i aria-hidden="true">→</i></a>`;
}).join(''); }
if (s.quote.trim()) { $('#quote').textContent = s.quote; $('#quote-sec').hidden = false; }
$('#timeline').innerHTML = site.works.filter((w) => w.kind !== 'article').map((w) => `
  <div class="tl"><div class="when">${esc(w.period || KIND[w.kind] || '')}${w.period ? ` · ${esc(KIND[w.kind] || '')}` : ''}</div>
  <h3>${esc(w.title)}</h3>${w.subtitle ? `<p>${esc(w.subtitle)}</p>` : ''}${w.url ? `<p><a href="${esc(w.url)}" target="_blank" rel="noopener">Read more ↗</a></p>` : ''}</div>`).join('');
if (s.portrait) { const im = $('#portrait'); im.src = s.portrait; im.alt = s.hero_name; im.hidden = false; }
$('#speak-title').textContent = s.speaking_title; $('#speak-body').textContent = s.speaking_body;
initMotion();
