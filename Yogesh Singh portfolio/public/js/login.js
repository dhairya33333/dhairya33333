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
    const r = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } });
    if (r.twofa) return askCode(r.ticket);
    location.href = next;
  } catch (err) { say(err.message); btn.disabled = false; }
});

getUser().then((u) => { mountNav(u); if (u) location.replace(next); });
initGoogle(async (credential) => {
  say('Signing you in…', true);
  try { const r = await api('/auth/google', { method: 'POST', body: { credential } }); if (r.twofa) return askCode(r.ticket); location.href = next; }
  catch (err) { say(err.message); }
});
paint();

// Self-service reset appears only when the server has email set up.
api('/auth/config').then((c) => {
  if (!c.emailReset) return;
  $('#forgot-ask').hidden = true; $('#forgot-mail').hidden = false;
  $('#forgot-mail').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#form').email.value.trim();
    if (!email) return say('Type your email above first, then choose this again.');
    try { say((await api('/auth/forgot', { method: 'POST', body: { email } })).message, true); } catch (err) { say(err.message); }
  });
}).catch(() => {});

// Second step: shown when the account has two-step sign-in on (after a password OR a Google sign-in).
let ticket = null;
export function askCode(t) {
  ticket = t; $('#form').hidden = true; $('#form2').hidden = false; $('#google-wrap').hidden = true; $('#forgot').hidden = true;
  $('#h').textContent = 'Two-step check'; $('#sub').textContent = 'Open your authenticator app and type the current code.'; $('#form2').code.focus();
}
$('#form2').addEventListener('submit', async (e) => {
  e.preventDefault(); const btn = $('#go2'); btn.disabled = true; $('#msg2').textContent = '';
  try { await api('/auth/2fa/verify', { method: 'POST', body: { ticket, code: e.target.code.value } }); location.href = next; }
  catch (err) {
    $('#msg2').textContent = err.message; btn.disabled = false;
    if (/expired|Too many/.test(err.message)) setTimeout(() => location.reload(), 1800);
  }
});
