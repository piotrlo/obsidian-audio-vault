import { Hono } from 'hono';
import type { Bindings, ApiResponse, JWTPayload } from '../types';
import { jsonError } from '../types';
import { z } from 'zod';
import { hashLicenseKey, generateJWT, verifyJWT } from './jwt';
import { findLicenseByHash, checkQuotaLimit, logEvent } from '../db/queries';
import { PLAN_LIMITS } from '../types';

const auth = new Hono<{ Bindings: Bindings }>();

const ValidateBodySchema = z.object({ license_key: z.string().min(1) });

function getValidateLimit(c: any): number {
  const envVal = c.env.AUTH_VALIDATE_BODY_LIMIT_BYTES;
  const parsed = envVal ? parseInt(envVal, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 65_536; // 64 KiB default
}

async function readBodyWithLimit(req: Request, limit: number): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > limit) throw new Error('BODY_TOO_LARGE');
      chunks.push(value);
    }
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(joined);
}

/**
 * POST /v1/auth/validate – validate license key, return short-lived JWT
 */
auth.post('/validate', async (c) => {
  try {
    const limit = getValidateLimit(c);
    let parsed: unknown;
    try {
      const raw = await readBodyWithLimit(c.req.raw, limit);
      parsed = JSON.parse(raw);
    } catch (e: any) {
      if (e && e.message === 'BODY_TOO_LARGE') return jsonError(c, 413, 'REQUEST_ENTITY_TOO_LARGE', `Body exceeds ${limit} bytes`);
      return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
    }
    const result = ValidateBodySchema.safeParse(parsed);
    if (!result.success) return jsonError(c, 400, 'VALIDATION_FAILED', 'Invalid request body', result.error.flatten());
    const licenseKey = result.data.license_key;

    const hash = await hashLicenseKey(licenseKey);
    const lic = await findLicenseByHash(c.env.DB, hash);
    if (!lic) {
      await logEvent(c.env.DB, null, 'license_validation_failed', { reason: 'not_found', hash: hash.slice(0, 8) });
      return jsonError(c, 401, 'INVALID_LICENSE', 'Invalid license key');
    }
    if (lic.status !== 'active') {
      await logEvent(c.env.DB, lic.id, 'license_validation_failed', { reason: 'inactive', status: lic.status });
      return jsonError(c, 401, 'LICENSE_INACTIVE', 'License inactive');
    }
    if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
      await logEvent(c.env.DB, lic.id, 'license_validation_failed', { reason: 'expired', expires_at: lic.expires_at });
      return jsonError(c, 401, 'LICENSE_EXPIRED', 'License expired');
    }

    const quota = await checkQuotaLimit(c.env.DB, lic.id, lic.plan as any, 0, PLAN_LIMITS as any);
    const jwt = await generateJWT({ license_id: lic.id, plan: lic.plan, quota_remaining: quota.remaining }, c.env.JWT_SECRET, 15);
    await logEvent(c.env.DB, lic.id, 'license_validated', { plan: lic.plan, remaining: quota.remaining });

    return c.json<ApiResponse<{ token: string; expires_in: number; plan: string; quota_remaining: number; quota_limit: number }>>({
      success: true,
      data: { token: jwt, expires_in: 15 * 60, plan: lic.plan, quota_remaining: quota.remaining, quota_limit: quota.limit }
    });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

/**
 * GET /v1/auth/usage – requires Authorization: Bearer <token>
 */
auth.get('/usage', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonError(c, 401, 'UNAUTHORIZED', 'Unauthorized');
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) return jsonError(c, 401, 'UNAUTHORIZED', 'Unauthorized');

    const quota = await checkQuotaLimit(c.env.DB, payload.license_id, payload.plan as any, 0, PLAN_LIMITS as any);
    return c.json<ApiResponse<{ plan: string; chars_used: number; quota_remaining: number; quota_limit: number; period: string }>>({
      success: true,
      data: {
        plan: payload.plan,
        chars_used: quota.limit - quota.remaining,
        quota_remaining: quota.remaining,
        quota_limit: quota.limit,
        period: new Date().toISOString().slice(0, 7)
      }
    });
  } catch (e) {
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

export { auth as authRoutes };

