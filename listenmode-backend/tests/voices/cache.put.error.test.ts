import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../../src/index';

const ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 's',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async (_k: string, _v: string) => { throw new Error('kv-put'); } } as any,
} as any;

describe('Voices KV put error', () => {
  let origFetch: any;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('GET /v1/voices -> 500 when KV.put throws', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify([{ Name: 'en-US-OkayNeural', ShortName: 'en-US-OkayNeural', VoiceType: 'Neural' }]), { status: 200 })) as any;
    const res = await app.request('/v1/voices?region=westeurope', {}, ENV);
    expect([500]).toContain(res.status);
  });
});


