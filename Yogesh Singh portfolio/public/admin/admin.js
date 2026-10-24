import { api, $, $$, esc, rupees, runtime, getUser } from '/js/common.js';

const view = $('#view');
const toast = (msg, err) => { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 3200); };
const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); } };
const fmt = (d) => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
const head = (t, l) => `<h1 class="t">${t}</h1><p class="lede">${l}</p>`;
let poll;

const views = {
  async dashboard() {
    const s = await api('/admin/stats');
    view.innerHTML = head('Dashboard', 'How the film is doing.') + `
      <div class="grid g4">
        <div class="panel kpi"><b>${rupees(s.revenue_paise)}</b><span>Revenue</span></div>
        <div class="panel kpi"><b>${s.orders_paid}</b><span>Paid orders</span></div>
        <div class="panel kpi"><b>${s.users}</b><span>Viewers signed up</span></div>
        <div class="panel kpi"><b>${s.movies}</b><span>Films</span></div>
      </div>
      <div class="panel" style="margin-top:16px"><h3>Payments mode</h3>
        <span class="pill ${s.paymentsMode === 'cashfree' ? 'PAID' : 'CREATED'}">${s.paymentsMode}</span>
        <span class="muted small" style="margin-left:10px">${s.paymentsMode === 'cashfree' ? 'Live payments through Cashfree.' : s.paymentsMode === 'demo' ? 'Demo mode: purchases are simulated. Add Cashfree keys in .env.' : 'Payments are NOT configured. Add Cashfree keys in .env.'}</span></div>
      <div class="panel" style="margin-top:16px"><h3>Recent sales</h3><div class="tablewrap"><table><tr><th>When</th><th>Viewer</th><th>Film</th><th>Amount</th></tr>
        ${s.recent.map((o) => `<tr><td>${fmt(o.paid_at)}</td><td>${esc(o.name)}</td><td>${esc(o.title)}</td><td>${rupees(o.amount_paise)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sales yet.</td></tr>'}</table></div></div>`;
  },

  async films() {
    const { movies } = await api('/admin/movies');
    view.innerHTML = head('Films', 'Upload the film, set the free preview and price, then publish.') + `
      <div class="panel drawer"><h3>New film</h3>
        <div class="row"><label class="field" style="flex:1;margin:0;min-width:240px"><span>Title</span><input id="nt" placeholder="Film title"></label>
        <button class="btn gold s" id="nadd" style="align-self:flex-end">Create</button></div></div>
      <div id="list">${movies.map(filmRow).join('') || '<p class="muted">No films yet. Create one above.</p>'}</div>`;
    $('#nadd').onclick = () => act(async () => { const r = await api('/admin/movies', { method: 'POST', body: { title: $('#nt').value } }); location.hash = '#film/' + r.id; });
    $$('[data-edit]').forEach((b) => (b.onclick = () => (location.hash = '#film/' + b.dataset.edit)));
    if (movies.some((m) => m.status === 'processing')) poll = setTimeout(() => route(), 4000);
  },

  async film(id) {
    const { movies } = await api('/admin/movies');
    const m = movies.find((x) => x.id === Number(id));
    if (!m) { location.hash = '#films'; return; }
    const inc = await api('/admin/incoming');
    view.innerHTML = head(esc(m.title), `<a class="link" href="#films">← All films</a> &nbsp; <span class="pill ${m.status}">${m.status}</span>`) + `
      <div class="grid g2">
        <div class="panel"><h3>Details</h3>
          <label class="field"><span>Title</span><input id="f-title" value="${esc(m.title)}"></label>
          <label class="field"><span>Tagline</span><input id="f-tag" value="${esc(m.tagline)}"></label>
          <label class="field"><span>Description</span><textarea id="f-desc">${esc(m.description)}</textarea></label>
          <div class="cols"><label class="field"><span>Year</span><input id="f-year" value="${esc(m.year)}"></label>
            <label class="field"><span>Price (₹)</span><input id="f-price" type="number" min="1" value="${m.price_paise / 100}"></label></div>
          <label class="field"><span>Free preview (minutes)</span><input id="f-prev" type="number" min="0" value="${Math.round(m.preview_sec / 60)}"></label>
          <label class="check"><input type="checkbox" id="f-pub" ${m.published ? 'checked' : ''}> Published (visible on the site)</label>
          <label class="check"><input type="checkbox" id="f-feat" ${m.featured ? 'checked' : ''}> Featured on the homepage</label>
          <div class="row" style="margin-top:16px"><button class="btn gold s" id="save">Save changes</button>
            <button class="btn danger s" id="del">Delete film</button></div></div>
        <div>
          <div class="panel"><h3>Film file ${m.duration_sec ? `· ${runtime(m.duration_sec)}` : ''}</h3>
            ${m.status === 'processing' ? `<p>Encoding for streaming… ${m.progress.toFixed(0)}%</p><div class="bar"><i style="width:${m.progress}%"></i></div><p class="muted small">This can take a while for a full-length film. You can leave this page.</p>` : ''}
            ${m.status === 'failed' ? `<p style="color:var(--danger)">${esc(m.error || 'Failed')}</p><button class="btn s" id="reproc">Re-process</button>` : ''}
            ${m.status === 'ready' ? `<p style="color:var(--ok)">Ready to stream.</p><button class="btn s" id="reproc">Re-process</button>` : ''}
            <label class="field" style="margin-top:14px"><span>Upload from this computer (mp4, mov, mkv)</span><input type="file" id="vid" accept="video/*,.mkv"></label>
            <div class="bar" id="upbar" hidden><i></i></div>
            <p class="muted small">For a 2+ hour film, uploading via SFTP is faster and more reliable. Put the file in <code>${esc(inc.dir)}</code> and pick it here:</p>
            <div class="row"><select id="imp" class="field" style="margin:0;flex:1;padding:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px">
              <option value="">Choose a file…</option>${inc.files.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${(f.size / 1e9).toFixed(2)} GB)</option>`).join('')}</select>
              <button class="btn s" id="impgo">Process</button></div></div>
          <div class="panel" style="margin-top:16px"><h3>Artwork</h3>
            <div class="row" style="align-items:flex-start">${m.poster ? `<img src="${esc(m.poster)}" style="width:90px;border-radius:4px">` : ''}
              <div style="flex:1"><label class="field"><span>Poster (portrait 2:3 works best)</span><input type="file" id="poster" accept="image/*"></label>
              <label class="field"><span>Homepage trailer loop (optional, short mp4/webm)</span><input type="file" id="trailer" accept="video/mp4,video/webm"></label>
              ${m.trailer ? '<span class="pill pub">trailer set</span>' : ''}</div></div></div>
        </div>
      </div>`;
    const body = () => ({ title: $('#f-title').value, tagline: $('#f-tag').value, description: $('#f-desc').value, year: $('#f-year').value, price_rupees: $('#f-price').value, preview_minutes: $('#f-prev').value, published: $('#f-pub').checked, featured: $('#f-feat').checked });
    $('#save').onclick = () => act(() => api('/admin/movies/' + m.id, { method: 'PUT', body: body() }), 'Saved');
    $('#del').onclick = () => confirm('Delete this film permanently?') && act(async () => { await api('/admin/movies/' + m.id, { method: 'DELETE' }); location.hash = '#films'; });
    $('#reproc')?.addEventListener('click', () => act(async () => { await api(`/admin/movies/${m.id}/reprocess`, { method: 'POST' }); route(); }, 'Re-processing started'));
    $('#impgo').onclick = () => $('#imp').value && act(async () => { await api(`/admin/movies/${m.id}/import`, { method: 'POST', body: { file: $('#imp').value } }); route(); }, 'Processing started');
    for (const k of ['poster', 'trailer']) $('#' + k).onchange = (e) => upload(`/admin/movies/${m.id}/${k}`, e.target.files[0]).then(() => { toast('Uploaded'); route(); }).catch((x) => toast(x.message, true));
    $('#vid').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const bar = $('#upbar'); bar.hidden = false;
      upload(`/admin/movies/${m.id}/video`, f, (p) => ($('i', bar).style.width = p + '%')).then(() => { toast('Uploaded. Encoding started'); route(); }).catch((x) => toast(x.message, true));
    };
    if (m.status === 'processing') poll = setTimeout(() => route(), 4000);
  },

  async orders() {
    const { orders } = await api('/admin/orders');
    view.innerHTML = head('Orders', 'Latest 300 orders.') + `<div class="panel tablewrap"><table><tr><th>Date</th><th>Order</th><th>Viewer</th><th>Film</th><th>Amount</th><th>Status</th></tr>
      ${orders.map((o) => `<tr><td>${fmt(o.created_at)}</td><td class="small muted">${esc(o.order_id)}</td><td>${esc(o.name)}<br><span class="muted small">${esc(o.email)}</span></td><td>${esc(o.title)}</td><td>${rupees(o.amount_paise)}</td><td><span class="pill ${o.status}">${o.status}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}</table></div>`;
  },

  async users() {
    const [{ users }, { movies }] = await Promise.all([api('/admin/users'), api('/admin/movies')]);
    view.innerHTML = head('Users', 'Everyone who signed up. Grant free access to guests, press and family.') + `
      <div class="panel drawer"><h3>Grant free access</h3><div class="row">
        <label class="field" style="margin:0;flex:1;min-width:220px"><span>User email</span><input id="g-email" type="email"></label>
        <label class="field" style="margin:0"><span>Film</span><select id="g-movie">${movies.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></label>
        <button class="btn gold s" id="g-go" style="align-self:flex-end">Grant</button></div></div>
      <div class="panel tablewrap"><table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Films</th><th>Role</th></tr>
      ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '–')}</td><td>${fmt(u.created_at)}</td><td>${u.purchases}</td>
        <td>${u.role === 'admin' ? '<span class="pill pub">admin</span>' : 'user'} <a href="#" class="link small" data-role="${u.id}" data-to="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'demote' : 'make admin'}</a></td></tr>`).join('')}</table></div>`;
    $('#g-go').onclick = () => act(() => api('/admin/grant', { method: 'POST', body: { email: $('#g-email').value, movieId: $('#g-movie').value } }), 'Access granted');
    $$('[data-role]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); act(async () => { await api(`/admin/users/${a.dataset.role}/role`, { method: 'POST', body: { role: a.dataset.to } }); route(); }, 'Role updated'); }));
  },

  async content() {
    const { settings: s } = await api('/admin/settings');
    const txt = (k, label, rows) => `<label class="field"><span>${label}</span>${rows ? `<textarea data-k="${k}" rows="${rows}">${esc(s[k])}</textarea>` : `<input data-k="${k}" value="${esc(s[k])}">`}</label>`;
    view.innerHTML = head('Site content', 'Everything visitors read on the homepage.') + `
      <div class="grid g2">
        <div class="panel"><h3>Hero</h3>${txt('hero_name', 'Name')}${txt('hero_roles', 'Roles (comma separated)')}${txt('hero_tagline', 'Tagline', 3)}</div>
        <div class="panel"><h3>About</h3>${txt('about_title', 'Heading')}${txt('about_body', 'Biography (blank line = new paragraph)', 10)}${txt('stats', 'Stats: one per line as  number|label', 5)}</div>
        <div class="panel"><h3>Quote</h3>${txt('quote', 'Pull quote', 3)}<h3 style="margin-top:20px">Speaking invitation</h3>${txt('speaking_title', 'Heading')}${txt('speaking_body', 'Text', 3)}</div>
        <div class="panel"><h3>Contact &amp; social links</h3>${txt('contact_email', 'Contact email')}${txt('social_instagram', 'Instagram URL')}${txt('social_youtube', 'YouTube URL')}${txt('social_x', 'X / Twitter URL')}${txt('social_facebook', 'Facebook URL')}${txt('social_linkedin', 'LinkedIn URL')}
          <h3 style="margin-top:20px">SEO</h3>${txt('site_title', 'Browser title')}${txt('meta_description', 'Description for Google', 3)}</div>
      </div><div class="row" style="margin-top:18px"><button class="btn gold" id="save">Save content</button></div>`;
    $('#save').onclick = () => act(() => api('/admin/settings', { method: 'PUT', body: Object.fromEntries($$('[data-k]').map((e) => [e.dataset.k, e.value])) }), 'Content saved');
  },

  async journey() {
    const { works } = await api('/admin/works');
    const kinds = ['career', 'book', 'film', 'talk', 'honour'];
    const form = (w = {}) => `<div class="cols">
      <label class="field"><span>Type</span><select data-f="kind" style="width:100%;padding:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px">${kinds.map((k) => `<option ${w.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="field"><span>Label (e.g. 2019–2023)</span><input data-f="period" value="${esc(w.period || '')}"></label></div>
      <label class="field"><span>Title</span><input data-f="title" value="${esc(w.title || '')}"></label>
      <label class="field"><span>Details</span><textarea data-f="subtitle" rows="2">${esc(w.subtitle || '')}</textarea></label>
      <label class="field"><span>Order (lower first)</span><input data-f="sort" type="number" value="${w.sort ?? ''}"></label>`;
    const read = (root) => Object.fromEntries($$('[data-f]', root).map((e) => [e.dataset.f, e.value]));
    view.innerHTML = head('Journey', 'Career, film, talks and honours shown on the homepage.') + `
      <div class="panel drawer"><h3>Add entry</h3><div id="new">${form()}</div><button class="btn gold s" id="add">Add</button></div>
      ${works.map((w) => `<div class="panel" style="margin-bottom:12px" data-id="${w.id}">${form(w)}<div class="row"><button class="btn s" data-save>Save</button><button class="btn danger s" data-del>Delete</button></div></div>`).join('')}`;
    $('#add').onclick = () => act(async () => { await api('/admin/works', { method: 'POST', body: read($('#new')) }); route(); }, 'Added');
    $$('[data-id]').forEach((p) => {
      $('[data-save]', p).onclick = () => act(() => api('/admin/works/' + p.dataset.id, { method: 'PUT', body: read(p) }), 'Saved');
      $('[data-del]', p).onclick = () => confirm('Delete this entry?') && act(async () => { await api('/admin/works/' + p.dataset.id, { method: 'DELETE' }); route(); });
    });
  },

  async social() {
    const [{ settings: s, instagram: ig }, { posts }] = await Promise.all([api('/admin/settings'), api('/admin/social')]);
    view.innerHTML = head('Social feed', 'Instagram posts and reels are pulled in automatically every hour.') + `
      <div class="grid g2">
        <div class="panel"><h3>Instagram connection</h3>
          <p class="muted small">Status: ${esc(ig.status)} · Token: ${ig.hasToken ? 'saved ✓' : 'not set'}</p>
          <label class="field"><span>Access token (Instagram API with Instagram Login, long-lived)</span><input id="ig-token" type="password" placeholder="${ig.hasToken ? '•••••••• (leave blank to keep)' : 'Paste token'}" autocomplete="off"></label>
          <div class="row"><button class="btn gold s" id="ig-save">Save</button><button class="btn s" id="ig-sync">Sync now</button></div>
          <p class="muted small" style="margin-top:14px">Create a token at developers.facebook.com → your app → Instagram → API setup. The profile must be a Professional (Business/Creator) account. The site refreshes the token automatically.</p></div>
        <div class="panel"><h3>Add a post manually</h3>
          <label class="field"><span>Image</span><input type="file" id="m-file" accept="image/*"></label>
          <label class="field"><span>Caption</span><input id="m-cap"></label>
          <label class="field"><span>Link (Instagram / YouTube URL)</span><input id="m-link"></label>
          <button class="btn s" id="m-add">Add post</button></div>
      </div>
      <div class="panel" style="margin-top:16px"><h3>Feed (${posts.length})</h3><div class="ig">
        ${posts.map((p) => `<div class="it ${p.hidden ? 'hid' : ''}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}<div class="acts">
          <button data-hide="${p.id}" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Show' : 'Hide'}</button><button data-rm="${p.id}">✕</button></div></div>`).join('') || '<span class="muted">Nothing yet.</span>'}</div></div>`;
    $('#ig-save').onclick = () => act(async () => { await api('/admin/instagram', { method: 'PUT', body: { token: $('#ig-token').value } }); route(); }, 'Saved');
    $('#ig-sync').onclick = () => act(async () => { const r = await api('/admin/instagram/sync', { method: 'POST' }); if (!r.ok) throw new Error(r.message); route(); }, 'Synced');
    $('#m-add').onclick = () => { const f = $('#m-file').files[0]; if (!f) return toast('Choose an image', true); const fd = new FormData(); fd.append('caption', $('#m-cap').value); fd.append('permalink', $('#m-link').value); fd.append('file', f); act(async () => { await api('/admin/social', { method: 'POST', form: fd }); route(); }, 'Added'); };
    $$('[data-hide]').forEach((b) => (b.onclick = () => act(async () => { await api('/admin/social/' + b.dataset.hide, { method: 'PUT', body: { hidden: b.dataset.h === '1' } }); route(); })));
    $$('[data-rm]').forEach((b) => (b.onclick = () => confirm('Remove from feed?') && act(async () => { await api('/admin/social/' + b.dataset.rm, { method: 'DELETE' }); route(); })));
  },

  async account() {
    view.innerHTML = head('Security', 'Change your admin password.') + `<div class="panel" style="max-width:420px"><label class="field"><span>New password (10+ characters)</span><input id="pw" type="password" autocomplete="new-password"></label><button class="btn gold s" id="pwgo">Update password</button></div>`;
    $('#pwgo').onclick = () => act(async () => { await api('/admin/password', { method: 'POST', body: { password: $('#pw').value } }); $('#pw').value = ''; }, 'Password updated');
  },
};

function filmRow(m) {
  return `<div class="film">${m.poster ? `<img src="${esc(m.poster)}" alt="">` : '<div class="noimg">No poster</div>'}
    <div><h4>${esc(m.title)}</h4><div class="row"><span class="pill ${m.status}">${m.status}${m.status === 'processing' ? ' ' + m.progress.toFixed(0) + '%' : ''}</span>
      ${m.published ? '<span class="pill pub">published</span>' : '<span class="pill">draft</span>'}<span class="muted small">${rupees(m.price_paise)} · ${Math.round(m.preview_sec / 60)} min free${m.duration_sec ? ' · ' + runtime(m.duration_sec) : ''}</span></div></div>
    <button class="btn s" data-edit="${m.id}">Manage</button></div>`;
}

function upload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append('file', file);
    const x = new XMLHttpRequest();
    x.open('POST', '/api' + path);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.((e.loaded / e.total) * 100);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* noop */ } x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Upload failed')); };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(fd);
  });
}

async function route() {
  clearTimeout(poll);
  const [name, arg] = (location.hash.slice(1) || 'dashboard').split('/');
  const key = views[name] ? name : 'dashboard';
  $$('#menu a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + (key === 'film' ? 'films' : key)));
  try { await views[key](arg); } catch (e) { view.innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`; }
}

$('#logout').onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); location.href = '/'; };
addEventListener('hashchange', route);
getUser().then((u) => (u?.role === 'admin' ? route() : (location.href = '/login.html?next=/admin')));
