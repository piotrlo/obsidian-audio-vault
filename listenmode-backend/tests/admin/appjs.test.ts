import { describe, it, expect } from 'vitest';
import { adminUiRoutes } from '../../src/admin/ui';
import { Hono } from 'hono';

function makeApp(){ const app = new Hono(); app.route('/admin', adminUiRoutes as any); return app; }

const ENV = {
  ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('Admin app.js', () => {
  it('GET /admin/app.js has JS content-type', async () => {
    const app = makeApp();
    const res = await app.request('/admin/app.js', {}, ENV);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') || '';
    expect(ct.includes('application/javascript')).toBe(true);
  });
});
