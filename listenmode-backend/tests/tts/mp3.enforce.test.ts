import { describe, it, expect } from 'vitest';
import app from '../../src/index';
import { generateJWT } from '../../src/auth/jwt';

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

function dbWithUsage(charsUsed: number){
  return { prepare: (sql: string) => ({ bind: (..._a: any[]) => ({ first: async () => (/usage_monthly/.test(sql) ? { chars_used: charsUsed } : { cnt: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }) }) } as any;
}

describe('TTS enforces MP3 outputFormat', () => {
  it('returns 400 when outputFormat is not mp3', async () => {
    const token = await generateJWT({ license_id: 99, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    const env = { ...BASE, DB: dbWithUsage(0) };
    const body = JSON.stringify({ ssml: '<speak>hello</speak>', outputFormat: 'riff-16khz-16bit-mono-pcm', language: 'en-US' });
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(400);
    const j = await res.json() as any;
    expect(j.error_code).toBe('UNSUPPORTED_FORMAT');
  });
});


