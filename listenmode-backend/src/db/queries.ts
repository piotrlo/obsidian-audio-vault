import type { Bindings, LicenseRecord } from '../types';

/**
 * Find an active license by its SHA-256 hash.
 */
export async function findLicenseByHash(db: D1Database, licenseKeyHash: string): Promise<LicenseRecord | null> {
  const row = await db
    .prepare('SELECT * FROM licenses WHERE license_key_hash = ? AND status = ?')
    .bind(licenseKeyHash, 'active')
    .first<LicenseRecord>();
  return row || null;
}

/**
 * Get current month usage in characters for a license.
 */
export async function getCurrentUsage(db: D1Database, licenseId: number): Promise<number> {
  const period = new Date().toISOString().slice(0, 7);
  const row = await db
    .prepare('SELECT chars_used FROM usage_monthly WHERE license_id = ? AND period = ?')
    .bind(licenseId, period)
    .first<{ chars_used: number }>();
  return row?.chars_used ?? 0;
}

/**
 * Increment usage counter for the current month.
 */
export async function incrementUsage(db: D1Database, licenseId: number, chars: number): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  await db.prepare(`
    INSERT INTO usage_monthly (license_id, period, chars_used, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(license_id, period) DO UPDATE SET
      chars_used = chars_used + excluded.chars_used,
      updated_at = CURRENT_TIMESTAMP
  `).bind(licenseId, period, chars).run();
}

/**
 * Check quota limit for a plan, optionally including additionalChars request.
 */
export async function checkQuotaLimit(db: D1Database, licenseId: number, plan: 'free'|'basic'|'pro', additionalChars: number, limits: Record<string, number>): Promise<{ allowed: boolean; remaining: number; limit: number }>{
  const used = await getCurrentUsage(db, licenseId);
  const period = new Date().toISOString().slice(0, 7);
  let limit = limits[plan] ?? 0;
  try {
    const limitRow = await db
      .prepare('SELECT chars_limit FROM usage_limit_overrides WHERE license_id = ? AND period = ?')
      .bind(licenseId, period)
      .first<{ chars_limit: number }>();
    if (limitRow && Number.isFinite((limitRow as any).chars_limit)) {
      limit = (limitRow as any).chars_limit;
    }
  } catch {}
  const remaining = Math.max(0, limit - used);
  const allowed = used + additionalChars <= limit;
  return { allowed, remaining, limit };
}

/**
 * Insert an audit event.
 */
export async function logEvent(db: D1Database, licenseId: number | null, eventType: string, metadata?: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO events (license_id, event_type, metadata) VALUES (?, ?, ?)')
    .bind(licenseId, eventType, metadata ? JSON.stringify(metadata) : null)
    .run();
}

