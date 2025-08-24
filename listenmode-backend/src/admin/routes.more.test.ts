import { describe, it, expect } from 'vitest';
import app from '../index';

function dbStub(opts: { notFound?: boolean; throwOnList?: boolean; throwOnDetails?: boolean; throwOnCreate?: boolean } = {}){
  const licenseRow = { id: 1, license_key_hash: 'h', plan: 'basic', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: null } as any;
  return {
    prepare: (sql: string) => ({
      bind: (..._args: any[]) => ({
        all: async () => { if (opts.throwOnList) throw new Error('x'); return { results: [licenseRow] }; },
        first: async () => {
          if (/SELECT \* FROM licenses WHERE id = \?/i.test(sql)) {
            if (opts.throwOnDetails) throw new Error('x');
            return opts.notFound ? null : licenseRow;
          }
          if (/COUNT\(\*\)/i.test(sql)) return { cnt: 1 } as any;
          return licenseRow;
        },
        run: async () => { if (opts.throwOnCreate) throw new Error('dup'); return {}; },
      })
    })
  } as any;
}

const BASE_ENV = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

describe('Admin routes validations', () => {
  it('GET list invalid plan -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses?plan=invalid', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(400);
  });

  it('GET list invalid status -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses?status=what', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(400);
  });

  it('GET list with q filter -> 200', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses?q=abcd', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(200);
  });

  it('GET list catch error -> 500', async () => {
    const env = { ...BASE_ENV, DB: dbStub({ throwOnList: true }) };
    const res = await app.request('/v1/admin/licenses', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(500);
  });

  it('GET details invalid id -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses/abc', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(400);
  });

  it('GET details not found -> 404', async () => {
    const env = { ...BASE_ENV, DB: dbStub({ notFound: true }) };
    const res = await app.request('/v1/admin/licenses/999', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(404);
  });

  it('GET details catch error -> 500', async () => {
    const env = { ...BASE_ENV, DB: dbStub({ throwOnDetails: true }) };
    const res = await app.request('/v1/admin/licenses/1', { headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, env);
    expect(res.status).toBe(500);
  });

  it('PATCH invalid plan -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses/1', { method: 'PATCH', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ plan: 'weird' }) }, env);
    expect(res.status).toBe(400);
  });

  it('PATCH invalid status -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses/1', { method: 'PATCH', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ status: 'weird' }) }, env);
    expect(res.status).toBe(400);
  });

  it('PATCH invalid expires_at -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses/1', { method: 'PATCH', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ expires_at: 'not-a-date' }) }, env);
    expect(res.status).toBe(400);
  });

  it('PATCH no fields -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses/1', { method: 'PATCH', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({}) }, env);
    expect(res.status).toBe(400);
  });

  it('POST invalid expires_at -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub() };
    const res = await app.request('/v1/admin/licenses', { method: 'POST', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ license_key: 'X', plan: 'basic', status: 'active', expires_at: 123 }) }, env);
    expect(res.status).toBe(400);
  });

  it('POST duplicate -> 400', async () => {
    const env = { ...BASE_ENV, DB: dbStub({ throwOnCreate: true }) };
    const res = await app.request('/v1/admin/licenses', { method: 'POST', headers: new Headers({ 'X-Admin-Token': 'ASDF', 'Content-Type': 'application/json' }), body: JSON.stringify({ license_key: 'X', plan: 'basic', status: 'active' }) }, env);
    expect(res.status).toBe(400);
  });
});


