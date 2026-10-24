import { api, $, esc, getUser, mountNav } from './common.js';

const user = await getUser();
if (!user) location.replace('/login.html?next=/account.html');
mountNav(user);
$('#hello').textContent = `Hello, ${user.name.split(' ')[0]}`;
$('#email').textContent = user.email;
const { purchases } = await api('/my/purchases');
$('#list').innerHTML = purchases.length
  ? purchases.map((p) => `<a href="/film/${esc(p.slug)}" style="display:flex;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)">
      ${p.poster ? `<img src="${esc(p.poster)}" alt="" style="width:48px;height:72px;object-fit:cover;border-radius:3px">` : ''}
      <span class="serif" style="font-size:28px;flex:1">${esc(p.title)}</span><span class="link">Watch →</span></a>`).join('')
  : `<p style="color:var(--muted)">You haven't unlocked a film yet. <a class="link" href="/#film">Browse the film</a>.</p>`;
$('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; });
