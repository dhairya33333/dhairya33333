import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const [site, social] = await Promise.all([api('/site'), api('/social')]);
await mountChrome({ active: '/social', settings: site.settings });
document.title = `Social media — ${site.settings.hero_name}`;
$('#intro').textContent = social.intro;
if (social.profile) { const a = $('#follow'); a.href = social.profile; a.hidden = false; }

// Official Instagram embeds. The address is built only from a validated shortcode stored by the admin.
const grid = $('#embeds');
grid.innerHTML = social.embeds.map((e) => `
  <article class="embed ${e.kind === 'reel' ? 'reel' : ''}" data-src="https://www.instagram.com/${e.kind}/${esc(e.code)}/embed/captioned/" data-reveal>
    <div class="skel">Loading from Instagram…</div>
    <a class="open" href="https://www.instagram.com/${e.kind}/${esc(e.code)}/" target="_blank" rel="noopener">Open on Instagram ↗</a>
  </article>`).join('');

// load each embed only when it is about to scroll into view, so the page stays fast with many posts
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (!en.isIntersecting) return;
  io.unobserve(en.target);
  const f = document.createElement('iframe');
  f.src = en.target.dataset.src; f.title = 'Instagram post'; f.loading = 'lazy'; f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  f.addEventListener('load', () => en.target.classList.add('ready'));
  en.target.prepend(f);
  setTimeout(() => en.target.classList.add('ready'), 6000);        // never leave a permanent skeleton if the load event is blocked
}), { rootMargin: '300px 0px' });
grid.querySelectorAll('.embed').forEach((el) => io.observe(el));

if (social.posts.length) {
  $('#feed-wrap').hidden = false;
  $('#feed').innerHTML = social.posts.slice(0, 12).map((p, i) => `
    <a href="${esc(p.permalink || social.profile || '#')}" target="_blank" rel="noopener" data-reveal style="--i:${i}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy">${p.media_type === 'VIDEO' ? '<span class="play">▶</span>' : ''}${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}</a>`).join('');
}
if (!social.embeds.length && !social.posts.length) $('#empty').hidden = false;
initMotion();
