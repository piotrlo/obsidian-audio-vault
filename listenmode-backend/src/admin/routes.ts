import { Hono } from 'hono';
import type { Bindings, ApiResponse, LicenseRecord } from '../types';
import { jsonError } from '../types';
import { hashLicenseKey } from '../auth/jwt';

const admin = new Hono<{ Bindings: Bindings }>();

const ADMIN_STATUS = new Set(['active', 'suspended', 'expired']);
const ADMIN_PLAN = new Set(['free', 'basic', 'pro']);

// Guard: require X-Admin-Token on all /v1/admin routes
admin.use('*', async (c, next) => {
  const token = c.req.header('X-Admin-Token') || '';
  if (!token || token !== c.env.ADMIN_API_TOKEN) {
    return jsonError(c, 401, 'UNAUTHORIZED', 'Unauthorized');
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
      if (!ADMIN_PLAN.has(plan)) return jsonError(c, 400, 'INVALID_PLAN', 'Invalid plan');
      where.push('plan = ?');
      params.push(plan);
      countParams.push(plan);
    }
    if (status) {
      if (!ADMIN_STATUS.has(status)) return jsonError(c, 400, 'INVALID_STATUS', 'Invalid status');
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
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

// GET /v1/admin/licenses/:id — details
admin.get('/licenses/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return jsonError(c, 400, 'INVALID_ID', 'Invalid id');
    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE id = ?')
      .bind(id)
      .first<LicenseRecord>();
    if (!row) return jsonError(c, 404, 'NOT_FOUND', 'Not found');
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

// PATCH /v1/admin/licenses/:id — update selected fields
admin.patch('/licenses/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return jsonError(c, 400, 'INVALID_ID', 'Invalid id');

    const body = await c.req.json<Partial<Pick<LicenseRecord, 'status' | 'plan' | 'expires_at'>>>();
    const setClauses: string[] = [];
    const values: any[] = [];

    if (typeof body.plan !== 'undefined') {
      if (!ADMIN_PLAN.has(body.plan as string)) return jsonError(c, 400, 'INVALID_PLAN', 'Invalid plan');
      setClauses.push('plan = ?');
      values.push(body.plan);
    }
    if (typeof body.status !== 'undefined') {
      if (!ADMIN_STATUS.has(body.status as string)) return jsonError(c, 400, 'INVALID_STATUS', 'Invalid status');
      setClauses.push('status = ?');
      values.push(body.status);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
      let expires: string | null = null;
      if (body.expires_at === null) {
        expires = null;
      } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
        const d = new Date(body.expires_at);
        if (isNaN(d.getTime())) return jsonError(c, 400, 'INVALID_EXPIRES_AT', 'Invalid expires_at');
        expires = d.toISOString();
      } else {
        return jsonError(c, 400, 'INVALID_EXPIRES_AT', 'Invalid expires_at');
      }
      setClauses.push('expires_at = ?');
      values.push(expires);
    }

    if (setClauses.length === 0) {
      return jsonError(c, 400, 'NO_FIELDS', 'No fields to update');
    }

    const sql = `UPDATE licenses SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    await c.env.DB.prepare(sql).bind(...values, id).run();

    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE id = ?')
      .bind(id)
      .first<LicenseRecord>();
    if (!row) return jsonError(c, 404, 'NOT_FOUND', 'Not found');
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row });
  } catch (e: any) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

// POST /v1/admin/licenses — create license (optional)
admin.post('/licenses', async (c) => {
  try {
    const body = await c.req.json<{ license_key?: string; plan?: string; status?: string; expires_at?: string | null }>();
    const licenseKey = (body.license_key || '').toString();
    if (!licenseKey) return jsonError(c, 400, 'LICENSE_KEY_REQUIRED', 'license_key required');
    const plan = (body.plan || 'free').toString();
    const status = (body.status || 'active').toString();
    if (!ADMIN_PLAN.has(plan)) return jsonError(c, 400, 'INVALID_PLAN', 'Invalid plan');
    if (!ADMIN_STATUS.has(status)) return jsonError(c, 400, 'INVALID_STATUS', 'Invalid status');

    let expires: string | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
      if (body.expires_at === null) {
        expires = null;
      } else if (typeof body.expires_at === 'string' && body.expires_at.trim().length > 0) {
        const d = new Date(body.expires_at);
        if (isNaN(d.getTime())) return jsonError(c, 400, 'INVALID_EXPIRES_AT', 'Invalid expires_at');
        expires = d.toISOString();
      } else {
        return jsonError(c, 400, 'INVALID_EXPIRES_AT', 'Invalid expires_at');
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
      return jsonError(c, 400, 'LICENSE_EXISTS', 'License already exists');
    }

    const row = await c.env.DB
      .prepare('SELECT * FROM licenses WHERE license_key_hash = ?')
      .bind(hash)
      .first<LicenseRecord>();
    return c.json<ApiResponse<LicenseRecord>>({ success: true, data: row! });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

export { admin as adminRoutes };


