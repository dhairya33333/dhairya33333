import { api, $, esc, rupees, runtime, minutes, getUser, mountNav, initMotion } from './common.js';

const KIND = { career: 'Service', book: 'Book', article: 'Article', film: 'Cinema', talk: 'Speaking', honour: 'Recognition' };

function splitMask(el, text, startDelay = 0) {
  el.innerHTML = text.split(' ').map((w, wi) =>
    `<span class="mask" style="display:inline-block;margin-right:.22em"><span style="--d:${startDelay}ms;--i:${wi}">${esc(w)}</span></span>`).join('');
}

function paragraphs(text) {
  return text.split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderFilm(movies, mode) {
  const slot = $('#film-slot');
  const m = movies[0];
  if (!m) {
    slot.innerHTML = `<div class="film"><div class="poster" data-reveal><div class="ph">Coming<br>soon</div></div><div data-reveal><h3>The film is on its way.</h3><p class="desc">Check back soon. The first 30 minutes will be free to watch, right here.</p></div></div>`;
    return;
  }
  const free = minutes(m.preview_sec);
  const media = m.trailer
    ? `<video src="${esc(m.trailer)}" ${m.poster ? `poster="${esc(m.poster)}"` : ''} muted loop playsinline autoplay></video>`
    : m.poster ? `<img src="${esc(m.poster)}" alt="${esc(m.title)} poster">` : `<div class="ph">${esc(m.title)}</div>`;
  slot.innerHTML = `
    <div class="film">
      <a class="poster" data-reveal href="/film/${esc(m.slug)}" aria-label="Watch ${esc(m.title)}">${media}<span class="shine"></span></a>
      <div>
        <h3 data-reveal>${esc(m.title)}</h3>
        ${m.tagline ? `<p class="tag" data-reveal>${esc(m.tagline)}</p>` : ''}
        <p class="desc" data-reveal>${esc(m.description)}</p>
        <div class="chips" data-reveal>
          ${m.duration_sec ? `<span class="chip">${runtime(m.duration_sec)}</span>` : ''}
          ${m.year ? `<span class="chip">${esc(m.year)}</span>` : ''}
          <span class="chip free">First ${free} min free</span>
        </div>
        <div class="actions" data-reveal>
          <a class="btn primary" href="/film/${esc(m.slug)}">▶ Watch the free ${free} minutes</a>
          <a class="btn" href="/film/${esc(m.slug)}#unlock"><span class="price">${rupees(m.price_paise)}</span> Unlock full film <span class="arrow">→</span></a>
        </div>
      </div>
    </div>`;
}

function renderSocial(posts, s) {
  const link = $('#ig-link');
  if (s.social_instagram) { link.href = s.social_instagram; link.hidden = false; }
  if (!posts.length) return;
  $('#social').hidden = false;
  $('#ig').innerHTML = posts.slice(0, 6).map((p, i) => `
    <a href="${esc(p.permalink || s.social_instagram || '#')}" target="_blank" rel="noopener" data-reveal style="--i:${i}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy">
      ${p.media_type === 'VIDEO' ? '<span class="play">▶</span>' : ''}
      ${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}
    </a>`).join('');
}

async function boot() {
  const mark = $('.loader .mark');
  mark.innerHTML = 'Y. P. Singh'.split('').map((c, i) => `<span style="animation-delay:${i * 45}ms">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  const [site, user] = await Promise.all([api('/site'), getUser()]);
  const s = site.settings;

  document.title = s.site_title;
  mountNav(user);

  const parts = s.hero_name.trim().split(' '); const last = parts.length > 1 ? parts.pop() : ''; const first = parts.join(' '); const rest = [last];
  $('#hero-name').innerHTML = `<span class="mask"><span style="--d:900ms">${esc(first)}</span></span>${last ? `<span class="mask"><span style="--d:1050ms"><em>${esc(last)}</em></span></span>` : ''}`;
  const roles = s.hero_roles.split(',').map((r) => r.trim()).filter(Boolean);
  $('#hero-roles').innerHTML = roles.map((r) => `<span>${esc(r)}</span>`).join('');
  $('#hero-tag').textContent = s.hero_tagline;

  const words = [...roles, ...(site.movies[0] ? [site.movies[0].title] : []), 'Discipline', 'Cinema', 'Purpose'];
  const row = words.map((w) => `<span>${esc(w)}</span>`).join('');
  $('#marquee').innerHTML = row.repeat(6);

  renderFilm(site.movies, site.paymentsMode);

  $('#about-title').textContent = s.about_title;
  $('#about-body').innerHTML = paragraphs(s.about_body);
  $('#stats').innerHTML = s.stats.split('\n').map((l) => l.split('|')).filter((p) => p[1]).map(([n, label]) =>
    `<div class="stat"><b data-count="${esc(n.trim())}">${esc(n.trim())}</b><span>${esc(label.trim())}</span></div>`).join('');
  $('#quote').textContent = s.quote;
  $('#quote-sec').hidden = !s.quote.trim();

  const journey = site.works.filter((w) => w.kind !== 'article'), articles = site.works.filter((w) => w.kind === 'article');
  if (articles.length) {
    $('#articles').hidden = false;
    $('#articles-list').innerHTML = articles.map((w, i) => `
      <a class="work" ${w.url ? `href="${esc(w.url)}" target="_blank" rel="noopener"` : ''} data-reveal style="--i:${i}">
        <span class="k">${esc(w.period || 'Article')}</span>
        <div><h4>${esc(w.title)}</h4>${w.subtitle ? `<p>${esc(w.subtitle)}</p>` : ''}</div>
        <span class="p">${w.url ? 'Read ↗' : ''}</span>
      </a>`).join('');
  }
  $('#works').innerHTML = journey.map((w, i) => `
    <div class="work" data-reveal style="--i:${i}">
      <span class="k">${esc(KIND[w.kind] || w.kind)}</span>
      <div><h4>${esc(w.title)}</h4>${w.subtitle ? `<p>${esc(w.subtitle)}</p>` : ''}</div>
      <span class="p">${esc(w.period)}</span>
    </div>`).join('');

  $('#speak-title').textContent = s.speaking_title;
  $('#speak-body').textContent = s.speaking_body;
  const mail = s.contact_email ? `mailto:${s.contact_email}` : '#contact';
  $('#speak-cta').href = mail; $('#foot-mail').href = mail;
  $('#foot-mail').textContent = s.contact_email ? s.contact_email + ' →' : 'Let’s talk →';

  renderSocial(site.social, s);

  const socials = [['Instagram', s.social_instagram], ['YouTube', s.social_youtube], ['X', s.social_x], ['Facebook', s.social_facebook], ['LinkedIn', s.social_linkedin]].filter(([, u]) => u);
  $('#socials').innerHTML = socials.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('');
  $('#copy').textContent = `© ${new Date().getFullYear()} ${s.hero_name}. All rights reserved.`;

  // hero spotlight follows the pointer
  const hero = $('.hero');
  hero.addEventListener('mousemove', (e) => {
    hero.style.setProperty('--mx', e.clientX + 'px'); hero.style.setProperty('--my', e.clientY + 'px');
  });

  initMotion();
  setTimeout(() => { $('#loader').classList.add('done'); hero.classList.add('go'); }, 1500);
}
boot().catch((e) => { console.error(e); $('#loader')?.classList.add('done'); });
