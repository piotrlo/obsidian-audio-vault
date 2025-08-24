import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../index';

type DBStub = {
  prepare: (sql: string) => { bind: (...args: any[]) => { first: <T=any>() => Promise<T|null>; all: <T=any>() => Promise<{ results: T[] }>; run: () => Promise<any> } };
};

function createDBStub(options: { license?: any; usage?: number } = {}): DBStub {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async <T=any>() => {
          if (/FROM licenses/i.test(sql)) {
            return (options.license ?? null) as any as T;
          }
          if (/FROM usage_monthly/i.test(sql)) {
            return ({ chars_used: options.usage ?? 0 } as any) as T;
          }
          if (/COUNT\(\*\)/i.test(sql)) {
            return ({ cnt: 0 } as any) as T;
          }
          return null;
        },
        all: async <T=any>() => ({ results: [] as T[] }),
        run: async () => ({}),
      }),
    }),
  };
}

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
};

describe('Auth routes', () => {
  it('POST /v1/auth/validate -> 400 for missing license_key', async () => {
    const res = await app.request('/v1/auth/validate', { method: 'POST', body: JSON.stringify({}) }, { ...BASE_ENV, DB: createDBStub() } as any);
    expect(res.status).toBe(400);
  });

  it('POST /v1/auth/validate -> 401 for not found', async () => {
    const env = { ...BASE_ENV, DB: createDBStub({ license: null }) } as any;
    const res = await app.request('/v1/auth/validate', { method: 'POST', body: JSON.stringify({ license_key: 'X' }), headers: new Headers({ 'Content-Type': 'application/json' }) }, env);
    expect(res.status).toBe(401);
  });

  it('POST /v1/auth/validate -> 401 for inactive', async () => {
    const env = { ...BASE_ENV, DB: createDBStub({ license: { id: 1, plan: 'basic', status: 'suspended' } }) } as any;
    const res = await app.request('/v1/auth/validate', { method: 'POST', body: JSON.stringify({ license_key: 'X' }), headers: new Headers({ 'Content-Type': 'application/json' }) }, env);
    expect(res.status).toBe(401);
  });

  it('POST /v1/auth/validate -> 200 returns JWT', async () => {
    const env = { ...BASE_ENV, DB: createDBStub({ license: { id: 1, plan: 'basic', status: 'active' }, usage: 0 }) } as any;
    const res = await app.request('/v1/auth/validate', { method: 'POST', body: JSON.stringify({ license_key: 'X' }), headers: new Headers({ 'Content-Type': 'application/json' }) }, env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.token).toBeTypeOf('string');
  });

  it('GET /v1/auth/usage -> 401 without bearer', async () => {
    const env = { ...BASE_ENV, DB: createDBStub({}) } as any;
    const res = await app.request('/v1/auth/usage', {}, env);
    expect(res.status).toBe(401);
  });
});


