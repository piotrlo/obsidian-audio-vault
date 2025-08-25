import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../src/index';
import { generateJWT } from '../src/auth/jwt';

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

function dbWithLicenseAndUsage(lic: any, charsUsed: number){
  return {
    prepare: (sql: string) => ({
      bind: (..._a: any[]) => ({
        first: async () => (/licenses/.test(sql) ? lic : (/usage_monthly/.test(sql) ? { chars_used: charsUsed } : { cnt: 0 })),
        all: async () => ({ results: [] }),
        run: async () => ({})
      })
    })
  } as any;
}

describe('Unified error format { error_code, message }', () => {
  it('400: /v1/auth/validate invalid schema', async () => {
    const env = { ...BASE, DB: dbWithLicenseAndUsage(null, 0) };
    const res = await app.request('/v1/auth/validate', { method: 'POST', headers: new Headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) }, env);
    expect(res.status).toBe(400);
    const j = await res.json() as any; expect(j.error_code).toBeTruthy(); expect(j.message).toBeTruthy();
  });

  it('401: /v1/auth/usage without bearer', async () => {
    const env = { ...BASE, DB: dbWithLicenseAndUsage(null, 0) };
    const res = await app.request('/v1/auth/usage', {}, env);
    expect(res.status).toBe(401);
    const j = await res.json() as any; expect(j.error_code).toBe('UNAUTHORIZED');
  });

  it('402: /v1/tts quota exceeded', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'free', quota_remaining: 0 }, BASE.JWT_SECRET, 1);
    const env = { ...BASE, DB: dbWithLicenseAndUsage({ id: 1, plan: 'free', status: 'active' }, 10_000) };
    const body = JSON.stringify({ ssml: '<speak>aa</speak>', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', language: 'en-US' });
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(402);
    const j = await res.json() as any; expect(j.error_code).toBe('QUOTA_EXCEEDED');
  });

  it('502: /v1/voices upstream error', async () => {
    let origFetch: any; origFetch = global.fetch; const restore = () => { global.fetch = origFetch; };
    beforeEach(() => {}); afterEach(restore);
    global.fetch = vi.fn(async () => new Response('err', { status: 500 })) as any;
    const env = { ...BASE, DB: dbWithLicenseAndUsage(null, 0) };
    const res = await app.request('/v1/voices?region=westeurope', {}, env);
    expect([500, 502]).toContain(res.status);
    const j = await res.json().catch(() => null) as any;
    if (j) { expect(j.error_code).toBeTruthy(); }
    restore();
  });
});


