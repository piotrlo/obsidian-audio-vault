import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index';
import { generateJWT } from '../../src/auth/jwt';

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

function dbWithUsage(charsUsed: number){
  return { prepare: (sql: string) => ({ bind: (..._a: any[]) => ({ first: async () => (/usage_monthly/.test(sql) ? { chars_used: charsUsed } : { cnt: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }) }) } as any;
}

describe('TTS timeout and retry', () => {
  const body = JSON.stringify({ ssml: '<speak>hello</speak>', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', language: 'en-US' });
  let origFetch: any;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('returns 504 on upstream timeout', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    // fetch that never resolves until aborted
    global.fetch = vi.fn(async (_url: string, init?: any) => new Promise((_res, rej) => {
      const signal: AbortSignal | undefined = init?.signal;
      if (signal) signal.addEventListener('abort', () => rej(new Error('AbortError')));
    })) as any;
    const env = { ...BASE, DB: dbWithUsage(0), AZURE_TTS_TIMEOUT_MS: '10' };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(504);
    const json = await res.json() as any;
    expect(json.error_code).toBe('UPSTREAM_TIMEOUT');
  });

  it('retries on 5xx then succeeds', async () => {
    const token = await generateJWT({ license_id: 2, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('err', { status: 500 });
      const stream = new ReadableStream({ start(c){ c.enqueue(new Uint8Array([1,2,3])); c.close(); } });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }) as any;
    const env = { ...BASE, DB: dbWithUsage(0), AZURE_TTS_TIMEOUT_MS: '1000' };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(200);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('retries on 5xx and fails with 502', async () => {
    const token = await generateJWT({ license_id: 3, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    global.fetch = vi.fn(async () => new Response('err', { status: 503 })) as any;
    const env = { ...BASE, DB: dbWithUsage(0), AZURE_TTS_TIMEOUT_MS: '1000' };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect([502]).toContain(res.status);
    const j = await res.json() as any; expect(j.error_code).toBe('TTS_SERVICE_ERROR');
  });
});


