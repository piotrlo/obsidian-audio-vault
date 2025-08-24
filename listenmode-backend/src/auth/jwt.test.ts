import { describe, it, expect } from 'vitest';
import { generateJWT, verifyJWT, hashLicenseKey, generateLicenseKey } from './jwt';

describe('auth/jwt helpers', () => {
  it('generateJWT + verifyJWT roundtrip', async () => {
    const token = await generateJWT({ license_id: 1, plan: 'basic', quota_remaining: 1000 }, 's', 1);
    expect(typeof token).toBe('string');
    const payload = await verifyJWT(token, 's');
    expect(payload?.license_id).toBe(1);
  });

  it('verifyJWT returns null for invalid token', async () => {
    const payload = await verifyJWT('bad.token.here', 's');
    expect(payload).toBeNull();
  });

  it('hashLicenseKey hex length 64', async () => {
    const h = await hashLicenseKey('abc');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generateLicenseKey returns LM- prefix', () => {
    const k = generateLicenseKey();
    expect(k.startsWith('LM-')).toBe(true);
  });
});


