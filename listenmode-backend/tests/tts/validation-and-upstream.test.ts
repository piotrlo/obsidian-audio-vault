import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../../src/index';
import { generateJWT } from '../../src/auth/jwt';

const BASE = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope', VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } } as any;

function dbWithUsage(charsUsed: number){
  return { prepare: (sql: string) => ({ bind: (..._a: any[]) => ({ first: async () => (/usage_monthly/.test(sql) ? { chars_used: charsUsed } : { cnt: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }) }) } as any;
}

describe('TTS validation and upstream errors', () => {
  const body = JSON.stringify({ ssml: '<speak>hello</speak>', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', language: 'en-US' });
  let origFetch: any;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('returns 400 when fields are missing', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    const env = { ...BASE, DB: dbWithUsage(0) };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body: JSON.stringify({}) }, env);
    expect(res.status).toBe(400);
  });

  it('returns 502 on upstream non-OK', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'basic', quota_remaining: 1000 }, BASE.JWT_SECRET, 1);
    global.fetch = vi.fn(async () => new Response('oops', { status: 500 })) as any;
    const env = { ...BASE, DB: dbWithUsage(0) };
    const res = await app.request('/v1/tts', { method: 'POST', headers: new Headers({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), body }, env);
    expect(res.status).toBe(502);
  });
});


