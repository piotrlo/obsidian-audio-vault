import { describe, it, expect } from 'vitest';
import app from '../index';

function createDB(){
  // naive stub sufficient for route flows
  const licenseRow = { id: 1, license_key_hash: 'hash1', plan: 'basic', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: null } as any;
  return {
    prepare: (sql: string) => ({
      bind: (..._args: any[]) => ({
        all: async () => ({ results: [licenseRow] }),
        first: async () => {
          if (/WHERE id = \?/.test(sql)) return licenseRow;
          if (/COUNT\(\*\)/i.test(sql)) return { cnt: 1 } as any;
          if (/WHERE license_key_hash = \?/.test(sql)) return licenseRow;
          return licenseRow;
        },
        run: async () => ({})
      })
    })
  } as any;
}

const ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 's',
  ADMIN_API_TOKEN: 'ASDF',
  DB: createDB(),
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('Admin JSON routes (/v1/admin)', () => {
  it('GET list requires X-Admin-Token', async () => {
    const res = await app.request('/v1/admin/licenses', {}, { ...ENV });
    expect(res.status).toBe(401);
  });

  it('GET list with token returns data', async () => {
    const res = await app.request('/v1/admin/licenses?page=1&pageSize=10', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, { ...ENV });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.items)).toBe(true);
  });

  it('GET details with token returns item', async () => {
    const res = await app.request('/v1/admin/licenses/1', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, { ...ENV });
    expect(res.status).toBe(200);
  });

  it('PATCH updates allowed fields', async () => {
    const res = await app.request('/v1/admin/licenses/1', { method: 'PATCH', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ status: 'suspended' }) }, { ...ENV });
    expect(res.status).toBe(200);
  });

  it('POST creates license', async () => {
    const body = { license_key: 'LM-UNIT-1', plan: 'basic', status: 'active' };
    const res = await app.request('/v1/admin/licenses', { method: 'POST', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify(body) }, { ...ENV });
    expect(res.status).toBe(200);
  });
});


