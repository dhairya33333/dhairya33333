import { api, $ } from './common.js';

const token = new URLSearchParams(location.search).get('token') || '';
history.replaceState(null, '', location.pathname);          // keep the token out of history and referrers
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#msg'), btn = $('#go'); m.className = 'msg'; m.textContent = ''; btn.disabled = true;
  try {
    await api('/auth/reset', { method: 'POST', body: { token, password: e.target.password.value } });
    m.className = 'msg ok'; m.textContent = 'Password updated. Redirecting to sign in…';
    setTimeout(() => (location.href = '/login.html'), 1500);
  } catch (err) { m.textContent = err.message; btn.disabled = false; }
});
