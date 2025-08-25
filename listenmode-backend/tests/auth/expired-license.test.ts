import { describe, it, expect } from 'vitest';
import app from '../../src/index';

function dbExpired(){
  const lic = { id: 1, plan: 'basic', status: 'active', expires_at: new Date(Date.now() - 86400000).toISOString() };
  return { prepare: (sql: string) => ({ bind: (..._a: any[]) => ({ first: async () => (/FROM licenses/.test(sql) ? lic : (/COUNT\(\*\)/.test(sql) ? { cnt: 0 } : { chars_used: 0 })), all: async () => ({ results: [] }), run: async () => ({}) }) }) } as any;
}

const ENV = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

describe('Auth validate expired license', () => {
  it('POST /v1/auth/validate -> 401 for expired', async () => {
    const env = { ...ENV, DB: dbExpired() } as any;
    const res = await app.request('/v1/auth/validate', { method: 'POST', body: JSON.stringify({ license_key: 'X' }), headers: new Headers({ 'Content-Type': 'application/json' }) }, env);
    expect(res.status).toBe(401);
  });
});


