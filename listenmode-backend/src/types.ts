export interface LicenseRecord {
  id: number;
  license_key_hash: string;
  stripe_customer_id?: string | null;
  plan: 'free' | 'basic' | 'pro';
  status: 'active' | 'suspended' | 'expired';
  created_at: string;
  expires_at?: string | null;
  updated_at: string;
}

export interface UsageRecord {
  id: number;
  license_id: number;
  period: string;
  chars_used: number;
  created_at: string;
  updated_at: string;
}

export interface JWTPayload {
  license_id: number;
  plan: string;
  quota_remaining: number;
  exp: number;
  iat: number;
}

export interface TtsRequest {
  ssml: string;
  outputFormat: string;
  language: string;
}

export interface VoiceInfo {
  name: string;
  shortName: string;
  gender?: string;
  locale?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface Bindings {
  DB: D1Database;
  VOICES_CACHE: KVNamespace;
  AZURE_TTS_API_KEY: string;
  AZURE_TTS_REGION: string;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  ADMIN_API_TOKEN: string;
  // optional tuning knobs
  MAX_TTS_BODY_BYTES?: string;
  AUTH_VALIDATE_BODY_LIMIT_BYTES?: string;
  AZURE_TTS_TIMEOUT_MS?: string;
}

export const PLAN_LIMITS = {
  free: 10_000,
  basic: 100_000,
  pro: 300_000,
} as const;

export type ErrorBody = {
  error_code: string;
  message: string;
  details?: unknown;
};

export function jsonError(c: any, status: number, error_code: string, message: string, details?: unknown) {
  c.header('X-Error-Code', error_code);
  return c.json({ error_code, message, details } as ErrorBody, status);
}

export function ok<T>(c: any, data: T) {
  return c.json({ success: true, data } satisfies ApiResponse<T>);
}

