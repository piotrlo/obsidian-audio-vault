import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../index';

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { _store: new Map<string,string>(), get: async function(k: string){ return this._store.get(k) || null; }, put: async function(k: string, v: string){ this._store.set(k, v); }, delete: async function(k: string){ this._store.delete(k); } } as any,
} as any;

describe('Voices cache flow', () => {
  let origFetch: any;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('returns cached voices on subsequent call', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify([{ Name: 'en-US-AvaNeural', ShortName: 'en-US-AvaNeural', VoiceType: 'Neural' }]), { status: 200 })) as any;
    const env = { ...BASE_ENV };
    const first = await app.request('/v1/voices?region=westeurope', {}, env);
    expect(first.status).toBe(200);
    // second call should hit KV and still be 200
    const second = await app.request('/v1/voices?region=westeurope', {}, env);
    expect(second.status).toBe(200);
  });
});


