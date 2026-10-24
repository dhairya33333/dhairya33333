import { api, $, $$, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const [site, social] = await Promise.all([api('/site'), api('/social')]);
await mountChrome({ active: '/social', settings: site.settings });
document.title = `Social media — ${site.settings.hero_name}`;
$('#intro').textContent = social.intro;
if (social.profile) for (const id of ['#follow', '#follow2']) { const a = $(id); a.href = social.profile; a.hidden = false; }
if (social.profile) $('#follow-bar').hidden = false;

const items = social.embeds;                               // newest first
const link = (e) => `https://www.instagram.com/${e.kind}/${e.code}/`;
const KIND = { reel: 'Reel', p: 'Post' };
let filter = 'all';

function card(e, i) {
  const cap = e.caption ? esc(e.caption) : '';
  return `<button class="scard ${e.thumb ? '' : 'nocover'}" data-i="${i}" data-kind="${e.kind}" style="--i:${i % 9}" aria-label="Open ${KIND[e.kind].toLowerCase()}${e.caption ? ': ' + esc(e.caption.slice(0, 80)) : ''}">
    ${e.thumb ? `<img src="${esc(e.thumb)}" alt="" loading="lazy" decoding="async">` : (cap ? `<span class="ph-quote">${cap}</span>` : `<span class="ph-quote empty-cap">${e.kind === 'reel' ? 'Watch the reel' : 'View the post'}<small>on Instagram</small></span>`)}
    <span class="badge-k">${e.kind === 'reel' ? '▶ Reel' : 'Post'}</span>
    ${e.kind === 'reel' ? '<span class="bigplay" aria-hidden="true"><i></i></span>' : ''}
    <span class="scap">${e.thumb && cap ? `<span>${cap}</span>` : ''}<em>${e.author ? '@' + esc(e.author) : 'View'} →</em></span>
  </button>`;
}

function render() {
  const list = items.map((e, i) => [e, i]).filter(([e]) => filter === 'all' || e.kind === filter);
  $('#grid').innerHTML = list.map(([e, i]) => card(e, i)).join('');
  $('#grid').classList.remove('in'); requestAnimationFrame(() => requestAnimationFrame(() => $('#grid').classList.add('in')));
  $('#empty').hidden = !!items.length || social.posts.length > 0;
}
$('#grid').setAttribute('data-stagger', '');

// filter chips only when there is something to filter
const kinds = [...new Set(items.map((e) => e.kind))];
if (kinds.length > 1) {
  const f = $('#filters'); f.hidden = false;
  f.innerHTML = [['all', `All (${items.length})`], ['reel', `Reels (${items.filter((e) => e.kind === 'reel').length})`], ['p', `Posts (${items.filter((e) => e.kind === 'p').length})`]]
    .map(([k, t]) => `<button role="tab" data-f="${k}" aria-selected="${k === 'all'}" class="${k === 'all' ? 'on' : ''}">${t}</button>`).join('');
  f.addEventListener('click', (ev) => { const b = ev.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; $$('button', f).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); }); render(); });
}
render();

// ---------- viewer ----------
const lb = $('#lb'); let cur = -1, lastFocus = null;
const visible = () => items.map((e, i) => i).filter((i) => filter === 'all' || items[i].kind === filter);
function show(i) {
  cur = i; const e = items[i], order = visible(), pos = order.indexOf(i);
  $('#lb-kind').textContent = KIND[e.kind]; $('#lb-title').textContent = e.author ? `@${e.author}` : 'Instagram';
  $('#lb-caption').textContent = e.caption || ''; $('#lb-open').href = link(e);
  $('#lb-count').textContent = `${pos + 1} / ${order.length}`;
  $('#lb-prev').disabled = $('#lb-next').disabled = order.length < 2;
  // the official embed is created only now, built from the stored short code
  const f = document.createElement('iframe');
  f.src = `https://www.instagram.com/${e.kind}/${e.code}/embed/`; f.title = `${KIND[e.kind]} on Instagram`; f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'); f.allowFullscreen = true;
  $('#lb-skel').hidden = false; lb.classList.remove('ready');
  f.addEventListener('load', () => { $('#lb-skel').hidden = true; lb.classList.add('ready'); });
  setTimeout(() => { $('#lb-skel').hidden = true; lb.classList.add('ready'); }, 7000);
  $('#lb-frame').replaceChildren(f);
}
function open(i, trigger) {
  lastFocus = trigger || document.activeElement; lb.hidden = false; document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => lb.classList.add('open')); show(i); $('.lb-x', lb).focus();
}
function close() { lb.classList.remove('open', 'ready'); document.body.style.overflow = ''; $('#lb-frame').replaceChildren(); setTimeout(() => { lb.hidden = true; }, 350); lastFocus?.focus?.(); }
function step(d) { const o = visible(); if (o.length < 2) return; show(o[(o.indexOf(cur) + d + o.length) % o.length]); }
$('#grid').addEventListener('click', (ev) => { const c = ev.target.closest('.scard'); if (c) open(Number(c.dataset.i), c); });
lb.addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) close(); });
$('#lb-prev').addEventListener('click', () => step(-1)); $('#lb-next').addEventListener('click', () => step(1));
addEventListener('keydown', (ev) => {
  if (lb.hidden) return;
  if (ev.key === 'Escape') return close();
  if (ev.key === 'ArrowLeft') return step(-1);
  if (ev.key === 'ArrowRight') return step(1);
  if (ev.key === 'Tab') {                                           // keep focus inside the dialog
    const f = $$('button:not([disabled]), a[href]', lb).filter((x) => x.offsetParent !== null);
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
});
// deep link: /social#DCODE opens that post
const hash = location.hash.slice(1); const hi = items.findIndex((e) => e.code === hash); if (hi >= 0) open(hi);

if (social.posts.length) {
  $('#feed-wrap').hidden = false;
  $('#feed').innerHTML = social.posts.slice(0, 12).map((p, i) => `
    <a href="${esc(p.permalink || social.profile || '#')}" target="_blank" rel="noopener" data-reveal style="--i:${i}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy">${p.media_type === 'VIDEO' ? '<span class="play">▶</span>' : ''}${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}</a>`).join('');
}
initMotion();
