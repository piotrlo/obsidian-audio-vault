import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../index';
import { generateJWT } from '../auth/jwt';

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

function dbWithUsage(charsUsed: number){
  return {
    prepare: (sql: string) => ({
      bind: (..._args: any[]) => ({
        first: async () => {
          if (/FROM usage_monthly/.test(sql)) return { chars_used: charsUsed };
          return { cnt: 0 } as any;
        },
        run: async () => ({}),
        all: async () => ({ results: [] }),
      })
    })
  } as any;
}

describe('TTS route extended', () => {
  const body = JSON.stringify({ ssml: '<speak>hello</speak>', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', language: 'en-US' });
  let origFetch: any;

  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('returns 402 when quota exceeded', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'free', quota_remaining: 0 }, BASE_ENV.JWT_SECRET, 10/60);
    const env = { ...BASE_ENV, DB: dbWithUsage(10000) };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(402);
  });

  it('streams audio on success (mocked fetch)', async () => {
    const token = await generateJWT({ license_id: 2, plan: 'basic', quota_remaining: 1000 }, BASE_ENV.JWT_SECRET, 10/60);
    global.fetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller){ controller.enqueue(new Uint8Array([1,2,3])); controller.close(); }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }) as any;
    const env = { ...BASE_ENV, DB: dbWithUsage(0) };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio');
  });
});


