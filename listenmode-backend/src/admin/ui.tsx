/* istanbul ignore file */
import { Hono } from 'hono';
import type { Bindings, LicenseRecord } from '../types';
import type { FC } from 'hono/jsx';
import { ADMIN_CLIENT_JS } from './app';
import jwt from '@tsndr/cloudflare-worker-jwt';


const Page: FC<{ items?: LicenseRecord[]; page?: number; pageSize?: number; total?: number; plan?: string; status?: string; q?: string }> = (props) => (
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
              <span id="pageInfo" class="small">Page {props.page || 1} • Total {props.total || 0}</span>
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
                  <td class="right">
                    <div class="controls">
                      <button class="button is-small is-link is-light save" data-id={String(lic.id)}>Save</button>
                      <button class="button is-small is-light expire-today" data-id={String(lic.id)}>Expire today</button>
                      <span class="small muted" id={`msg-${lic.id}`}></span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <script src="/admin/app.js"></script>
    </body>
  </html>
);

const adminUi = new Hono<{ Bindings: Bindings }>();

function parseCookie(cookieHeader: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(rest.join('='));
  });
  return out;
}

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
    c.header('Set-Cookie', `admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=1800; SameSite=Strict; Secure; HttpOnly`);
    return c.redirect('/admin');
  }

  // Verify admin_session JWT
  const cookies = parseCookie(c.req.header('Cookie'));
  const sessionJwt = cookies['admin_session'];
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
    c.header('Set-Cookie', `admin_session=${encodeURIComponent(refreshed)}; Path=/; Max-Age=1800; SameSite=Strict; Secure; HttpOnly`);
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
adminUi.get('/app.js', (c) => c.body(ADMIN_CLIENT_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }));

// Helper: verify admin session JWT, optionally refresh cookie (sliding renewal)
async function verifyAdminSession(c: any): Promise<boolean> {
  const cookies = parseCookie(c.req.header('Cookie'));
  const sessionJwt = cookies['admin_session'];
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
      c.header('Set-Cookie', `admin_session=${encodeURIComponent(refreshed)}; Path=/; Max-Age=1800; SameSite=Strict; Secure; HttpOnly`);
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
  const items = listRes.results || [];

  const countStmt = c.env.DB
    .prepare(`SELECT COUNT(*) as cnt FROM licenses${whereSql}`)
    .bind(...countParams);
  const countRow = await countStmt.first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  return c.json({ success: true, data: { items, page, pageSize, total } });
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

export { adminUi as adminUiRoutes };


