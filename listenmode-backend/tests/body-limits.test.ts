import { describe, it, expect } from 'vitest';
import app from '../src/index';
import { generateJWT } from '../src/auth/jwt';

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

function dbWithUsage(charsUsed: number){
  return { prepare: (sql: string) => ({ bind: (..._a: any[]) => ({ first: async () => (/usage_monthly/.test(sql) ? { chars_used: charsUsed } : { cnt: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }) }) } as any;
}

describe('Body limits and validation', () => {
  it('returns 413 when /v1/tts body exceeds limit', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    const big = 'x'.repeat(5000);
    const env = { ...BASE, DB: dbWithUsage(0), MAX_TTS_BODY_BYTES: '200' };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body: JSON.stringify({ ssml: big, outputFormat: 'audio-24khz-48kbitrate-mono-mp3', language: 'en-US' }) }, env);
    expect(res.status).toBe(413);
    const json = await res.json() as any;
    expect(json.error_code).toBe('REQUEST_ENTITY_TOO_LARGE');
  });

  it('returns 413 when /v1/auth/validate body exceeds limit', async () => {
    const env = { ...BASE, DB: dbWithUsage(0), AUTH_VALIDATE_BODY_LIMIT_BYTES: '10' };
    const res = await app.request('/v1/auth/validate', { method: 'POST', headers: new Headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ license_key: 'A'.repeat(100) }) }, env);
    expect(res.status).toBe(413);
    const json = await res.json() as any;
    expect(json.error_code).toBe('REQUEST_ENTITY_TOO_LARGE');
  });

  it('returns 400 on invalid JSON schema', async () => {
    const env = { ...BASE, DB: dbWithUsage(0) };
    const res = await app.request('/v1/auth/validate', { method: 'POST', headers: new Headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) }, env);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error_code).toBe('VALIDATION_FAILED');
  });
});


