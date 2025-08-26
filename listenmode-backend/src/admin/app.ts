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
      refreshStats();
      S.msg.textContent = '';
    } catch (e){
      S.msg.textContent = 'Error: ' + (e && e.message ? e.message : e);
    }
  }

  function mountChart(containerId, html){
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  }

  async function refreshStats(){
    try {
      const params = new URLSearchParams();
      if (S.plan && S.plan.value) params.set('plan', S.plan.value);
      if (S.status && S.status.value) params.set('status', S.status.value);
      if (S.q && S.q.value) params.set('q', S.q.value.trim());
      const res = await fetch('/admin/api/stats' + (params.toString() ? ('?' + params.toString()) : ''), { headers: headers() });
      const json = await res.json();
      if (!json.success) return;
      const { plans, usageCurrent } = json.data || {};
      const free = ((plans && plans.free) || 0);
      const basic = ((plans && plans.basic) || 0);
      const pro = ((plans && plans.pro) || 0);
      const maxPlan = Math.max(1, free, basic, pro);
      var plansHtml = ''
        + '<table class="charts-css column show-labels data-spacing-5">'
        + '<caption>Active licenses by plan</caption>'
        + '<tbody>'
        + '<tr><th scope="row">free</th><td style="--size:' + (free/maxPlan) + '" title="free: ' + free + '" aria-label="free: ' + free + '"><span class="data">' + free + '</span></td></tr>'
        + '<tr><th scope="row">basic</th><td style="--size:' + (basic/maxPlan) + '" title="basic: ' + basic + '" aria-label="basic: ' + basic + '"><span class="data">' + basic + '</span></td></tr>'
        + '<tr><th scope="row">pro</th><td style="--size:' + (pro/maxPlan) + '" title="pro: ' + pro + '" aria-label="pro: ' + pro + '"><span class="data">' + pro + '</span></td></tr>'
        + '</tbody>'
        + '</table>';
      mountChart('chartPlans', plansHtml);

      const used = Number((usageCurrent && usageCurrent.used) || 0);
      const limit = Number((usageCurrent && usageCurrent.limit) || 0) || 1;
      const ratio = Math.max(0, Math.min(1, used/limit));
      var usageHtml = ''
        + '<table class="charts-css bar show-primary-axis show-data-axes data-spacing-5">'
        + '<caption>Usage this month</caption>'
        + '<tbody>'
        + '<tr><th scope="row">Ogólne</th><td style="--size:' + ratio + '" title="' + used.toLocaleString() + ' / ' + limit.toLocaleString() + ' (' + Math.round(ratio*100) + '%)" aria-label="' + used.toLocaleString() + ' / ' + limit.toLocaleString() + ' (' + Math.round(ratio*100) + '%)"><span class="data">' + used.toLocaleString() + ' / ' + limit.toLocaleString() + '</span></td></tr>'
        + '</tbody>'
        + '</table>';
      mountChart('chartUsageCurrent', usageHtml);
    } catch {}
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
      const used = Number(lic.chars_used || 0);
      const limit = Number(lic.quota_limit || 0);
      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      const src = lic.limit_override != null ? 'override' : 'plan';
      const period = new Date().toISOString().slice(0,7);
      const title = 'Period: ' + period + ' • Used: ' + used + '/' + limit + ' (' + pct + '%) • Source: ' + src + ' • Plan: ' + lic.plan;
      html += '<div style="min-width:140px;" title="' + title.replace(/"/g, '&quot;') + '">';
      html += '<progress class="progress is-small is-info" value="' + pct + '" max="100">' + pct + '%</progress>';
      html += '<div class="small muted">' + used + ' / ' + limit + ' (' + pct + '%)</div>';
      html += '</div>';
      html += '</td>';
      html += '<td>';
      html += '<input class="input is-small" type="number" min="0" step="1" data-id="' + lic.id + '" data-field="limit_override" value="' + (lic.limit_override ?? '') + '" placeholder="' + (lic.quota_limit ?? '') + '" title="Monthly override. Empty = plan limit." />';
      html += '</td>';
      html += '<td class="right">';
      html += '<div class="controls">';
      html += '<button class="button is-small is-link is-dark save" data-id="' + lic.id + '">Save</button>';
      html += '<button class="button is-small is-danger is-dark lm-delete" data-id="' + lic.id + '">Delete</button>';
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

  async function saveLimit(id){
    const el = (document.querySelector('input[data-id="' + id + '"][data-field="limit_override"]'));
    const valRaw = el ? el.value : '';
    const payload = valRaw === '' ? { chars_limit: null } : { chars_limit: Number(valRaw) };
    const msg = document.getElementById('msg-'+id);
    try {
      msg.textContent = 'Saving limit...';
      const res = await fetch('/admin/api/licenses/'+id+'/limit', { method: 'PATCH', headers: headers(), body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      msg.textContent = 'Limit saved'; msg.className = 'small success';
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
  S.tbody.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains('save')) {
      const id = t.getAttribute('data-id');
      // zapis plan/status/expiry
      await saveRow(id);
      // zapis limitu jeśli pole istnieje
      const limitEl = document.querySelector('input[data-id="' + id + '"][data-field="limit_override"]');
      if (limitEl) { await saveLimit(id); }
      return;
    }
    if (t.classList && t.classList.contains('lm-delete')) {
      const id = t.getAttribute('data-id');
      if (confirm('Delete license #' + id + '? This cannot be undone.')) {
        deleteRow(id);
      }
      return;
    }
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
  async function deleteRow(id){
    const msg = document.getElementById('msg-'+id);
    try {
      msg.textContent = 'Deleting...';
      const res = await fetch('/admin/api/licenses/'+id, { method: 'DELETE', headers: headers() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      msg.textContent = 'Deleted'; msg.className = 'small success';
      setTimeout(()=>{ msg.textContent=''; msg.className='small muted'; }, 1000);
      load();
    } catch (e){
      msg.textContent = 'Error'; msg.className = 'small error';
    }
  }

  initTheme();
  load();
})();
`;


