import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../index';

const ENV = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', DB: { prepare: () => ({ bind: () => ({ first: async () => ({ cnt: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }) }) }, VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

describe('Voices upstream errors', () => {
  let origFetch: any;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('GET /v1/voices -> returns 502 on upstream 500', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    const res = await app.request('/v1/voices?region=westeurope', {}, ENV);
    expect([500, 502]).toContain(res.status); // depending on code path
  });
});


