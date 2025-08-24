import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { stream } from 'hono/streaming';
import type { Bindings, ApiResponse, JWTPayload, TtsRequest } from '../types';
import { verifyJWT } from '../auth/jwt';
import { checkQuotaLimit, incrementUsage, logEvent } from '../db/queries';
import { PLAN_LIMITS } from '../types';

const tts = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

/**
 * Middleware to validate Authorization: Bearer <token>
 */
const authMiddleware = async (
  c: Context<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>,
  next: Next
) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
  c.set('jwtPayload', payload);
  await next();
};

/**
 * POST /v1/tts – proxy to Azure Speech with quota enforcement and streaming
 */
tts.post('/', authMiddleware, async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const { ssml, outputFormat, language } = await c.req.json<TtsRequest>();
    if (!ssml || !outputFormat || !language) {
      return c.json<ApiResponse>({ success: false, error: 'Missing required fields' }, 400);
    }

    const charCount = ssml.replace(/<[^>]*>/g, '').trim().length;
    if (charCount <= 0) return c.json<ApiResponse>({ success: false, error: 'Empty text' }, 400);

    const quota = await checkQuotaLimit(c.env.DB, payload.license_id, payload.plan as any, charCount, PLAN_LIMITS as any);
    if (!quota.allowed) {
      await logEvent(c.env.DB, payload.license_id, 'tts_quota_exceeded', { requested: charCount, remaining: quota.remaining });
      return c.json<ApiResponse>({ success: false, error: 'Quota exceeded', message: `Remaining: ${quota.remaining}` }, 402);
    }

    const azureUrl = `https://${c.env.AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const res = await fetch(azureUrl, {
      method: 'POST',
      headers: {
        'Accept': 'audio/*',
        'User-Agent': 'ListenMode-Backend/1.0',
        'Ocp-Apim-Subscription-Key': c.env.AZURE_TTS_API_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': outputFormat
      },
      body: ssml
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      await logEvent(c.env.DB, payload.license_id, 'tts_azure_error', { status: res.status, text });
      return c.json<ApiResponse>({ success: false, error: `TTS service error: ${res.status}` }, 502);
    }

    await incrementUsage(c.env.DB, payload.license_id, charCount);

    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'no-cache');

    return stream(c, async (s) => {
      const reader = res.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await s.write(value!);
        }
      } finally {
        reader.releaseLock();
      }
    });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

export { tts as ttsRoutes };

