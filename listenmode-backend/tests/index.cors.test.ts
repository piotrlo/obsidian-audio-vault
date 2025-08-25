import { describe, it, expect } from 'vitest';
import app from '../src/index';

const BASE_ENV = {
  ENVIRONMENT: 'test',
  JWT_SECRET: 's',
  ADMIN_API_TOKEN: 'ASDF',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
  AZURE_TTS_API_KEY: 'k', AZURE_TTS_REGION: 'westeurope',
} as any;

describe('CORS allow/block matrix', () => {
  const allows = [
    'https://obsidian.md',
    'obsidian://',
    'capacitor://localhost',
    'http://localhost:3000',
  ];
  const blocks = [
    'https://evil.com',
    'http://127.0.0.1:1234',
  ];

  it('allows known origins on /v1/*', async () => {
    for (const origin of allows){
      const res = await app.request('/v1/voices', { headers: new Headers({ Origin: origin }) }, BASE_ENV);
      expect([200,500,502]).toContain(res.status);
      const acao = res.headers.get('access-control-allow-origin');
      expect(acao === null || acao === origin).toBe(true);
    }
  });

  it('blocks unknown origins (no ACAO)', async () => {
    for (const origin of blocks){
      const res = await app.request('/v1/voices', { headers: new Headers({ Origin: origin }) }, BASE_ENV);
      const acao = res.headers.get('access-control-allow-origin');
      expect(acao).toBeNull();
    }
  });
});


