import { describe, it, expect } from 'vitest';
import app from '../../src/index';

const ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 's',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { delete: async (_k: string) => { throw new Error('kv-fail'); } } as any,
} as any;

describe('Voices purge cache error', () => {
  it('DELETE /v1/voices/cache -> 500 when KV fails', async () => {
    const res = await app.request('/v1/voices/cache?region=westeurope', { method: 'DELETE', headers: new Headers({ 'X-Admin-Token': 'ASDF' }) }, ENV);
    expect([500]).toContain(res.status);
  });
});


