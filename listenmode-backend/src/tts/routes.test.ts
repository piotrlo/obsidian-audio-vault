import { describe, it, expect } from 'vitest';
import app from '../index';

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 'test-secret',
  ADMIN_API_TOKEN: 'ASDF',
  AZURE_TTS_API_KEY: 'k',
  AZURE_TTS_REGION: 'westeurope',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('TTS routes', () => {
  it('POST /v1/tts -> 401 without bearer', async () => {
    const res = await app.request('/v1/tts', { method: 'POST' }, BASE_ENV);
    expect(res.status).toBe(401);
  });
});


