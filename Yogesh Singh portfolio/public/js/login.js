import { api, $, getUser, mountNav } from './common.js';
import { initGoogle } from './google.js';

let register = location.hash === '#register';
const next = (() => { const n = new URLSearchParams(location.search).get('next') || '/'; return n.startsWith('/') && !n.startsWith('//') ? n : '/'; })();
const say = (text, ok) => { const m = $('#msg'); m.textContent = text; m.className = 'msg' + (ok ? ' ok' : ''); };

function paint() {
  $('#h').textContent = register ? 'Create account' : 'Welcome back';
  $('#sub').textContent = register ? 'Join to unlock the full film.' : 'Sign in to watch the full film.';
  $('#f-name').hidden = !register;
  $('#go').textContent = register ? 'Create account' : 'Sign in';
  $('#sw-text').textContent = register ? 'Already have an account?' : 'New here?';
  $('#sw').textContent = register ? 'Sign in' : 'Create an account';
  $('#form').password.autocomplete = register ? 'new-password' : 'current-password';
  say('');
}
$('#sw').addEventListener('click', (e) => { e.preventDefault(); register = !register; paint(); });

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = $('#go');
  btn.disabled = true; say('');
  try {
    await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } });
    location.href = next;
  } catch (err) { say(err.message); btn.disabled = false; }
});

getUser().then((u) => { mountNav(u); if (u) location.replace(next); });
initGoogle(async (credential) => {
  say('Signing you in…', true);
  try { await api('/auth/google', { method: 'POST', body: { credential } }); location.href = next; }
  catch (err) { say(err.message); }
});
paint();
