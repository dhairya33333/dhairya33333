import { api, $, $$, esc, rupees, runtime, getUser } from '/js/common.js';

const view = $('#view');
const toast = (msg, err) => { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 3200); };
const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); } };
const fmt = (d) => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
const head = (t, l) => `<h1 class="t">${t}</h1><p class="lede">${l}</p>`;
let poll;

function setBadge(n) { const a = $('#inbox-link'); if (a) a.innerHTML = 'Inbox' + (n ? `<span class="badge-n">${n}</span>` : ''); }

const views = {
  async dashboard() {
    const s = await api('/admin/stats'); setBadge(s.unread_messages);
    view.innerHTML = head('Dashboard', 'How the film is doing.') + `
      <div class="grid g4">
        <div class="panel kpi"><b>${rupees(s.revenue_paise)}</b><span>Revenue</span></div>
        <div class="panel kpi"><b>${s.orders_paid}</b><span>Paid orders</span></div>
        <div class="panel kpi"><b>${s.users}</b><span>Viewers signed up</span></div>
        <a class="panel kpi" href="#inbox" style="display:block"><b>${s.unread_messages}</b><span>Unread messages</span></a>
        <div class="panel kpi"><b>${s.movies}</b><span>Films</span></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Payments</h3>
          <span class="pill ${['razorpay', 'cashfree'].includes(s.paymentsMode) ? 'PAID' : s.paymentsMode === 'demo' ? 'CREATED' : 'FAILED'}">${s.paymentsMode}</span>
          <span class="muted small" style="margin-left:10px">${['razorpay', 'cashfree'].includes(s.paymentsMode) ? 'Live gateway connected.' : s.paymentsMode === 'demo' ? 'Demo: purchases are simulated. Add gateway keys in .env.' : 'NOT configured. Customers cannot pay. Add gateway keys in .env.'}</span>
          <p class="muted small" style="margin:10px 0 0">Refunded orders: ${s.orders_refunded}</p></div>
        <div class="panel"><h3>Google sign-in</h3>
          <span class="pill ${s.googleConfigured ? 'PAID' : 'CREATED'}">${s.googleConfigured ? 'on' : 'off'}</span>
          <span class="muted small" style="margin-left:10px">${s.googleConfigured ? 'Visitors can continue with Google.' : 'Add GOOGLE_CLIENT_ID in .env to enable.'}</span>
          <h3 style="margin-top:18px">Video tools</h3><span class="pill ${s.ffmpegOk ? 'PAID' : 'FAILED'}">ffmpeg ${s.ffmpegOk ? 'ok' : 'MISSING'}</span>
          ${s.ffmpegOk ? '' : '<span class="small" style="color:var(--danger);margin-left:8px">Films cannot be processed until ffmpeg is installed for the service user.</span>'}</div>
      </div>
      ${s.legal_placeholders ? `<a class="panel" href="#legal" style="display:block;margin-top:16px;border-left:4px solid var(--danger)"><b>Legal pages still contain ${s.legal_placeholders} [placeholders].</b> <span class="muted small">Fill them in and have the text reviewed before launch →</span></a>` : ''}
      <div class="panel" style="margin-top:16px"><h3>Disk &amp; storage</h3><div id="storage" class="muted small">Loading…</div></div>
      <div class="panel" style="margin-top:16px"><h3>Recent sales</h3><div class="tablewrap"><table><tr><th>When</th><th>Viewer</th><th>Film</th><th>Amount</th></tr>
        ${s.recent.map((o) => `<tr><td>${fmt(o.paid_at)}</td><td>${esc(o.name)}</td><td>${esc(o.title)}</td><td>${rupees(o.amount_paise)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sales yet.</td></tr>'}</table></div></div>`;

    api('/admin/storage').then((u) => {
      const label = { originals_uploaded: 'Original films (uploaded)', originals_incoming: 'Original films (incoming folder)', processed_hls: 'Processed streaming files', posters_and_images: 'Posters & images', partial_uploads: 'Partial uploads', backups: 'Backups on this disk' };
      $('#storage').innerHTML = `${u.low_disk ? '<p style="color:var(--danger);font-weight:500">Low disk space. Free some space before uploading or encoding.</p>' : ''}
        <p><b>${u.free_gb} GB free</b> of ${u.total_gb} GB (${u.reserve_gb} GB is always kept in reserve)</p>
        <table>${Object.entries(u.parts_gb).map(([k, v]) => `<tr><td>${label[k]}</td><td style="text-align:right">${v} GB</td></tr>`).join('')}</table>`;
    }).catch(() => ($('#storage').textContent = 'Could not read disk usage.'));
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
    if (movies.some((m) => ['queued', 'processing'].includes(m.encode_state))) poll = setTimeout(() => route(), 4000);
  },

  async film(id) {
    const { movies } = await api('/admin/movies');
    const m = movies.find((x) => x.id === Number(id));
    if (!m) { location.hash = '#films'; return; }
    const [inc, up] = await Promise.all([api('/admin/incoming'), api(`/admin/movies/${m.id}/uploads`)]);
    const busy = ['queued', 'processing'].includes(m.encode_state);
    view.innerHTML = head(esc(m.title), `<a class="link" href="#films">← All films</a> &nbsp; <span class="pill ${m.encode_state === 'idle' ? m.status : m.encode_state}">${m.encode_state === 'idle' ? m.status : m.encode_state}</span>`) + `
      <div class="grid g2">
        <div class="panel"><h3>Details</h3>
          <label class="field"><span>Title</span><input id="f-title" value="${esc(m.title)}"></label>
          <label class="field"><span>Tagline</span><input id="f-tag" value="${esc(m.tagline)}"></label>
          <label class="field"><span>Description</span><textarea id="f-desc">${esc(m.description)}</textarea></label>
          <div class="cols"><label class="field"><span>Year</span><input id="f-year" value="${esc(m.year)}"></label>
            <label class="field"><span>Price (₹)</span><input id="f-price" type="number" min="1" step="any" value="${m.price_paise / 100}"></label></div>
          <label class="field"><span>Free preview (minutes)</span><input id="f-prev" type="number" min="0" step="any" value="${+(m.preview_sec / 60).toFixed(2)}"></label>
          <label class="check"><input type="checkbox" id="f-pub" ${m.published ? 'checked' : ''}> Published (visible on the site)</label>
          <label class="check"><input type="checkbox" id="f-feat" ${m.featured ? 'checked' : ''}> Featured on the homepage</label>
          <div class="row" style="margin-top:16px"><button class="btn gold s" id="save">Save changes</button>
            <button class="btn danger s" id="del">Delete film</button></div></div>
        <div>
          <div class="panel"><h3>Film file ${m.duration_sec ? `· ${runtime(m.duration_sec)}` : ''}</h3>
            ${m.encode_state === 'queued' ? '<p>Waiting for an encoder slot…</p>' : ''}
            ${m.encode_state === 'processing' ? `<p>Encoding for streaming… ${m.progress.toFixed(0)}%</p><div class="bar"><i style="width:${m.progress}%"></i></div><p class="muted small">This can take a long time for a full-length film. You can leave this page.</p>` : ''}
            ${busy ? '<button class="btn danger s" id="cancelenc">Cancel processing</button>' : ''}
            ${m.encode_state === 'failed' ? `<p style="color:var(--danger)"><b>Processing failed.</b> ${esc(m.error || '')}</p><p class="muted small">The original file is untouched${m.status === 'ready' ? ' and the published film is still playing the previous version' : ''}.</p>` : ''}
            ${m.status === 'ready' && m.validated && m.encode_state === 'idle' ? `<p style="color:var(--ok)">Ready to stream. Passed validation: ${m.segments || '?'} segments, ${m.output_bytes ? (m.output_bytes / 1024 ** 3).toFixed(2) + ' GB' : ''}${m.encode_seconds ? `, encoded in ${Math.round(m.encode_seconds / 60)} min` : ''}.</p>` : ''}
            <div class="row">${m.has_source && !busy ? '<button class="btn s" id="reproc">Re-process</button>' : ''}
              ${m.source_in_library && m.status === 'ready' && m.validated && !busy ? '<button class="btn danger s" id="rmsrc">Remove original…</button>' : ''}</div>
            ${m.source_in_library ? '<p class="muted small">The original is kept on the server until you approve its removal. Keep a backup copy elsewhere before removing it.</p>' : ''}
            <label class="field" style="margin-top:14px"><span>Upload from this computer (mp4, mov, mkv). Large files upload in resumable pieces.</span><input type="file" id="vid" accept="video/*,.mkv" ${busy ? 'disabled' : ''}></label>
            <div class="bar" id="upbar" hidden><i></i></div><p class="muted small" id="uptext" role="status" aria-live="polite"></p>
            <p class="muted small">Limit: ${(up.maxBytes / 1024 ** 3).toFixed(0)} GB per file. For a very large film, copying it to the server's <b>incoming</b> folder over SFTP is faster. Then pick it here:</p>
            <div class="row"><select id="imp" class="field" style="margin:0;flex:1;padding:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px">
              <option value="">Choose a file…</option>${inc.files.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${(f.size / 1e9).toFixed(2)} GB)</option>`).join('')}</select>
              <button class="btn s" id="impgo" ${busy ? 'disabled' : ''}>Process</button></div>
            ${up.uploads.length ? `<h3 style="margin-top:20px">Recent uploads</h3><table>${up.uploads.slice(0, 5).map((u) => `<tr><td class="small">${esc(u.name || '')}</td><td><span class="pill ${u.status === 'completed' ? 'ready' : u.status === 'failed' ? 'failed' : 'processing'}">${u.status}</span></td><td class="small muted">${esc(u.error || '')}</td></tr>`).join('')}</table>` : ''}</div>
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
    $('#cancelenc')?.addEventListener('click', () => confirm('Stop processing this film? The original file and any published version are not affected.') && act(async () => { await api(`/admin/movies/${m.id}/cancel-encode`, { method: 'POST' }); route(); }, 'Cancelled'));
    $('#rmsrc')?.addEventListener('click', () => { const t = prompt('This permanently deletes the ORIGINAL uploaded film from the server. The processed film stays. Make sure you have your own backup.\n\nType DELETE to confirm:'); if (t) act(async () => { await api(`/admin/movies/${m.id}/cleanup-source`, { method: 'POST', body: { confirm: t } }); route(); }, 'Original removed'); });
    $('#reproc')?.addEventListener('click', () => act(async () => { await api(`/admin/movies/${m.id}/reprocess`, { method: 'POST' }); route(); }, 'Re-processing started'));
    $('#impgo').onclick = () => $('#imp').value && act(async () => { await api(`/admin/movies/${m.id}/import`, { method: 'POST', body: { file: $('#imp').value } }); route(); }, 'Processing started');
    for (const k of ['poster', 'trailer']) $('#' + k).onchange = (e) => upload(`/admin/movies/${m.id}/${k}`, e.target.files[0]).then(() => { toast('Uploaded'); route(); }).catch((x) => toast(x.message, true));
    $('#vid').onchange = (e) => { const f = e.target.files[0]; if (f) chunkedUpload(m.id, f, up.chunkBytes); };
    if (busy) poll = setTimeout(() => route(), 4000);
  },

  async inbox() {
    const { messages, unread } = await api('/admin/messages');
    setBadge(unread);
    const topic = { general: 'General', speaking: 'Speaking', film: 'Film', press: 'Press', collaboration: 'Collaboration', other: 'Other' };
    view.innerHTML = head('Inbox', 'Messages sent through the Contact page. Reply from your own email: the button opens a pre-filled message.') +
      (messages.map((m) => `<div class="msg-card ${m.is_read ? '' : 'unread'}" data-id="${m.id}">
        <h4>${esc(m.name)} <span class="pill">${esc(topic[m.topic] || m.topic)}</span></h4>
        <div class="meta">${esc(m.email)}${m.phone ? ' · ' + esc(m.phone) : ''}${m.organisation ? ' · ' + esc(m.organisation) : ''} · ${fmt(m.created_at)}</div>
        <div class="body">${esc(m.message)}</div>
        <div class="row" style="margin-top:14px"><a class="btn gold s" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to Yogesh Singh')}" data-read>Reply by email</a>
          <button class="btn s" data-toggle="${m.is_read ? 0 : 1}">${m.is_read ? 'Mark unread' : 'Mark read'}</button><button class="btn danger s" data-del>Delete</button></div></div>`).join('')
        || '<div class="panel"><p class="muted">No messages yet. Messages from the Contact page will appear here.</p></div>');
    $$('.msg-card').forEach((c) => {
      const id = c.dataset.id;
      $('[data-toggle]', c).onclick = (e) => act(async () => { await api('/admin/messages/' + id, { method: 'PUT', body: { read: e.target.dataset.toggle === '1' } }); route(); });
      $('[data-read]', c).onclick = () => api('/admin/messages/' + id, { method: 'PUT', body: { read: true } }).catch(() => {});
      $('[data-del]', c).onclick = () => confirm('Delete this message permanently?') && act(async () => { await api('/admin/messages/' + id, { method: 'DELETE' }); route(); }, 'Deleted');
    });
  },

  async orders() {
    const { orders } = await api('/admin/orders');
    view.innerHTML = head('Orders', 'Latest 300 orders.') + `<div class="panel tablewrap"><table><tr><th>Date</th><th>Order</th><th>Viewer</th><th>Film</th><th>Amount</th><th>Gateway</th><th>Status</th></tr>
      ${orders.map((o) => `<tr><td>${fmt(o.created_at)}</td><td class="small muted">${esc(o.order_id)}</td><td>${esc(o.name)}<br><span class="muted small">${esc(o.email)}</span></td><td>${esc(o.title)}</td><td>${rupees(o.amount_paise)}</td><td class="small muted">${esc(o.provider || '')}</td><td><span class="pill ${o.status}">${o.status.replace('_', ' ')}</span>${o.refunded_paise ? `<br><span class="small muted">refunded ${rupees(o.refunded_paise)}</span>` : ''}${o.dispute_status ? `<br><span class="small" style="color:var(--danger)">dispute: ${esc(o.dispute_status)}</span>` : ''}${o.status === 'PAID' || o.status === 'PARTIALLY_REFUNDED' ? ` <a href="#" class="link small" data-revoke="${esc(o.order_id)}">revoke access</a>` : ''}${o.failure_reason ? `<br><span class="small muted">${esc(o.failure_reason)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No orders yet.</td></tr>'}</table></div>`;
    $$('[data-revoke]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); confirm('Withdraw this buyer\'s access to the film? Use this for chargebacks or fraud. Refund money in the gateway separately.') && act(async () => { await api(`/admin/orders/${a.dataset.revoke}/revoke`, { method: 'POST' }); route(); }, 'Access revoked'); }));
  },

  async users() {
    const [{ users }, { movies }] = await Promise.all([api('/admin/users'), api('/admin/movies')]);
    view.innerHTML = head('Users', 'Everyone who signed up. Grant free access to guests, press and family.') + `
      <div class="panel drawer"><h3>Grant free access</h3><div class="row">
        <label class="field" style="margin:0;flex:1;min-width:220px"><span>User email</span><input id="g-email" type="email"></label>
        <label class="field" style="margin:0"><span>Film</span><select id="g-movie">${movies.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></label>
        <button class="btn gold s" id="g-go" style="align-self:flex-end">Grant</button></div></div>
      <div class="panel tablewrap"><table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Google</th><th>Films</th><th>Role</th></tr>
      ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '–')}</td><td>${fmt(u.created_at)}</td><td>${u.google ? '✓' : ''}</td><td>${u.purchases}</td>
        <td>${u.role === 'admin' ? '<span class="pill pub">admin</span>' : 'user'} <a href="#" class="link small" data-role="${u.id}" data-to="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'demote' : 'make admin'}</a> · <a href="#" class="link small" data-reset="${u.id}">reset link</a></td></tr>`).join('')}</table></div>`;
    $('#g-go').onclick = () => act(() => api('/admin/grant', { method: 'POST', body: { email: $('#g-email').value, movieId: $('#g-movie').value } }), 'Access granted');
    $$('[data-reset]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); act(async () => { const r = await api(`/admin/users/${a.dataset.reset}/reset-link`, { method: 'POST' }); prompt(`Send this one-time link to the user (valid ${r.expiresInMinutes} minutes). It will not be shown again:`, r.url); }); }));
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
        <div class="panel"><h3>Contact page &amp; social links</h3>${txt('contact_intro', 'Contact page intro', 3)}${txt('contact_email', 'Contact email (shown on the Contact page)')}${txt('contact_phone', 'Phone (optional)')}${txt('contact_location', 'Based in (optional)')}${txt('social_instagram', 'Instagram URL')}${txt('social_youtube', 'YouTube URL')}${txt('social_x', 'X / Twitter URL')}${txt('social_facebook', 'Facebook URL')}${txt('social_linkedin', 'LinkedIn URL')}
          <h3 style="margin-top:20px">Social page</h3>${txt('social_title', 'Heading')}${txt('social_intro', 'Intro text', 2)}<h3 style="margin-top:20px">SEO</h3>${txt('site_title', 'Browser title')}${txt('meta_description', 'Description for Google', 3)}</div>
      </div><div class="row" style="margin-top:18px"><button class="btn gold" id="save">Save content</button></div>`;
    $('#save').onclick = () => act(() => api('/admin/settings', { method: 'PUT', body: Object.fromEntries($$('[data-k]').map((e) => [e.dataset.k, e.value])) }), 'Content saved');
  },

  async legal() {
    const { pages, updated } = await api('/admin/legal');
    view.innerHTML = head('Legal pages', 'Privacy Policy, Terms of Use and Refund Policy, shown on the website footer and agreed to at checkout. Payment providers ask for these before activating an account.') + `
      <div class="panel" style="border-left:4px solid var(--danger);margin-bottom:16px"><b>These are starting templates, not legal advice.</b>
        <p class="small muted" style="margin:6px 0 0">Replace every <b>[bracketed]</b> item with your real details (business name, address, email, refund periods, city for courts) and have a lawyer review the text before launch. Format: <code>## Heading</code>, <code>- list item</code>, blank line between paragraphs, <code>**bold**</code>.${updated ? ` Last saved: ${esc(updated)}.` : ' Not saved yet: the website shows the templates.'}</p></div>
      ${pages.map((p) => `<div class="panel" style="margin-bottom:16px"><h3>${esc(p.title)} ${p.placeholders ? `<span class="pill FAILED" style="margin-left:8px">${p.placeholders} [placeholders] left</span>` : '<span class="pill PAID" style="margin-left:8px">no placeholders</span>'} <a class="link small" href="/${p.slug}" target="_blank" style="margin-left:10px">view page ↗</a></h3>
        <textarea data-legal="${p.slug}" rows="14" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:6px;font:13px/1.6 ui-monospace,Consolas,monospace;background:#fff;color:var(--ink)">${esc(p.body)}</textarea></div>`).join('')}
      <button class="btn gold" id="save">Save legal pages</button>`;
    $('#save').onclick = () => act(async () => { await api('/admin/legal', { method: 'PUT', body: Object.fromEntries($$('[data-legal]').map((t) => [t.dataset.legal, t.value])) }); route(); }, 'Saved');
  },

  async photos() {
    const [{ settings: st }, { items }] = await Promise.all([api('/admin/settings'), api('/admin/gallery')]);
    view.innerHTML = head('Photos', 'Portrait for the About page, and the public Gallery. Photos are resized, converted to WebP and stripped of camera location data automatically.') + `
      <div class="panel" style="margin-bottom:16px"><h3>Portrait</h3><div class="row" style="align-items:flex-start;gap:18px">
        ${st.portrait ? `<img src="${esc(st.portrait)}" alt="" style="width:120px;border-radius:6px">` : '<span class="muted small">No portrait yet.</span>'}
        <div><label class="field"><span>Upload portrait (JPG, PNG or WebP, up to 25 MB)</span><input type="file" id="portrait" accept="image/jpeg,image/png,image/webp"></label>
        ${st.portrait ? '<button class="btn" id="portrait-rm">Remove portrait</button>' : ''}</div></div></div>
      <div class="panel" style="margin-bottom:16px"><h3>Gallery page text</h3>
        <label class="field"><span>Heading</span><input id="g-title" value="${esc(st.gallery_title)}"></label>
        <label class="field"><span>Intro</span><input id="g-intro" value="${esc(st.gallery_intro)}"></label>
        <button class="btn gold" id="g-save">Save text</button></div>
      <div class="panel"><h3>Add photos</h3><div class="row">
        <input type="file" id="g-files" accept="image/jpeg,image/png,image/webp" multiple><input id="g-cap" placeholder="Caption (optional)" style="flex:1;min-width:160px"><button class="btn gold" id="g-add">Upload</button></div></div>
      <div class="grid g4" style="margin-top:16px">${items.map((g) => `<div class="panel" style="padding:10px;${g.hidden ? 'opacity:.55' : ''}">
        <img src="${esc(g.thumb)}" alt="" style="width:100%;border-radius:4px"><input data-cap="${g.id}" value="${esc(g.caption)}" placeholder="Caption" style="width:100%;margin:8px 0">
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn" data-mv="up" data-id="${g.id}" aria-label="Move earlier">←</button><button class="btn" data-mv="down" data-id="${g.id}" aria-label="Move later">→</button>
        <button class="btn" data-hid="${g.id}" data-h="${g.hidden ? 0 : 1}">${g.hidden ? 'Show' : 'Hide'}</button><button class="btn" data-del="${g.id}">Delete</button></div></div>`).join('') || '<p class="muted">No photos yet.</p>'}</div>`;
    $('#portrait').onchange = (e) => e.target.files[0] && act(async () => { await upload('/admin/portrait', e.target.files[0]); route(); }, 'Portrait updated');
    $('#portrait-rm')?.addEventListener('click', () => act(async () => { await api('/admin/portrait', { method: 'DELETE' }); route(); }, 'Removed'));
    $('#g-save').onclick = () => act(() => api('/admin/settings', { method: 'PUT', body: { gallery_title: $('#g-title').value, gallery_intro: $('#g-intro').value } }), 'Saved');
    $('#g-add').onclick = () => { const fs = $('#g-files').files; if (!fs.length) return toast('Choose photos first', true); const fd = new FormData(); fd.append('caption', $('#g-cap').value); [...fs].forEach((f) => fd.append('files', f)); act(async () => { await api('/admin/gallery', { method: 'POST', form: fd }); route(); }, 'Photos added'); };
    $$('[data-cap]').forEach((i) => (i.onchange = () => act(() => api('/admin/gallery/' + i.dataset.cap, { method: 'PUT', body: { caption: i.value } }), 'Saved')));
    $$('[data-mv]').forEach((b) => (b.onclick = () => act(async () => { await api('/admin/gallery/' + b.dataset.id, { method: 'PUT', body: { move: b.dataset.mv } }); route(); })));
    $$('[data-hid]').forEach((b) => (b.onclick = () => act(async () => { await api('/admin/gallery/' + b.dataset.hid, { method: 'PUT', body: { hidden: b.dataset.h === '1' } }); route(); })));
    $$('[data-del]').forEach((b) => (b.onclick = () => confirm('Delete this photo?') && act(async () => { await api('/admin/gallery/' + b.dataset.del, { method: 'DELETE' }); route(); }, 'Deleted')));
  },
  async journey() {
    const { works } = await api('/admin/works');
    const kinds = ['career', 'book', 'film', 'talk', 'article', 'honour'];
    const form = (w = {}) => `<div class="cols">
      <label class="field"><span>Type</span><select data-f="kind" style="width:100%;padding:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px">${kinds.map((k) => `<option ${w.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="field"><span>Label (e.g. 2019–2023)</span><input data-f="period" value="${esc(w.period || '')}"></label></div>
      <label class="field"><span>Title</span><input data-f="title" value="${esc(w.title || '')}"></label>
      <label class="field"><span>Details</span><textarea data-f="subtitle" rows="2">${esc(w.subtitle || '')}</textarea></label>
      <label class="field"><span>Link (optional, used for articles)</span><input data-f="url" type="url" placeholder="https://" value="${esc(w.url || '')}"></label>
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
    view.innerHTML = head('Social feed', 'Two ways to fill the website\'s Social page: paste post links (works immediately, no setup), or connect an access token so new posts arrive automatically every hour.') + `
      <div class="grid g2">
        <div class="panel"><h3>Instagram connection</h3>
          <p class="muted small">Status: ${esc(ig.status)} · Token: ${ig.hasToken ? 'saved ✓' : 'not set'}</p>
          <label class="field"><span>Access token (Instagram API with Instagram Login, long-lived)</span><input id="ig-token" type="password" placeholder="${ig.hasToken ? '•••••••• (leave blank to keep)' : 'Paste token'}" autocomplete="off"></label>
          <div class="row"><button class="btn gold s" id="ig-save">Save</button><button class="btn s" id="ig-sync">Sync now</button></div>
          <p class="muted small" style="margin-top:14px">Create a token at developers.facebook.com → your app → Instagram → API setup. The profile must be a Professional (Business/Creator) account. The site refreshes the token automatically.</p></div>
        <div class="panel" style="grid-column:1/-1"><h3>Add an Instagram post or reel by link</h3>
          <p class="muted small">Paste the link from Instagram (the post's “…” menu → <b>Copy link</b>). The site reads its cover image and caption and shows it as a clean card on the Social page; clicking the card plays the real post or reel in a viewer. Works for public accounts. If Instagram does not hand over a cover, use <b>Upload cover</b> (any screenshot or thumbnail works).</p>
          <div class="linkrow"><input id="ig-link" type="url" placeholder="https://www.instagram.com/reel/XXXXXXXXXXX/" autocomplete="off"><button class="btn gold s" id="ig-add">Add to website</button></div>
          ${posts.filter((p) => p.source === 'embed').length ? `<div style="margin-top:18px">${posts.filter((p) => p.source === 'embed').map((p) => `
          <div class="emb" style="display:grid;grid-template-columns:64px 1fr auto;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--line)">
            ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" style="width:64px;height:80px;object-fit:cover;border-radius:6px;background:#e9e5db">` : '<div style="width:64px;height:80px;border-radius:6px;background:#e9e5db;display:grid;place-items:center;font-size:11px;color:var(--muted);text-align:center">no cover</div>'}
            <div><a class="link" href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.permalink.replace('https://www.instagram.com', ''))}</a>
              <div class="small muted" style="margin-top:4px">${p.author ? '@' + esc(p.author) + ' · ' : ''}${p.cover_source === 'uploaded' ? 'cover uploaded by you' : p.thumb ? 'cover fetched from Instagram' : '<b style="color:var(--danger)">no cover yet</b>: press “Fetch cover” or upload one'}</div>
              <div class="small" style="margin-top:4px;max-width:520px">${p.caption ? esc(p.caption.slice(0, 140)) + (p.caption.length > 140 ? '…' : '') : '<span class="muted">no caption</span>'}</div></div>
            <div class="row" style="justify-content:flex-end"><span class="pill ${p.hidden ? '' : 'pub'}">${p.hidden ? 'hidden' : 'shown'}</span>
              <button class="btn s" data-refresh="${p.id}">Fetch cover</button>
              <label class="btn s" style="cursor:pointer">Upload cover<input type="file" accept="image/jpeg,image/png,image/webp" data-cover="${p.id}" hidden></label>
              <button class="btn s" data-cap="${p.id}">Caption</button>
              <button class="btn s" data-hide="${p.id}" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Show' : 'Hide'}</button><button class="btn danger s" data-rm="${p.id}">Remove</button></div></div>`).join('')}</div>` : ''}</div>
        <div class="panel"><h3>Add a post manually</h3>
          <label class="field"><span>Image</span><input type="file" id="m-file" accept="image/*"></label>
          <label class="field"><span>Caption</span><input id="m-cap"></label>
          <label class="field"><span>Link (Instagram / YouTube URL)</span><input id="m-link"></label>
          <button class="btn s" id="m-add">Add post</button></div>
      </div>
      <div class="panel" style="margin-top:16px"><h3>Feed thumbnails (${posts.filter((p) => p.source !== 'embed').length})</h3><div class="ig">
        ${posts.filter((p) => p.source !== 'embed').map((p) => `<div class="it ${p.hidden ? 'hid' : ''}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ''}<div class="acts">
          <button data-hide="${p.id}" data-h="${p.hidden ? 0 : 1}">${p.hidden ? 'Show' : 'Hide'}</button><button data-rm="${p.id}">✕</button></div></div>`).join('') || '<span class="muted">Nothing yet.</span>'}</div></div>`;
    $('#ig-add').onclick = () => act(async () => {
      const r = await api('/admin/social/embed', { method: 'POST', body: { url: $('#ig-link').value } });
      toast(r.cover ? 'Added with its cover image' : 'Added. Instagram did not provide a cover: use “Upload cover” (or “Fetch cover” to retry)', !r.cover);
      route();
    });
    $$('[data-refresh]').forEach((b) => (b.onclick = () => act(async () => { b.disabled = true; const r = await api(`/admin/social/${b.dataset.refresh}/refresh`, { method: 'POST' }); toast(r.cover ? 'Cover updated' : 'Instagram did not provide a cover. Upload one instead.', !r.cover); route(); })));
    $$('[data-cover]').forEach((i) => (i.onchange = () => { const f = i.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); act(async () => { await api(`/admin/social/${i.dataset.cover}/cover`, { method: 'POST', form: fd }); route(); }, 'Cover uploaded'); }));
    $$('[data-cap]').forEach((b) => (b.onclick = () => { const p = posts.find((x) => x.id === Number(b.dataset.cap)); const t = prompt('Caption shown on the website for this post:', p?.caption || ''); if (t !== null) act(async () => { await api('/admin/social/' + b.dataset.cap, { method: 'PUT', body: { caption: t } }); route(); }, 'Caption saved'); }));
    $('#ig-save').onclick = () => act(async () => { await api('/admin/instagram', { method: 'PUT', body: { token: $('#ig-token').value } }); route(); }, 'Saved');
    $('#ig-sync').onclick = () => act(async () => { const r = await api('/admin/instagram/sync', { method: 'POST' }); if (!r.ok) throw new Error(r.message); route(); }, 'Synced');
    $('#m-add').onclick = () => { const f = $('#m-file').files[0]; if (!f) return toast('Choose an image', true); const fd = new FormData(); fd.append('caption', $('#m-cap').value); fd.append('permalink', $('#m-link').value); fd.append('file', f); act(async () => { await api('/admin/social', { method: 'POST', form: fd }); route(); }, 'Added'); };
    $$('[data-hide]').forEach((b) => (b.onclick = () => act(async () => { await api('/admin/social/' + b.dataset.hide, { method: 'PUT', body: { hidden: b.dataset.h === '1' } }); route(); })));
    $$('[data-rm]').forEach((b) => (b.onclick = () => confirm('Remove from feed?') && act(async () => { await api('/admin/social/' + b.dataset.rm, { method: 'DELETE' }); route(); })));
  },

  async account() {
    const { user } = await api('/auth/me');
    view.innerHTML = head('Security', 'Your password and two-step sign-in.') + `
      ${user.twofaRequired ? '<div class="panel" style="border-left:4px solid var(--danger);margin-bottom:16px"><b>Two-step sign-in is required for the admin panel.</b> Turn it on below to continue.</div>' : ''}
      <div class="grid g2"><div class="panel"><h3>Password</h3><p class="muted small">All your other signed-in devices are signed out.</p>
        <label class="field"><span>Current password</span><input id="pwc" type="password" autocomplete="current-password"></label><label class="field"><span>New password (10+ characters recommended)</span><input id="pw" type="password" autocomplete="new-password"></label><button class="btn gold s" id="pwgo">Update password</button></div>
      <div class="panel" id="tf"><h3>Two-step sign-in <span class="pill ${user.twofa ? 'PAID' : 'CREATED'}">${user.twofa ? 'on' : 'off'}</span></h3>
        <p class="muted small">${user.twofa ? 'Sign-in needs a code from your authenticator app as well as your password.' : 'Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) to sign-in. Strongly recommended for the admin account.'}</p>
        <label class="field"><span>Your password</span><input id="tf-pw" type="password" autocomplete="current-password"></label>
        ${user.twofa ? '<label class="field"><span>Current code (or a recovery code)</span><input id="tf-code" inputmode="numeric" autocomplete="one-time-code"></label><button class="btn s" id="tf-off">Turn off</button>' : '<button class="btn gold s" id="tf-on">Set up two-step sign-in</button>'}
        <div id="tf-out"></div></div></div>`;
    $('#pwgo').onclick = () => act(async () => { await api('/auth/password', { method: 'POST', body: { current: $('#pwc').value, password: $('#pw').value } }); $('#pw').value = ''; $('#pwc').value = ''; }, 'Password updated');
    $('#tf-on')?.addEventListener('click', () => act(async () => {
      const r = await api('/auth/2fa/setup', { method: 'POST', body: { password: $('#tf-pw').value } });
      $('#tf-out').innerHTML = `<p class="small" style="margin-top:14px"><b>1.</b> Scan this with your authenticator app, or type the key by hand.<br><b>2.</b> Type the 6-digit code it shows.</p>
        <img src="${esc(r.qr)}" alt="QR code for your authenticator app" width="220" height="220" style="display:block;margin:10px 0"><code style="word-break:break-all">${esc(r.secret)}</code>
        <label class="field" style="margin-top:12px"><span>Code from the app</span><input id="tf-c" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label><button class="btn gold s" id="tf-ok">Turn on</button>`;
      $('#tf-ok').onclick = () => act(async () => {
        const d = await api('/auth/2fa/enable', { method: 'POST', body: { code: $('#tf-c').value } });
        $('#tf').innerHTML = `<h3>Two-step sign-in is on</h3><div class="panel" style="border-left:4px solid var(--danger)"><b>Save these recovery codes now.</b> Each works once if you lose your phone. They will not be shown again.
          <pre style="font-size:16px;line-height:1.8;user-select:all">${d.recoveryCodes.map(esc).join('\n')}</pre></div><button class="btn gold s" id="tf-done" style="margin-top:12px">I have saved them</button>`;
        $('#tf-done').onclick = () => location.reload();
      });
    }));
    $('#tf-off')?.addEventListener('click', () => confirm('Turn off two-step sign-in?') && act(async () => { await api('/auth/2fa/disable', { method: 'POST', body: { password: $('#tf-pw').value, code: $('#tf-code').value } }); route(); }, 'Turned off'));
  },
};

function filmRow(m) {
  return `<div class="film">${m.poster ? `<img src="${esc(m.poster)}" alt="">` : '<div class="noimg">No poster</div>'}
    <div><h4>${esc(m.title)}</h4><div class="row"><span class="pill ${m.status}">${m.status}${m.status === 'processing' ? ' ' + m.progress.toFixed(0) + '%' : ''}</span>
      ${m.published ? '<span class="pill pub">published</span>' : '<span class="pill">draft</span>'}<span class="muted small">${rupees(m.price_paise)} · ${Math.round(m.preview_sec / 60)} min free${m.duration_sec ? ' · ' + runtime(m.duration_sec) : ''}</span></div></div>
    <button class="btn s" data-edit="${m.id}">Manage</button></div>`;
}

async function sha256Hex(blob) {
  if (!crypto?.subtle) return '';                                   // non-secure context: skip, the server treats the header as optional
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gbs = (n) => (n / 1024 ** 3).toFixed(2);

/** Resumable upload: sends the file in pieces, retries a failed piece, and continues after a page reload from where the server stopped. */
async function chunkedUpload(movieId, file, chunkBytes) {
  const key = `yp-upload-${movieId}-${file.name}-${file.size}`;
  const bar = $('#upbar'), text = $('#uptext'); bar.hidden = false; $('#vid').disabled = true;
  const progress = (n) => { $('i', bar).style.width = (n / file.size) * 100 + '%'; text.textContent = `Uploading ${gbs(n)} of ${gbs(file.size)} GB (${Math.round((n / file.size) * 100)}%). Keep this tab open.`; };
  try {
    let uid = localStorage.getItem(key), received = 0;
    if (uid) { try { const r = await api('/admin/uploads/' + uid); if (r.upload.status === 'uploading' && r.upload.size === file.size) received = r.upload.received; else uid = null; } catch { uid = null; } }
    if (!uid) { const r = await api(`/admin/movies/${movieId}/uploads`, { method: 'POST', body: { filename: file.name, size: file.size } }); uid = r.upload.id; chunkBytes = r.chunkBytes; localStorage.setItem(key, uid); }
    progress(received);
    while (received < file.size) {
      const end = Math.min(received + chunkBytes, file.size);
      let ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        try {
          const piece = file.slice(received, end);
          const sum = await sha256Hex(piece);       // the server verifies this while writing, so a damaged piece is resent
          const res = await fetch(`/api/admin/uploads/${uid}/chunk?offset=${received}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-chunk-sha256': sum }, body: piece, credentials: 'same-origin' });
          const data = await res.json().catch(() => ({}));
          if (res.ok) { received = data.received; ok = true; }
          else if (res.status === 422) throw new Error('checksum');            // damaged in transit: retry the same piece
          else if (res.status === 409 && Number.isInteger(data.received)) { received = data.received; ok = true; }   // server is ahead: resync
          else if (res.status >= 400 && res.status < 500 && res.status !== 400) throw new Error(data.error || 'Upload rejected');
          else throw new Error(data.error || 'Interrupted');
        } catch (e) {
          if (/rejected|space|limit/i.test(e.message) || attempt === 5) throw e;
          text.textContent = `Connection problem, retrying (${attempt + 1}/5)…`; await sleep(1500 * 2 ** attempt);
        }
      }
      progress(received);
    }
    const done = await api(`/admin/uploads/${uid}/complete`, { method: 'POST' });
    localStorage.removeItem(key);
    const est = done.estimate;
    toast(est ? `Uploaded. Encoding started: about ${gbs(est.estOutputBytes)} GB output (up to ${gbs(est.worstCaseBytes)} GB worst case), roughly ${Math.max(1, Math.round(est.estEncodeSeconds / 60))} min.` : 'Uploaded. Encoding started.');
  } catch (e) {
    toast(e.message + ' You can choose the same file again to resume.', true);
  }
  route();
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
  try { await views[key](arg); } catch (e) {
    if (e.code === '2fa_required' && key !== 'account') { location.hash = '#account'; return; } view.innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`; }
}

$('#logout').onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); location.href = '/'; };
addEventListener('hashchange', route);
getUser().then((u) => { if (u?.role === 'admin') { route(); api('/admin/stats').then((s) => setBadge(s.unread_messages)).catch(() => {}); } else location.href = '/login.html?next=/admin'; });
