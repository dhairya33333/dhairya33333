// Shared helpers: API calls, nav/auth state, formatting, scroll + motion effects.
export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
  return data;
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rupees = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const runtime = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
export const minutes = (sec) => Math.round(sec / 60);

export async function getUser() {
  try { return (await api('/auth/me')).user; } catch { return null; }
}

export async function mountNav(user) {
  const nav = $('.nav');
  if (!nav) return;
  const slot = $('#nav-auth');
  if (slot) {
    slot.innerHTML = user
      ? `${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}<a href="/account.html" class="btn">${esc(user.name.split(' ')[0])}</a>`
      : `<a href="/login.html" class="btn">Sign in</a>`;
  }
  const onScroll = () => nav.classList.toggle('stuck', scrollY > 40);
  onScroll(); addEventListener('scroll', onScroll, { passive: true });
  $('.burger')?.addEventListener('click', () => nav.classList.toggle('open'));
  $$('.nav-links a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));
}

export function initMotion() {
  // reveal on scroll
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal], .mask').forEach((el) => io.observe(el));

  // scroll progress rail
  const rail = $('.rail');
  if (rail) addEventListener('scroll', () => {
    rail.style.transform = `scaleX(${scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)})`;
  }, { passive: true });

  // number counters
  const cio = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    cio.unobserve(e.target);
    const el = e.target, m = /^(\D*)([\d,.]+)(.*)$/.exec(el.dataset.count);
    if (!m) return;
    const target = parseFloat(m[2].replace(/,/g, '')), t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 1800), v = target * (1 - Math.pow(1 - p, 4));
      el.textContent = m[1] + Math.round(v).toLocaleString('en-IN') + m[3];
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => cio.observe(el));

  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return;

  // custom cursor
  const dot = $('.cursor');
  if (dot) {
    let x = 0, y = 0, cx = 0, cy = 0;
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; dot.classList.add('on'); });
    const loop = () => { cx += (x - cx) * 0.2; cy += (y - cy) * 0.2; dot.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); };
    loop();
    document.addEventListener('mouseover', (e) => dot.classList.toggle('big', !!e.target.closest('a, button, .poster, .work')));
  }

  // magnetic buttons
  $$('.btn').forEach((b) => {
    b.addEventListener('mousemove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    b.addEventListener('mouseleave', () => (b.style.transform = ''));
  });

  // poster tilt
  $$('.poster').forEach((p) => {
    p.addEventListener('mousemove', (e) => {
      const r = p.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      p.style.transform = `perspective(900px) rotateY(${(px - 0.5) * 12}deg) rotateX(${(0.5 - py) * 12}deg) scale(1.02)`;
      p.style.setProperty('--px', px * 100 + '%'); p.style.setProperty('--py', py * 100 + '%');
    });
    p.addEventListener('mouseleave', () => (p.style.transform = ''));
  });
}
