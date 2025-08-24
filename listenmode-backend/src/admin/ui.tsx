import { Hono } from 'hono';
import type { Bindings } from '../types';
import type { FC } from 'hono/jsx';

const CLIENT_JS = `
(function(){
  const S = {
    token: document.getElementById('token'),
    saveToken: document.getElementById('saveToken'),
    tokenMsg: document.getElementById('tokenMsg'),
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

  function getToken(){ return localStorage.getItem('LM_ADMIN_TOKEN') || ''; }
  function setToken(v){ localStorage.setItem('LM_ADMIN_TOKEN', v || ''); }

  function headers(){
    const t = getToken();
    const h = { 'Content-Type': 'application/json' };
    if (t) h['X-Admin-Token'] = t;
    return h;
  }

  async function load(){
    try {
      S.msg.textContent = 'Loading...';
      const ps = Number(S.pageSize.value) || 25;
      const params = new URLSearchParams({ page: String(page), pageSize: String(ps) });
      if (S.plan.value) params.set('plan', S.plan.value);
      if (S.status.value) params.set('status', S.status.value);
      if (S.q.value) params.set('q', S.q.value.trim());
      const res = await fetch('/v1/admin/licenses?' + params.toString(), { headers: headers() });
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
      html += '<td class="right">';
      html += '<div class="controls">';
      html += '<button class="button is-small is-link is-light save" data-id="' + lic.id + '">Save</button>';
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
      const res = await fetch('/v1/admin/licenses/'+id, { method: 'PATCH', headers: headers(), body: JSON.stringify({ plan, status, expires_at }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      msg.textContent = 'Saved'; msg.className = 'small success';
      setTimeout(()=>{ msg.textContent=''; msg.className='small muted'; }, 1500);
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
      const res = await fetch('/v1/admin/licenses', { method: 'POST', headers: headers(), body: JSON.stringify({ license_key, plan, status, expires_at }) });
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

  S.saveToken.addEventListener('click', () => { setToken(S.token.value.trim()); S.tokenMsg.textContent = 'Saved'; setTimeout(()=> S.tokenMsg.textContent='', 1200); });
  S.load.addEventListener('click', () => { page = 1; load(); });
  S.prev.addEventListener('click', () => { if (page>1) { page--; load(); } });
  S.next.addEventListener('click', () => { page++; load(); });
  S.create.addEventListener('click', create);
  S.tbody.addEventListener('click', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('save')) { const id = t.getAttribute('data-id'); saveRow(id); } });

  S.token.value = getToken();
  initTheme();
  load();
})();
`;

const Page: FC = () => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>ListenMode Admin</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css" />
      <style>{`
        .muted { color: var(--bulma-text-weak, #666); }
        .controls { display: flex; gap: .5rem; align-items: center; justify-content: flex-end; }
        .small { font-size: .875rem; }
      `}</style>
    </head>
    <body>
      <section class="section">
        <div class="container">
          <div class="level">
            <div class="level-left">
              <h1 class="title is-4">ListenMode — Admin</h1>
            </div>
            <div class="level-right">
              <div class="level-item">
                <button id="themeToggle" class="button is-small">Toggle theme</button>
              </div>
            </div>
          </div>

          <div class="field is-grouped is-grouped-multiline">
            <div class="control">
              <label class="label is-small">Admin Token</label>
              <input id="token" class="input is-small" type="text" placeholder="X-Admin-Token" />
            </div>
            <div class="control">
              <button id="saveToken" class="button is-small is-link">Save</button>
            </div>
            <div class="control">
              <span id="tokenMsg" class="small muted"></span>
            </div>
          </div>

          <div class="field is-grouped is-grouped-multiline">
            <div class="control">
              <label class="label is-small">Plan</label>
              <div class="select is-small">
                <select id="plan">
                  <option value="">any</option>
                  <option value="free">free</option>
                  <option value="basic">basic</option>
                  <option value="pro">pro</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Status</label>
              <div class="select is-small">
                <select id="status">
                  <option value="">any</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                  <option value="expired">expired</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Query (hash prefix)</label>
              <input id="q" class="input is-small" type="search" placeholder="q" />
            </div>
            <div class="control">
              <label class="label is-small">Page size</label>
              <div class="select is-small">
                <select id="pageSize">
                  <option>10</option>
                  <option selected>25</option>
                  <option>50</option>
                  <option>100</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">&nbsp;</label>
              <button id="load" class="button is-small is-primary">Load</button>
            </div>
            <div class="control">
              <span id="msg" class="small muted"></span>
            </div>
          </div>

          <div class="field is-grouped is-grouped-multiline">
            <div class="control">
              <label class="label is-small">License key</label>
              <input id="newKey" class="input is-small" type="text" placeholder="License key (raw)" />
            </div>
            <div class="control">
              <label class="label is-small">Plan</label>
              <div class="select is-small">
                <select id="newPlan">
                  <option value="free">free</option>
                  <option value="basic">basic</option>
                  <option value="pro">pro</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Status</label>
              <div class="select is-small">
                <select id="newStatus">
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                  <option value="expired">expired</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Expires</label>
              <input id="newExpires" class="input is-small" type="date" />
            </div>
            <div class="control">
              <label class="label is-small">&nbsp;</label>
              <button id="create" class="button is-small is-success">Create</button>
            </div>
            <div class="control">
              <span id="createMsg" class="small"></span>
            </div>
          </div>

          <div class="field is-grouped is-grouped-multiline">
            <div class="control">
              <button id="prev" class="button is-small">Prev</button>
            </div>
            <div class="control">
              <span id="pageInfo" class="small"></span>
            </div>
            <div class="control">
              <button id="next" class="button is-small">Next</button>
            </div>
          </div>

          <table id="tbl" class="table is-striped is-hoverable is-fullwidth is-narrow">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hash</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Expires</th>
                <th class="has-text-right">Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
    </body>
  </html>
);

const adminUi = new Hono<{ Bindings: Bindings }>();

adminUi.get('/', (c) => c.html(<Page />));

export { adminUi as adminUiRoutes };


