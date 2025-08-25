import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { BackendTtsProvider } from '../../src/tts/backend-provider';

const FIXED_NOW = 1_700_000_000_000; // fixed timestamp for deterministic expiry

describe('BackendTtsProvider', () => {
  const backendUrl = 'https://example.test';
  const licenseKey = 'LM-TEST';
  const region = 'westeurope';
  let fetchSpy: any;
  let origNow: typeof Date.now;

  beforeEach(() => {
    origNow = Date.now;
    (Date as any).now = () => FIXED_NOW;
    fetchSpy = spyOn(globalThis as any, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    (Date as any).now = origNow;
  });

  it('validateLicense returns plan/quota and computes expiry', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: { token: 'jwt', expires_in: 900, plan: 'pro', quota_remaining: 123, quota_limit: 300000 }
    }), { status: 200 }));

    const p = new BackendTtsProvider({ backendUrl, licenseKey, region });
    const v = await p.validateLicense();
    expect(v.token).toBe('jwt');
    expect(v.plan).toBe('pro');
    expect(v.quota_remaining).toBe(123);
    expect(v.quota_limit).toBe(300000);
    expect(v.expiresAtMs).toBe(FIXED_NOW + 900 * 1000);
  });

  it('fetchUsage returns usage payload', async () => {
    // First call in getValidToken for fetchUsage
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { token: 'jwt', expires_in: 900 } }), { status: 200 }));
    // Then usage call
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: { plan: 'basic', chars_used: 1000, quota_remaining: 100, quota_limit: 10000, period: '2025-01' }
    }), { status: 200 }));

    const p = new BackendTtsProvider({ backendUrl, licenseKey, region });
    const u = await p.fetchUsage();
    expect(u.plan).toBe('basic');
    expect(u.quota_remaining).toBe(100);
    expect(u.quota_limit).toBe(10000);
    expect(u.period).toBe('2025-01');
  });
});


