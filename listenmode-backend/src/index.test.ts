import { describe, it, expect } from 'vitest';
import app from './index';

const MOCK_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  DB: {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) })
  } as any,
  VOICES_CACHE: {
    get: async () => null,
    put: async () => {},
  } as any,
} as any;

describe('Admin SSR + API guards', () => {
  it('GET /admin without cookie renders login', async () => {
    const res = await app.request('/admin', {}, MOCK_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('Admin login');
  });

  it('GET /admin?token=BAD shows error', async () => {
    const res = await app.request('/admin?token=BAD', {}, MOCK_ENV);
    const html = await res.text();
    expect(html).toContain('Invalid admin token');
  });

  it('GET /admin?token=ASDF sets admin_session and redirects', async () => {
    const res = await app.request('/admin?token=ASDF', {}, MOCK_ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/admin_session=/);
  });

  it('GET /admin/api/licenses without cookie -> 401', async () => {
    const res = await app.request('/admin/api/licenses', {}, MOCK_ENV);
    expect(res.status).toBe(401);
  });

  it('GET /admin with valid cookie renders page', async () => {
    const login = await app.request('/admin?token=ASDF', {}, MOCK_ENV);
    const cookie = login.headers.get('set-cookie')!;
    const res = await app.request(new Request('http://x/admin', { headers: new Headers({ Cookie: cookie.split(';')[0] }) }), {}, MOCK_ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ListenMode — Admin');
  });
});


