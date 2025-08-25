/* istanbul ignore file */
import { Hono } from 'hono';
import type { Bindings, LicenseRecord } from '../types';
import { PLAN_LIMITS } from '../types';
import type { FC } from 'hono/jsx';
import { ADMIN_CLIENT_JS } from './app';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { getCookie, setCookie } from 'hono/cookie';


type LicenseWithUsage = LicenseRecord & { chars_used?: number; quota_remaining?: number; quota_limit?: number };

const Page: FC<{ items?: LicenseWithUsage[]; page?: number; pageSize?: number; total?: number; plan?: string; status?: string; q?: string }> = (props) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>ListenMode Admin</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css" />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/charts.css/dist/charts.min.css" />
      <style>{`
        :root {
          --accent-start: #10b981; /* emerald */
          --accent-end: #8b5cf6;   /* violet */
          --card-bg: color-mix(in oklab, var(--accent-start) 6%, transparent);
        }
        body { background:
          radial-gradient(1200px 600px at 10% -10%, color-mix(in oklab, var(--accent-start) 18%, transparent), transparent),
          radial-gradient(1000px 500px at 110% 10%, color-mix(in oklab, var(--accent-end) 16%, transparent), transparent);
        }
        .muted { color: var(--bulma-text-weak, #666); }
        .controls { display: flex; gap: .5rem; align-items: center; justify-content: flex-end; }
        .small { font-size: .875rem; }
        .progress { margin-bottom: 3px; }
        .panel-card { background: var(--card-bg); border-radius: 12px; padding: 1rem; backdrop-filter: saturate(120%) blur(4px); }
        .gradient-text { background: linear-gradient(90deg, var(--accent-start), var(--accent-end)); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .table-container { overflow-x: auto; overscroll-behavior-x: contain; }
        td.small { word-break: break-all; max-width: 320px; }
        tbody tr { transition: background-color .2s ease; }
        tbody tr:hover { background-color: color-mix(in oklab, var(--accent-end) 8%, transparent); }
        /* Charts animations */
        .chart-animate { animation: chart-pop 600ms ease-out both; }
        @keyframes chart-pop { 0% { transform: scale(.98); opacity: 0; } 60% { transform: scale(1.02); opacity: .85; } 100% { transform: scale(1); opacity: 1; } }
        .bar td, .column td { background-image: linear-gradient(90deg, var(--accent-start), var(--accent-end)); background-size: 200% 100%; animation: gradient-move 3s ease-in-out infinite; }
        @keyframes gradient-move { 0%{background-position:0%} 50%{background-position:100%} 100%{background-position:0%} }
      `}</style>
    </head>
    <body>
      <section class="section">
        <div class="container">
          <div class="level">
            <div class="level-left">
              <h1 class="title is-4 gradient-text">ListenMode — Admin</h1>
            </div>
            <div class="level-right">
              <div class="level-item">
                <button id="themeToggle" class="button is-small">Toggle theme</button>
              </div>
              <div class="level-item">
                <form method="post" action="/admin/logout">
                  <button class="button is-small is-light" type="submit">Wyloguj</button>
                </form>
              </div>
            </div>
          </div>

          

          <div class="panel-card field is-grouped is-grouped-multiline">
            <div class="control">
              <label class="label is-small">Plan</label>
              <div class="select is-small">
                <select id="plan">
                  <option value="" selected={!props.plan}>any</option>
                  <option value="free" selected={props.plan==='free'}>free</option>
                  <option value="basic" selected={props.plan==='basic'}>basic</option>
                  <option value="pro" selected={props.plan==='pro'}>pro</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Status</label>
              <div class="select is-small">
                <select id="status">
                  <option value="" selected={!props.status}>any</option>
                  <option value="active" selected={props.status==='active'}>active</option>
                  <option value="suspended" selected={props.status==='suspended'}>suspended</option>
                  <option value="expired" selected={props.status==='expired'}>expired</option>
                </select>
              </div>
            </div>
            <div class="control">
              <label class="label is-small">Query (hash prefix)</label>
              <input id="q" class="input is-small" type="search" placeholder="q" value={props.q || ''} />
            </div>
            <div class="control">
              <label class="label is-small">Page size</label>
              <div class="select is-small">
                <select id="pageSize">
                  <option selected={String(props.pageSize||25)==='10'}>10</option>
                  <option selected={String(props.pageSize||25)==='25'}>25</option>
                  <option selected={String(props.pageSize||25)==='50'}>50</option>
                  <option selected={String(props.pageSize||25)==='100'}>100</option>
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

          <div class="panel-card field is-grouped is-grouped-multiline">
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

          <div class="panel-card" style="margin-bottom:1rem;">
            <h2 class="title is-6 gradient-text" style="margin-bottom:.75rem;">Statystyki</h2>
            <div class="columns is-multiline">
              <div class="column is-full-touch is-half-desktop">
                <div class="panel-card">
                  <h3 class="subtitle is-6">Liczba licencji wg planów</h3>
                  <div id="chartPlans" class="chart-animate"></div>
                </div>
              </div>
              <div class="column is-full-touch is-half-desktop">
                <div class="panel-card">
                  <h3 class="subtitle is-6">Zużycie znaków — ten miesiąc</h3>
                  <div id="chartUsageCurrent" class="chart-animate"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="table-container">
          <table id="tbl" class="table is-striped is-hoverable is-fullwidth is-narrow">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hash</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Usage</th>
                <th>Override limit</th>
                <th class="has-text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(props.items || []).map((lic) => (
                <tr>
                  <td>{lic.id}</td>
                  <td class="small">{lic.license_key_hash}</td>
                  <td>
                    <div class="select is-small">
                      <select data-id={String(lic.id)} data-field="plan">
                        <option selected={lic.plan==='free'}>free</option>
                        <option selected={lic.plan==='basic'}>basic</option>
                        <option selected={lic.plan==='pro'}>pro</option>
                      </select>
                    </div>
                  </td>
                  <td>
                    <div class="select is-small">
                      <select data-id={String(lic.id)} data-field="status">
                        <option selected={lic.status==='active'}>active</option>
                        <option selected={lic.status==='suspended'}>suspended</option>
                        <option selected={lic.status==='expired'}>expired</option>
                      </select>
                    </div>
                  </td>
                  <td>
                    <input class="input is-small" type="date" data-id={String(lic.id)} data-field="expires_at" value={lic.expires_at ? lic.expires_at.slice(0,10) : ''} />
                  </td>
                  <td>
                    {(() => {
                      const used = (lic as any).chars_used ?? 0;
                      const limit = (lic as any).quota_limit ?? 0;
                      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                      const src = (lic as any).limit_override != null ? 'override' : 'plan';
                      const period = new Date().toISOString().slice(0,7);
                      const title = `Period: ${period} • Used: ${used}/${limit} (${pct}%) • Source: ${src} • Plan: ${lic.plan}`;
                      return (
                        <div style="min-width:140px;" title={title}>
                          <progress class="progress is-small is-info" value={pct} max="100">{pct}%</progress>
                          <div class="small muted">{used} / {limit} ({pct}%)</div>
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    <input class="input is-small" type="number" min="0" step="1" data-id={String(lic.id)} data-field="limit_override" value={String((lic as any).limit_override ?? '')} placeholder={String((lic as any).quota_limit ?? '')} title="Override miesi9czny. Puste = limit planu." />
                  </td>
                  <td class="right">
                    <div class="controls">
                      <button class="button is-small is-link is-dark save" data-id={String(lic.id)}>Save</button>
                      <button class="button is-small is-danger is-dark lm-delete" data-id={String(lic.id)}>Delete</button>
                      <button class="button is-small is-light expire-today" data-id={String(lic.id)}>Expire today</button>
                      <span class="small muted" id={`msg-${lic.id}`}></span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div class="panel-card field is-grouped is-grouped-multiline" style="margin-top:.75rem;">
            <div class="control">
              <button id="prev" class="button is-small">Prev</button>
            </div>
            <div class="control">
              <span id="pageInfo" class="small">Page {props.page || 1} • Total {props.total || 0}</span>
            </div>
            <div class="control">
              <button id="next" class="button is-small">Next</button>
            </div>
          </div>
        </div>
      </section>

      <script src="/admin/app.js"></script>
    </body>
  </html>
);

const adminUi = new Hono<{ Bindings: Bindings }>();

function parseCookie(_cookieHeader: string | null | undefined): Record<string, string> { return {}; }

function renderLogin(message?: string) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ListenMode Admin — Login</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css" />
      </head>
      <body>
        <section class="section">
          <div class="container" style="max-width:520px;">
            <h1 class="title is-4">Admin login</h1>
            {message ? <p class="notification is-danger is-light">{message}</p> : null}
            <form method="get" action="/admin">
              <div class="field">
                <label class="label is-small">X-Admin-Token</label>
                <div class="control">
                  <input name="token" class="input" type="password" placeholder="Paste admin token" />
                </div>
              </div>
              <div class="field is-grouped">
                <div class="control"><button class="button is-primary" type="submit">Continue</button></div>
              </div>
            </form>
          </div>
        </section>
      </body>
    </html>
  );
}

adminUi.get('/', async (c) => {
  // Admin login via query token -> issue short-lived JWT in HttpOnly cookie
  const queryToken = c.req.query('token');
  if (queryToken) {
    if (queryToken !== c.env.ADMIN_API_TOKEN) {
      return c.html(renderLogin('Invalid admin token.'));
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await jwt.sign({ admin: true, iat: now, exp: now + 1800 }, c.env.JWT_SECRET);
    setCookie(c, 'admin_session', token, { path: '/', maxAge: 1800, sameSite: 'Strict', secure: true, httpOnly: true });
    return c.redirect('/admin');
  }

  // Verify admin_session JWT
  const sessionJwt = getCookie(c, 'admin_session');
  if (!sessionJwt) {
    return c.html(renderLogin());
  }
  const ok = await jwt.verify(sessionJwt, c.env.JWT_SECRET).catch(() => false);
  if (!ok) {
    return c.html(renderLogin());
  }
  const { payload } = jwt.decode(sessionJwt);
  const p: any = payload || {};
  if (!p.admin || !p.exp || typeof p.exp !== 'number') {
    return c.html(renderLogin());
  }
  // Sliding renewal: refresh if < 15 min left
  const now = Math.floor(Date.now() / 1000);
  if (p.exp - now < 900) {
    const refreshed = await jwt.sign({ admin: true, iat: now, exp: now + 1800 }, c.env.JWT_SECRET);
    setCookie(c, 'admin_session', refreshed, { path: '/', maxAge: 1800, sameSite: 'Strict', secure: true, httpOnly: true });
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const rawPageSize = parseInt(c.req.query('pageSize') || '25', 10);
  const pageSize = Math.max(1, Math.min(200, isNaN(rawPageSize) ? 25 : rawPageSize));
  const offset = (page - 1) * pageSize;
  const plan = c.req.query('plan') || undefined;
  const status = c.req.query('status') || undefined;
  const q = c.req.query('q') || undefined;

  const where: string[] = [];
  const params: any[] = [];
  const countParams: any[] = [];
  if (plan) { where.push('plan = ?'); params.push(plan); countParams.push(plan); }
  if (status) { where.push('status = ?'); params.push(status); countParams.push(status); }
  if (q) { where.push('license_key_hash LIKE ?'); params.push(`${q}%`); countParams.push(`${q}%`); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const listStmt = c.env.DB
    .prepare(
      `SELECT id, license_key_hash, stripe_customer_id, plan, status, created_at, expires_at, updated_at
       FROM licenses${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, pageSize, offset);
  const listRes = await listStmt.all<LicenseRecord>();
  const items = listRes.results || [];

  const countStmt = c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM licenses${whereSql}`)
    .bind(...countParams);
  const countRow = await countStmt.first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  return c.html(<Page items={items} page={page} pageSize={pageSize} total={total} plan={plan} status={status} q={q} />);
});
// logout: clear cookie and redirect to login
adminUi.post('/logout', (c) => {
  setCookie(c, 'admin_session', '', { path: '/', maxAge: 0, sameSite: 'Strict', secure: true, httpOnly: true });
  return c.redirect('/admin');
});
adminUi.get('/app.js', (c) => c.body(ADMIN_CLIENT_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }));

// Helper: verify admin session JWT, optionally refresh cookie (sliding renewal)
async function verifyAdminSession(c: any): Promise<boolean> {
  const sessionJwt = getCookie(c, 'admin_session');
  if (!sessionJwt) return false;
  try {
    const ok = await jwt.verify(sessionJwt, c.env.JWT_SECRET);
    if (!ok) return false;
    const { payload } = jwt.decode(sessionJwt);
    const p: any = payload || {};
    if (!p.admin || !p.exp || typeof p.exp !== 'number') return false;
    const now = Math.floor(Date.now() / 1000);
    if (p.exp - now < 900) {
      const refreshed = await jwt.sign({ admin: true, iat: now, exp: now + 1800 }, c.env.JWT_SECRET);
      setCookie(c, 'admin_session', refreshed, { path: '/', maxAge: 1800, sameSite: 'Strict', secure: true, httpOnly: true });
    }
    return true;
  } catch {
    return false;
  }
}

// Simple rate limiter for /admin/api/* (per IP, 60 req/min)
adminUi.use('/api/*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const bucket = Math.floor(Date.now() / 60000);
  const key = `adminrl:${ip}:${bucket}`;
  try {
    const current = await c.env.VOICES_CACHE.get(key);
    const count = current ? parseInt(current, 10) || 0 : 0;
    if (count >= 60) {
      return c.json({ success: false, error: 'Too Many Requests' }, 429);
    }
    await c.env.VOICES_CACHE.put(key, String(count + 1), { expirationTtl: 70 });
  } catch {}
  await next();
});

// Admin API under /admin/api/* guarded by cookie; used by client JS
adminUi.get('/api/licenses', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const rawPageSize = parseInt(c.req.query('pageSize') || '25', 10);
  const pageSize = Math.max(1, Math.min(200, isNaN(rawPageSize) ? 25 : rawPageSize));
  const offset = (page - 1) * pageSize;
  const plan = c.req.query('plan') || undefined;
  const status = c.req.query('status') || undefined;
  const q = c.req.query('q') || undefined;

  const where: string[] = [];
  const params: any[] = [];
  const countParams: any[] = [];
  if (plan) { where.push('plan = ?'); params.push(plan); countParams.push(plan); }
  if (status) { where.push('status = ?'); params.push(status); countParams.push(status); }
  if (q) { where.push('license_key_hash LIKE ?'); params.push(`${q}%`); countParams.push(`${q}%`); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const listStmt = c.env.DB
    .prepare(
      `SELECT id, license_key_hash, stripe_customer_id, plan, status, created_at, expires_at, updated_at
       FROM licenses${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, pageSize, offset);
  const listRes = await listStmt.all<LicenseRecord>();
  const items = (listRes.results || []) as LicenseWithUsage[];

  // enrich with monthly usage and quota
  const period = new Date().toISOString().slice(0, 7);
  for (const it of items) {
    // used
    let used = 0;
    try {
      const row = await c.env.DB
        .prepare('SELECT chars_used FROM usage_monthly WHERE license_id = ? AND period = ?')
        .bind(it.id, period)
        .first<{ chars_used: number }>();
      used = row?.chars_used ?? 0;
    } catch {}
    // base limit from plan
    let limit = (PLAN_LIMITS as any)[it.plan] ?? 0;
    let override: number | null = null;
    // try override; if table missing, keep plan limit
    try {
      const o = await c.env.DB
        .prepare('SELECT chars_limit FROM usage_limit_overrides WHERE license_id = ? AND period = ?')
        .bind(it.id, period)
        .first<{ chars_limit: number }>();
      if (o && Number.isFinite(o.chars_limit as any)) {
        limit = o.chars_limit;
        override = o.chars_limit;
      }
    } catch {}
    const remaining = Math.max(0, limit - used);
    (it as any).chars_used = used;
    (it as any).quota_limit = limit;
    (it as any).quota_remaining = remaining;
    (it as any).limit_override = override;
  }

  const countStmt = c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM licenses${whereSql}`)
    .bind(...countParams);
  const countRow = await countStmt.first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  return c.json({ success: true, data: { items, page, pageSize, total } });
});

// Aggregated stats for charts
adminUi.get('/api/stats', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);
  // Optional filters from query; default status to active
  const planQ = c.req.query('plan') || undefined;
  const statusQ = c.req.query('status') || 'active';
  const q = c.req.query('q') || undefined;

  const where: string[] = [];
  const params: any[] = [];
  if (planQ) { where.push('l.plan = ?'); params.push(planQ); }
  if (statusQ) { where.push('l.status = ?'); params.push(statusQ); }
  if (q) { where.push('l.license_key_hash LIKE ?'); params.push(`${q}%`); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  // counts per plan for filtered licenses
  const planCounts: Record<string, number> = { free: 0, basic: 0, pro: 0 };
  try {
    const rows = await c.env.DB
      .prepare(`SELECT l.plan as plan, COUNT(*) as cnt FROM licenses l${whereSql} GROUP BY l.plan`)
      .bind(...params)
      .all<{ plan: string; cnt: number }>();
    for (const r of rows.results || []) {
      if (r.plan in planCounts) planCounts[r.plan] = (r as any).cnt as number;
    }
  } catch {}

  // usage current month (sum) for filtered licenses
  const period = new Date().toISOString().slice(0, 7);
  let used = 0;
  try {
    const uparams = [period, ...params];
    const row = await c.env.DB
      .prepare(`SELECT SUM(um.chars_used) as used
                FROM usage_monthly um
                JOIN licenses l ON l.id = um.license_id
                ${whereSql ? whereSql.replaceAll('l.', 'l.') + ' AND ' : ' WHERE '} um.period = ?`)
      .bind(...(params.length ? [...params, period] : [period]))
      .first<{ used: number }>();
    used = row?.used ?? 0;
  } catch {}

  // sum of EFFECTIVE limits for filtered licenses (override if exists for period, else plan limit)
  let limitSum = 0;
  try {
    const row = await c.env.DB
      .prepare(`
        SELECT SUM(
          CASE
            WHEN o.chars_limit IS NOT NULL THEN o.chars_limit
            WHEN l.plan = 'free' THEN ?
            WHEN l.plan = 'basic' THEN ?
            WHEN l.plan = 'pro' THEN ?
            ELSE 0
          END
        ) as total_limit
        FROM licenses l
        LEFT JOIN usage_limit_overrides o
          ON o.license_id = l.id AND o.period = ?
        ${whereSql}
      `)
      .bind((PLAN_LIMITS as any).free, (PLAN_LIMITS as any).basic, (PLAN_LIMITS as any).pro, period, ...params)
      .first<{ total_limit: number }>();
    limitSum = row?.total_limit ?? 0;
  } catch {}

  return c.json({ success: true, data: { plans: planCounts, usageCurrent: { used, limit: limitSum } } });
});

adminUi.post('/api/licenses', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ license_key?: string; plan?: string; status?: string; expires_at?: string | null }>();
  const licenseKey = (body.license_key || '').toString();
  if (!licenseKey) return c.json({ success: false, error: 'license_key required' }, 400);
  const plan = (body.plan || 'free').toString();
  const status = (body.status || 'active').toString();
  if (!['free','basic','pro'].includes(plan)) return c.json({ success: false, error: 'Invalid plan' }, 400);
  if (!['active','suspended','expired'].includes(status)) return c.json({ success: false, error: 'Invalid status' }, 400);

  let expires: string | null = null;
  if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
    if (body.expires_at === null) {
      expires = null;
    } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
      const d = new Date(body.expires_at);
      if (isNaN(d.getTime())) return c.json({ success: false, error: 'Invalid expires_at' }, 400);
      expires = d.toISOString();
    } else {
      return c.json({ success: false, error: 'Invalid expires_at' }, 400);
    }
  }

  // Use same hashing as auth/jwt
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(licenseKey));
  const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    await c.env.DB
      .prepare('INSERT INTO licenses (license_key_hash, plan, status, expires_at) VALUES (?, ?, ?, ?)')
      .bind(hash, plan, status, expires)
      .run();
  } catch {
    return c.json({ success: false, error: 'License already exists' }, 400);
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM licenses WHERE license_key_hash = ?')
    .bind(hash)
    .first<LicenseRecord>();
  return c.json({ success: true, data: row });
});

adminUi.patch('/api/licenses/:id', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  const body = await c.req.json<Partial<Pick<LicenseRecord, 'status' | 'plan' | 'expires_at'>>>();
  const setClauses: string[] = [];
  const values: any[] = [];

  if (typeof body.plan !== 'undefined') {
    if (!['free','basic','pro'].includes(body.plan as any)) return c.json({ success: false, error: 'Invalid plan' }, 400);
    setClauses.push('plan = ?'); values.push(body.plan);
  }
  if (typeof body.status !== 'undefined') {
    if (!['active','suspended','expired'].includes(body.status as any)) return c.json({ success: false, error: 'Invalid status' }, 400);
    setClauses.push('status = ?'); values.push(body.status);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
    let expires: string | null = null;
    if (body.expires_at === null) {
      expires = null;
    } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
      const d = new Date(body.expires_at);
      if (isNaN(d.getTime())) return c.json({ success: false, error: 'Invalid expires_at' }, 400);
      expires = d.toISOString();
    } else {
      return c.json({ success: false, error: 'Invalid expires_at' }, 400);
    }
    setClauses.push('expires_at = ?'); values.push(expires);
  }
  if (setClauses.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400);

  const sql = `UPDATE licenses SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  await c.env.DB.prepare(sql).bind(...values, id).run();
  const row = await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first<LicenseRecord>();
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: row });
});

// Delete license
adminUi.delete('/api/licenses/:id', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  try {
    // Best-effort cleanup of related rows
    try { await c.env.DB.prepare('DELETE FROM usage_limit_overrides WHERE license_id = ?').bind(id).run(); } catch {}
    try { await c.env.DB.prepare('DELETE FROM usage_monthly WHERE license_id = ?').bind(id).run(); } catch {}
    try { await c.env.DB.prepare('DELETE FROM events WHERE license_id = ?').bind(id).run(); } catch {}
    const res = await c.env.DB.prepare('DELETE FROM licenses WHERE id = ?').bind(id).run();
    // D1 returns changes via meta if available; we'll assume success if no error thrown
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: 'Delete failed' }, 500);
  }
});

// Upsert per-period limit override for a license
adminUi.patch('/api/licenses/:id/limit', async (c) => {
  if (!(await verifyAdminSession(c))) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const raw = body?.chars_limit;
  if (raw === '' || raw === null || typeof raw === 'undefined') {
    // interpret as remove override
    const period = new Date().toISOString().slice(0, 7);
    try {
      await c.env.DB.prepare('DELETE FROM usage_limit_overrides WHERE license_id = ? AND period = ?').bind(id, period).run();
    } catch (e: any) {
      return c.json({ success: false, error: 'MIGRATION_REQUIRED' }, 400);
    }
  } else {
    const val = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(val) || val < 0) return c.json({ success: false, error: 'Invalid chars_limit' }, 400);
    const period = new Date().toISOString().slice(0, 7);
    try {
      await c.env.DB.prepare(`
      INSERT INTO usage_limit_overrides (license_id, period, chars_limit, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(license_id, period) DO UPDATE SET
        chars_limit = excluded.chars_limit,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id, period, val).run();
    } catch (e: any) {
      return c.json({ success: false, error: 'MIGRATION_REQUIRED' }, 400);
    }
  }
  // respond with recomputed summary
  const period = new Date().toISOString().slice(0, 7);
  const usedRow = await c.env.DB.prepare('SELECT chars_used FROM usage_monthly WHERE license_id = ? AND period = ?').bind(id, period).first<{ chars_used: number }>();
  const lic = await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first<LicenseRecord>();
  const o = await c.env.DB.prepare('SELECT chars_limit FROM usage_limit_overrides WHERE license_id = ? AND period = ?').bind(id, period).first<{ chars_limit: number }>();
  const planLimit = lic ? (PLAN_LIMITS as any)[lic.plan] ?? 0 : 0;
  const limit = o?.chars_limit ?? planLimit;
  const used = usedRow?.chars_used ?? 0;
  const remaining = Math.max(0, limit - used);
  return c.json({ success: true, data: { id, chars_used: used, quota_limit: limit, quota_remaining: remaining, limit_override: o?.chars_limit ?? null } });
});

export { adminUi as adminUiRoutes };


