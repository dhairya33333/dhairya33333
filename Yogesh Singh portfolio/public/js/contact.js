import { api, $, $$, esc, getUser, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const { settings: s } = await api('/site');
await mountChrome({ active: '/contact', settings: s });
document.title = `Contact — ${s.hero_name}`;
$('#intro').textContent = s.contact_intro;

const row = (label, html) => `<div class="row"><span class="l">${label}</span>${html}</div>`;
$('#info').innerHTML = [
  s.contact_email && row('Email', `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>`),
  s.contact_phone && row('Phone', `<a href="tel:${esc(s.contact_phone.replace(/[^+\d]/g, ''))}">${esc(s.contact_phone)}</a>`),
  s.contact_location && row('Based in', `<span class="v">${esc(s.contact_location)}</span>`),
  row('Social', `<span class="v" style="font-size:22px">${[['Instagram', s.social_instagram], ['YouTube', s.social_youtube], ['X', s.social_x], ['Facebook', s.social_facebook], ['LinkedIn', s.social_linkedin]].filter(([, u]) => u).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" style="font-size:22px;margin-right:16px">${n}</a>`).join('') || `<a href="/social" style="font-size:22px">See the social page</a>`}</span>`),
].filter(Boolean).join('');

$('#info').insertAdjacentHTML('afterend', `<div class="help-list" data-stagger>
  ${[['Speaking invitations', 'Talks for universities, institutions and organisations.'], ['The film', 'Screening, access and viewing questions.'], ['Press and media', 'Interviews, features and quotes.'], ['Collaboration', 'Projects, partnerships and events.']]
    .map(([t, d]) => `<div class="h"><b>${t}</b><span>${d}</span></div>`).join('')}</div>`);
const form = $('#form'), go = $('#go'), msg = $('#msg');
const topic = new URLSearchParams(location.search).get('topic');
if (topic && [...form.topic.options].some((o) => o.value === topic)) form.topic.value = topic;
getUser().then((u) => { if (u) { form.name.value ||= u.name; form.email.value ||= u.email; } });

const setErrors = (fields = {}) => $$('[data-f]', form).forEach((el) => {
  const m = fields[el.dataset.f]; el.classList.toggle('bad', !!m); const e = $('.err', el); if (e) e.textContent = m || '';
  const inp = $('input, textarea, select', el); if (inp) inp.setAttribute('aria-invalid', m ? 'true' : 'false');
});
form.message.addEventListener('input', () => ($('#count').textContent = form.message.value.length));
// clear a field's error as soon as the person fixes it
form.addEventListener('input', (e) => { const w = e.target.closest('[data-f]'); if (w?.classList.contains('bad')) { w.classList.remove('bad'); $('.err', w).textContent = ''; } });

const clientCheck = () => {
  const f = {}, v = Object.fromEntries(new FormData(form));
  if (v.name.trim().length < 2) f.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) f.email = 'Please enter a valid email address.';
  if (v.phone.trim() && !/^[0-9+()\-\s]{7,30}$/.test(v.phone.trim())) f.phone = 'Please enter a valid phone number or leave it empty.';
  if (v.message.trim().length < 10) f.message = 'Please write at least 10 characters.';
  return f;
};

form.addEventListener('submit', async (e) => {
  e.preventDefault(); msg.textContent = ''; msg.className = 'msg';
  const f = clientCheck(); setErrors(f);
  if (Object.keys(f).length) { form.querySelector('.bad input, .bad textarea')?.focus(); return; }
  go.disabled = true; go.classList.add('loading'); $('.t', go).textContent = 'Sending…';
  try {
    await api('/contact', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    $('#sent').classList.add('show'); form.reset(); $('#count').textContent = '0'; setErrors();
  } catch (err) {
    if (err.fields) { setErrors(err.fields); form.querySelector('.bad input, .bad textarea')?.focus(); }
    msg.textContent = err.fields ? '' : err.message;
  } finally { go.disabled = false; go.classList.remove('loading'); $('.t', go).textContent = 'Send message'; }
});
$('#again').addEventListener('click', () => { $('#sent').classList.remove('show'); form.name.focus(); });
initMotion();
