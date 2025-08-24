import { describe, it, expect } from 'vitest';
import app from '../index';
import { generateJWT } from './jwt';

function dbWithLicense(lic: any, usage = 0){
  return {
    prepare: (sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async () => {
          if (/FROM licenses/i.test(sql)) return lic;
          if (/FROM usage_monthly/i.test(sql)) return { chars_used: usage };
          return { cnt: 0 } as any;
        },
        run: async () => ({}),
        all: async () => ({ results: [] }),
      })
    })
  } as any;
}

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

describe('Auth usage success', () => {
  it('GET /v1/auth/usage returns data with valid JWT', async () => {
    const token = await generateJWT({ license_id: 42, plan: 'basic', quota_remaining: 100 }, 's', 1);
    const env = { ...BASE, DB: dbWithLicense({ id: 42, plan: 'basic', status: 'active' }, 50) };
    const res = await app.request('/v1/auth/usage', { headers: new Headers({ 'Authorization': `Bearer ${token}` }) }, env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.plan).toBe('basic');
  });
});


