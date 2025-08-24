import { Hono } from 'hono';
import type { Bindings, ApiResponse, JWTPayload } from '../types';
import { hashLicenseKey, generateJWT, verifyJWT } from './jwt';
import { findLicenseByHash, checkQuotaLimit, logEvent } from '../db/queries';
import { PLAN_LIMITS } from '../types';

const auth = new Hono<{ Bindings: Bindings }>();

/**
 * POST /v1/auth/validate – validate license key, return short-lived JWT
 */
auth.post('/validate', async (c) => {
  try {
    const body = await c.req.json<{ license_key?: string }>();
    const licenseKey = (body.license_key || '').toString();
    if (!licenseKey) return c.json<ApiResponse>({ success: false, error: 'Invalid license_key' }, 400);

    const hash = await hashLicenseKey(licenseKey);
    const lic = await findLicenseByHash(c.env.DB, hash);
    if (!lic) {
      await logEvent(c.env.DB, null, 'license_validation_failed', { reason: 'not_found', hash: hash.slice(0, 8) });
      return c.json<ApiResponse>({ success: false, error: 'Invalid license key' }, 401);
    }
    if (lic.status !== 'active') {
      await logEvent(c.env.DB, lic.id, 'license_validation_failed', { reason: 'inactive', status: lic.status });
      return c.json<ApiResponse>({ success: false, error: 'License inactive' }, 401);
    }
    if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
      await logEvent(c.env.DB, lic.id, 'license_validation_failed', { reason: 'expired', expires_at: lic.expires_at });
      return c.json<ApiResponse>({ success: false, error: 'License expired' }, 401);
    }

    const quota = await checkQuotaLimit(c.env.DB, lic.id, lic.plan as any, 0, PLAN_LIMITS as any);
    const jwt = await generateJWT({ license_id: lic.id, plan: lic.plan, quota_remaining: quota.remaining }, c.env.JWT_SECRET, 15);
    await logEvent(c.env.DB, lic.id, 'license_validated', { plan: lic.plan, remaining: quota.remaining });

    return c.json<ApiResponse<{ token: string; expires_in: number; plan: string; quota_remaining: number; quota_limit: number }>>({
      success: true,
      data: { token: jwt, expires_in: 15 * 60, plan: lic.plan, quota_remaining: quota.remaining, quota_limit: quota.limit }
    });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

/**
 * GET /v1/auth/usage – requires Authorization: Bearer <token>
 */
auth.get('/usage', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);

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
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

export { auth as authRoutes };

