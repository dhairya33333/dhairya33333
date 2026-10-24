import { api, $, getUser, mountNav } from './common.js';

let register = location.hash === '#register';
const next = (() => { const n = new URLSearchParams(location.search).get('next') || '/'; return n.startsWith('/') && !n.startsWith('//') ? n : '/'; })();

function paint() {
  $('#h').textContent = register ? 'Create account' : 'Welcome back';
  $('#sub').textContent = register ? 'Join to unlock the full film.' : 'Sign in to watch the full film.';
  $('#f-name').hidden = !register;
  $('#go').textContent = register ? 'Create account' : 'Sign in';
  $('#sw-text').textContent = register ? 'Already have an account?' : 'New here?';
  $('#sw').textContent = register ? 'Sign in' : 'Create an account';
  $('#form').password.autocomplete = register ? 'new-password' : 'current-password';
  $('#msg').textContent = '';
}
$('#sw').addEventListener('click', (e) => { e.preventDefault(); register = !register; paint(); });

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = $('#go');
  btn.disabled = true; $('#msg').textContent = '';
  try {
    await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } });
    location.href = next;
  } catch (err) { $('#msg').textContent = err.message; btn.disabled = false; }
});

getUser().then((u) => { mountNav(u); if (u) location.replace(next); });
paint();
