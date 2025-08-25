// Admin client-side script served at /admin/app.js
// Kept as a plain string to avoid bundling; Hono route serves it with JS content-type.

export const ADMIN_CLIENT_JS = `
(function(){
  const S = {
    plan: document.getElementById('plan'),
    status: document.getElementById('status'),
    q: document.getElementById('q'),
    pageSize: document.getElementById('pageSize'),
    load: document.getElementById('load'),
    msg: document.getElementById('msg'),
    create: document.getElementById('create'),
    createMsg: document.getElementById('createMsg'),
    newKey: document.getElementById('newKey'),
    newPlan: document.getElementById('newPlan'),
    newStatus: document.getElementById('newStatus'),
    newExpires: document.getElementById('newExpires'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    pageInfo: document.getElementById('pageInfo'),
    tbody: document.querySelector('#tbl tbody')
  };

  let page = 1;

  function headers(){
    return { 'Content-Type': 'application/json' };
  }

  async function load(){
    try {
      S.msg.textContent = 'Loading...';
      const ps = Number(S.pageSize.value) || 25;
      const params = new URLSearchParams({ page: String(page), pageSize: String(ps) });
      if (S.plan.value) params.set('plan', S.plan.value);
      if (S.status.value) params.set('status', S.status.value);
      if (S.q.value) params.set('q', S.q.value.trim());
      const res = await fetch('/admin/api/licenses?' + params.toString(), { headers: headers() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Request failed');
      render(json.data);
      S.msg.textContent = '';
    } catch (e){
      S.msg.textContent = 'Error: ' + (e && e.message ? e.message : e);
    }
  }

  function render(data){
    const items = Array.isArray(data.items) ? data.items : [];
    S.tbody.innerHTML = '';
    for (const lic of items){
      const tr = document.createElement('tr');
      var html = '';
      html += '<td>' + lic.id + '</td>';
      html += '<td class="small">' + lic.license_key_hash + '</td>';
      html += '<td>';
      html += '<div class="select is-small"><select data-id="' + lic.id + '" data-field="plan">';
      html += '<option ' + (lic.plan==='free'?'selected':'') + '>free</option>';
      html += '<option ' + (lic.plan==='basic'?'selected':'') + '>basic</option>';
      html += '<option ' + (lic.plan==='pro'?'selected':'') + '>pro</option>';
      html += '</select></div>';
      html += '</td>';
      html += '<td>';
      html += '<div class="select is-small"><select data-id="' + lic.id + '" data-field="status">';
      html += '<option ' + (lic.status==='active'?'selected':'') + '>active</option>';
      html += '<option ' + (lic.status==='suspended'?'selected':'') + '>suspended</option>';
      html += '<option ' + (lic.status==='expired'?'selected':'') + '>expired</option>';
      html += '</select></div>';
      html += '</td>';
      html += '<td>';
      html += '<input class="input is-small" type="date" data-id="' + lic.id + '" data-field="expires_at" value="' + (lic.expires_at ? lic.expires_at.slice(0,10) : '') + '" />';
      html += '</td>';
      html += '<td>';
      html += '<input class="input is-small" type="number" min="0" step="1" data-id="' + lic.id + '" data-field="chars_used" value="' + String(lic.chars_used || 0) + '" />';
      html += '</td>';
      html += '<td>' + (lic.quota_remaining ?? '—') + '</td>';
      html += '<td>' + (lic.quota_limit ?? '—') + '</td>';
      html += '<td class="right">';
      html += '<div class="controls">';
      html += '<button class="button is-small is-link is-light save" data-id="' + lic.id + '">Save</button>';
      html += '<button class="button is-small is-warning is-light save-usage" data-id="' + lic.id + '">Save usage</button>';
      html += '<span class="small muted" id="msg-' + lic.id + '"></span>';
      html += '</div>';
      html += '</td>';
      tr.innerHTML = html;
      S.tbody.appendChild(tr);
    }
    S.pageInfo.textContent = 'Page ' + data.page + ' • Total ' + data.total;
  }

  async function saveRow(id){
    const plan = (document.querySelector('select[data-id="' + id + '"][data-field="plan"]')||{}).value;
    const status = (document.querySelector('select[data-id="' + id + '"][data-field="status"]')||{}).value;
    const expEl = (document.querySelector('input[data-id="' + id + '"][data-field="expires_at"]'));
    const expires_at = expEl && expEl.value ? new Date(expEl.value).toISOString() : null;
    const msg = document.getElementById('msg-'+id);
    try {
      msg.textContent = 'Saving...';
      const res = await fetch('/admin/api/licenses/'+id, { method: 'PATCH', headers: headers(), body: JSON.stringify({ plan, status, expires_at }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      msg.textContent = 'Saved'; msg.className = 'small success';
      setTimeout(()=>{ msg.textContent=''; msg.className='small muted'; }, 1500);
    } catch (e){
      msg.textContent = 'Error'; msg.className = 'small error';
    }
  }

  async function saveUsage(id){
    const usageEl = (document.querySelector('input[data-id="' + id + '"][data-field="chars_used"]'));
    const chars_used = usageEl && usageEl.value ? Number(usageEl.value) : 0;
    const msg = document.getElementById('msg-'+id);
    try {
      msg.textContent = 'Saving usage...';
      const res = await fetch('/admin/api/licenses/'+id+'/usage', { method: 'PATCH', headers: headers(), body: JSON.stringify({ chars_used }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      msg.textContent = 'Usage saved'; msg.className = 'small success';
      setTimeout(()=>{ msg.textContent=''; msg.className='small muted'; }, 1500);
      load();
    } catch (e){
      msg.textContent = 'Error'; msg.className = 'small error';
    }
  }

  async function create(){
    S.createMsg.textContent = 'Creating...'; S.createMsg.className = 'small muted';
    try {
      const license_key = S.newKey.value.trim();
      const plan = S.newPlan.value; const status = S.newStatus.value;
      const expires_at = S.newExpires.value ? new Date(S.newExpires.value).toISOString() : null;
      const res = await fetch('/admin/api/licenses', { method: 'POST', headers: headers(), body: JSON.stringify({ license_key, plan, status, expires_at }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      S.createMsg.textContent = 'Created id=' + json.data.id; S.createMsg.className = 'small success';
      S.newKey.value = ''; S.newExpires.value = '';
      load();
    } catch (e){
      S.createMsg.textContent = 'Error'; S.createMsg.className = 'small error';
    }
  }

  const THEME_KEY = 'LM_ADMIN_THEME';
  function applyTheme(t){ document.documentElement.setAttribute('data-theme', t); }
  function initTheme(){
    let t = localStorage.getItem(THEME_KEY);
    if (!t) { t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }
    applyTheme(t);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  }
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
  });

  S.load.addEventListener('click', () => { page = 1; load(); });
  S.prev.addEventListener('click', () => { if (page>1) { page--; load(); } });
  S.next.addEventListener('click', () => { page++; load(); });
  S.create.addEventListener('click', create);
  S.tbody.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains('save')) { const id = t.getAttribute('data-id'); saveRow(id); return; }
    if (t.classList && t.classList.contains('save-usage')) { const id = t.getAttribute('data-id'); saveUsage(id); return; }
    if (t.classList && t.classList.contains('expire-today')) {
      const id = t.getAttribute('data-id');
      const expEl = document.querySelector('input[data-id="' + id + '"][data-field="expires_at"]');
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth()+1).padStart(2,'0');
      const dd = String(today.getDate()).padStart(2,'0');
      if (expEl) expEl.value = yyyy + '-' + mm + '-' + dd;
      // call saveRow to persist
      saveRow(id);
    }
  });

  initTheme();
  load();
})();
`;


