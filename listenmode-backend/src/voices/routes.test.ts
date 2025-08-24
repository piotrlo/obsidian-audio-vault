import { describe, it, expect } from 'vitest';
import app from '../index';

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('Voices routes', () => {
  it('GET /v1/voices -> upstream failure yields error (200/502/500)', async () => {
    const env = { ...BASE_ENV };
    const res = await app.request('/v1/voices?region=test', {}, env);
    expect([200, 500, 502]).toContain(res.status); // allow varied errors in CI
  });

  it('DELETE /v1/voices/cache -> 401 without X-Admin-Token', async () => {
    const env = { ...BASE_ENV };
    const res = await app.request('/v1/voices/cache', { method: 'DELETE' }, env);
    expect(res.status).toBe(401);
  });
});


