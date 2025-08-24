import { describe, it, expect } from 'vitest';
import { adminUiRoutes } from './ui';
import { Hono } from 'hono';

function makeApp(){
  const app = new Hono();
  app.route('/admin', adminUiRoutes as any);
  return app;
}

const ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('Admin UI routes', () => {
  it('GET /admin -> login page when no cookie', async () => {
    const app = makeApp();
    const res = await app.request('/admin', {}, ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Admin login');
  });

  it('GET /admin?token=BAD -> login with error', async () => {
    const app = makeApp();
    const res = await app.request('/admin?token=BAD', {}, ENV);
    const html = await res.text();
    expect(html).toContain('Invalid admin token');
  });
});


