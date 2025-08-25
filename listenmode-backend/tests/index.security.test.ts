import { describe, it, expect } from 'vitest';
import app from '../src/index';

const ENV = {
  ENVIRONMENT: 'test', JWT_SECRET: 's', ADMIN_API_TOKEN: 'ASDF',
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ cnt: 0 }), run: async () => ({}) }) }) } as any,
  VOICES_CACHE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
} as any;

describe('Security headers for admin UI', () => {
  it('GET /admin sets strict security headers', async () => {
    const res = await app.request('/admin', {}, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const pp = res.headers.get('permissions-policy') || '';
    expect(pp).toContain('autoplay=()');
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('GET /admin/app.js inherits security headers', async () => {
    const res = await app.request('/admin/app.js', {}, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});


