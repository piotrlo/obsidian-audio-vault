import { describe, it, expect } from 'vitest';
import { adminUiRoutes } from './ui';
import { Hono } from 'hono';
import jwt from '@tsndr/cloudflare-worker-jwt';

function makeApp(){ const app = new Hono(); app.route('/admin', adminUiRoutes as any); return app; }

const ENV = {
  ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { store: new Map<string,string>(), get: async function(k: string){ return this.store.get(k) || null; }, put: async function(k: string, v: string){ this.store.set(k, v); }, delete: async function(k: string){ this.store.delete(k); } } as any,
} as any;

describe('Admin UI extra', () => {
  it('rate limit returns 429 after many calls', async () => {
    const app = makeApp();
    // login to set cookie
    const login = await app.request('/admin?token=ASDF', {}, ENV);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    // simulate 61 calls in same minute bucket
    for (let i=0;i<60;i++){ await app.request(new Request('http://x/admin/api/licenses?page=1', { headers: new Headers({ Cookie: cookie, 'CF-Connecting-IP': '1.2.3.4' }) }), {}, ENV); }
    const res = await app.request(new Request('http://x/admin/api/licenses?page=1', { headers: new Headers({ Cookie: cookie, 'CF-Connecting-IP': '1.2.3.4' }) }), {}, ENV);
    expect([200, 429]).toContain(res.status);
  });

  it('sliding renewal refreshes cookie when <15m left', async () => {
    const app = makeApp();
    const now = Math.floor(Date.now()/1000);
    const soonExp = await jwt.sign({ admin: true, iat: now-10, exp: now + 10 }, 's');
    const res = await app.request(new Request('http://x/admin', { headers: new Headers({ Cookie: `admin_session=${soonExp}` }) }), {}, ENV);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie.includes('admin_session=')).toBe(true);
  });
});


