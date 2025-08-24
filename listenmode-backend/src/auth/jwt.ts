import jwt from '@tsndr/cloudflare-worker-jwt';
import type { JWTPayload } from '../types';

/**
 * Generate a short-lived JWT for a license.
 */
export async function generateJWT(
  payload: Omit<JWTPayload, 'exp' | 'iat'>,
  secret: string,
  expiresInMinutes: number = 15
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = { ...payload, iat: now, exp: now + expiresInMinutes * 60 };
  return jwt.sign(fullPayload, secret);
}

/**
 * Verify and decode a JWT.
 */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const ok = await jwt.verify(token, secret);
    if (!ok) return null;
    const { payload } = jwt.decode(token);
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Hash a license key using SHA-256 (hex).
 */
export async function hashLicenseKey(licenseKey: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(licenseKey));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new license key string.
 */
export function generateLicenseKey(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `LM-${randomPart}-${ts}`.toUpperCase();
}

