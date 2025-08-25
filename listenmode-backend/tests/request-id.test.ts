import { describe, it, expect } from 'vitest';
import app from '../src/index';

const ENV = { ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF', DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any, VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any } as any;

describe('X-Request-Id middleware', () => {
  it('sets X-Request-Id when not provided', async () => {
    const res = await app.request('/health', {}, ENV);
    expect(res.status).toBe(200);
    const id = res.headers.get('x-request-id');
    expect(typeof id).toBe('string');
    expect((id || '').length).toBeGreaterThan(0);
  });

  it('echoes provided X-Request-Id', async () => {
    const reqId = 'test-id-123';
    const res = await app.request('/health', { headers: new Headers({ 'X-Request-Id': reqId }) }, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe(reqId);
  });
});


