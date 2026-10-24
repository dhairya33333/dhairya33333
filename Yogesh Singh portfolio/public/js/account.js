import { api, $, esc, getUser, mountNav } from './common.js';
import { initGoogle } from './google.js';

let user = await getUser();
if (!user) location.replace('/login.html?next=/account.html');
mountNav(user);
$('#hello').textContent = `Hello, ${user.name.split(' ')[0]}`;
$('#email').textContent = user.email;

function paintSignin() {
  $('#signin').innerHTML = `<p style="margin:0;color:var(--muted)">${user.hasPassword ? 'Email and password ✓' : 'No password set yet'} &nbsp;·&nbsp; ${user.googleLinked ? 'Google ✓' : 'Google not connected'}</p>`;
  $('#cur-field').hidden = !user.hasPassword;
}
paintSignin();

const { purchases } = await api('/my/purchases');
$('#list').innerHTML = purchases.length
  ? purchases.map((p) => `<a href="/film/${esc(p.slug)}" style="display:flex;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)">
      ${p.poster ? `<img src="${esc(p.poster)}" alt="" style="width:48px;height:72px;object-fit:cover;border-radius:3px">` : ''}
      <span class="serif" style="font-size:28px;flex:1">${esc(p.title)}</span><span class="link">Watch →</span></a>`).join('')
  : `<p style="color:var(--muted)">You haven't unlocked a film yet. <a class="link" href="/films">Browse the films</a>.</p>`;

if (!user.googleLinked) {
  initGoogle(async (credential) => {
    try { ({ user } = await api('/auth/google/link', { method: 'POST', body: { credential } })); paintSignin(); $('#google-wrap').hidden = true; $('#pw-msg').className = 'msg ok'; $('#pw-msg').textContent = 'Google connected.'; }
    catch (e) { $('#pw-msg').className = 'msg'; $('#pw-msg').textContent = e.message; }
  });
}

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, m = $('#pw-msg'); m.className = 'msg'; m.textContent = '';
  try {
    await api('/auth/password', { method: 'POST', body: { current: f.current.value, password: f.password.value } });
    m.className = 'msg ok'; m.textContent = 'Password updated. Other devices have been signed out.'; f.reset();
    user = await getUser(); paintSignin();
  } catch (err) { m.textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; });
