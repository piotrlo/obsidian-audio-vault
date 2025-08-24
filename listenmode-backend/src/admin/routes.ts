import { Hono } from 'hono';
import type { Bindings, ApiResponse, LicenseRecord } from '../types';
import { hashLicenseKey } from '../auth/jwt';

const admin = new Hono<{ Bindings: Bindings }>();

const ADMIN_STATUS = new Set(['active', 'suspended', 'expired']);
const ADMIN_PLAN = new Set(['free', 'basic', 'pro']);

// Guard: require X-Admin-Token on all /v1/admin routes
admin.use('*', async (c, next) => {
  const token = c.req.header('X-Admin-Token') || '';
  if (!token || token !== c.env.ADMIN_API_TOKEN) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  await next();
});

// GET /v1/admin/licenses — list with pagination and filters
admin.get('/licenses', async (c) => {
  try {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const rawPageSize = parseInt(c.req.query('pageSize') || '50', 10);
    const pageSize = Math.max(1, Math.min(200, isNaN(rawPageSize) ? 50 : rawPageSize));
    const offset = (page - 1) * pageSize;

    const plan = c.req.query('plan');
    const status = c.req.query('status');
    const q = c.req.query('q');

    const where: string[] = [];
    const params: any[] = [];
    const countParams: any[] = [];

    if (plan) {
      if (!ADMIN_PLAN.has(plan)) return c.json<ApiResponse>({ success: false, error: 'Invalid plan' }, 400);
      where.push('plan = ?');
      params.push(plan);
      countParams.push(plan);
    }
    if (status) {
      if (!ADMIN_STATUS.has(status)) return c.json<ApiResponse>({ success: false, error: 'Invalid status' }, 400);
      where.push('status = ?');
      params.push(status);
      countParams.push(status);
    }
    if (q) {
      where.push('license_key_hash LIKE ?');
      params.push(`${q}%`);
      countParams.push(`${q}%`);
    }

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

    return c.json<ApiResponse<{ items: LicenseRecord[]; page: number; pageSize: number; total: number }>>({
      success: true,
      data: { items, page, pageSize, total }
    });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

// GET /v1/admin/licenses/:id — details
admin.get('/licenses/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json<ApiResponse>({ success: false, error: 'Invalid id' }, 400);
    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE id = ?')
      .bind(id)
      .first<LicenseRecord>();
    if (!row) return c.json<ApiResponse>({ success: false, error: 'Not found' }, 404);
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

// PATCH /v1/admin/licenses/:id — update selected fields
admin.patch('/licenses/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json<ApiResponse>({ success: false, error: 'Invalid id' }, 400);

    const body = await c.req.json<Partial<Pick<LicenseRecord, 'status' | 'plan' | 'expires_at'>>>();
    const setClauses: string[] = [];
    const values: any[] = [];

    if (typeof body.plan !== 'undefined') {
      if (!ADMIN_PLAN.has(body.plan as string)) return c.json<ApiResponse>({ success: false, error: 'Invalid plan' }, 400);
      setClauses.push('plan = ?');
      values.push(body.plan);
    }
    if (typeof body.status !== 'undefined') {
      if (!ADMIN_STATUS.has(body.status as string)) return c.json<ApiResponse>({ success: false, error: 'Invalid status' }, 400);
      setClauses.push('status = ?');
      values.push(body.status);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
      let expires: string | null = null;
      if (body.expires_at === null) {
        expires = null;
      } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
        const d = new Date(body.expires_at);
        if (isNaN(d.getTime())) return c.json<ApiResponse>({ success: false, error: 'Invalid expires_at' }, 400);
        expires = d.toISOString();
      } else {
        return c.json<ApiResponse>({ success: false, error: 'Invalid expires_at' }, 400);
      }
      setClauses.push('expires_at = ?');
      values.push(expires);
    }

    if (setClauses.length === 0) {
      return c.json<ApiResponse>({ success: false, error: 'No fields to update' }, 400);
    }

    const sql = `UPDATE licenses SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await c.env.DB.prepare(sql).bind(...values, id).run();

    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE id = ?')
      .bind(id)
      .first<LicenseRecord>();
    if (!row) return c.json<ApiResponse>({ success: false, error: 'Not found' }, 404);
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row });
  } catch (e: any) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

// POST /v1/admin/licenses — create license (optional)
admin.post('/licenses', async (c) => {
  try {
    const body = await c.req.json<{ license_key?: string; plan?: string; status?: string; expires_at?: string | null }>();
    const licenseKey = (body.license_key || '').toString();
    if (!licenseKey) return c.json<ApiResponse>({ success: false, error: 'license_key required' }, 400);
    const plan = (body.plan || 'free').toString();
    const status = (body.status || 'active').toString();
    if (!ADMIN_PLAN.has(plan)) return c.json<ApiResponse>({ success: false, error: 'Invalid plan' }, 400);
    if (!ADMIN_STATUS.has(status)) return c.json<ApiResponse>({ success: false, error: 'Invalid status' }, 400);

    let expires: string | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
      if (body.expires_at === null) {
        expires = null;
      } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
        const d = new Date(body.expires_at);
        if (isNaN(d.getTime())) return c.json<ApiResponse>({ success: false, error: 'Invalid expires_at' }, 400);
        expires = d.toISOString();
      } else {
        return c.json<ApiResponse>({ success: false, error: 'Invalid expires_at' }, 400);
      }
    }

    const hash = await hashLicenseKey(licenseKey);
    try {
      await c.env.DB
        .prepare('INSERT INTO licenses (license_key_hash, plan, status, expires_at) VALUES (?, ?, ?, ?)')
        .bind(hash, plan, status, expires)
        .run();
    } catch (e: any) {
      // likely unique constraint
      return c.json<ApiResponse>({ success: false, error: 'License already exists' }, 400);
    }

    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE license_key_hash = ?')
      .bind(hash)
      .first<LicenseRecord>();
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row! });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

export { admin as adminRoutes };


