import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { stream } from 'hono/streaming';
import type { Bindings, ApiResponse, JWTPayload, TtsRequest } from '../types';
import { jsonError } from '../types';
import { z } from 'zod';
import { verifyJWT } from '../auth/jwt';
import { checkQuotaLimit, incrementUsage, logEvent } from '../db/queries';
import { PLAN_LIMITS } from '../types';

const tts = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JWTPayload } }>();

const TtsBodySchema = z.object({
  ssml: z.string().min(1),
  outputFormat: z.string().min(1),
  language: z.string().min(1),
});

function getLimit(c: any): number {
  const envVal = c.env.MAX_TTS_BODY_BYTES;
  const parsed = envVal ? parseInt(envVal, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_048_576; // 1 MiB default
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
      if (received > limit) {
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const part of chunks) { joined.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(joined);
}

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
    const limit = getLimit(c);
    let parsed: unknown;
    try {
      const raw = await readBodyWithLimit(c.req.raw, limit);
      parsed = JSON.parse(raw);
    } catch (e: any) {
      if (e && e.message === 'BODY_TOO_LARGE') return jsonError(c, 413, 'REQUEST_ENTITY_TOO_LARGE', `Body exceeds ${limit} bytes`);
      return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
    }
    const result = TtsBodySchema.safeParse(parsed);
    if (!result.success) {
      return jsonError(c, 400, 'VALIDATION_FAILED', 'Invalid request body', result.error.flatten());
    }
    const { ssml, outputFormat, language } = result.data;
    if (!/mp3/i.test(outputFormat)) {
      return jsonError(c, 400, 'UNSUPPORTED_FORMAT', 'Only MP3 outputFormat is allowed');
    }

    const charCount = ssml.replace(/<[^>]*>/g, '').trim().length;
    if (charCount <= 0) return jsonError(c, 400, 'EMPTY_TEXT', 'Empty text');

    const quota = await checkQuotaLimit(c.env.DB, payload.license_id, payload.plan as any, charCount, PLAN_LIMITS as any);
    if (!quota.allowed) {
      await logEvent(c.env.DB, payload.license_id, 'tts_quota_exceeded', { requested: charCount, remaining: quota.remaining });
      return jsonError(c, 402, 'QUOTA_EXCEEDED', `Remaining: ${quota.remaining}`);
    }

    const azureUrl = `https://${c.env.AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const timeoutMsRaw = c.env.AZURE_TTS_TIMEOUT_MS ? parseInt(c.env.AZURE_TTS_TIMEOUT_MS, 10) : NaN;
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 15_000;
    const maxAttempts = 3; // initial + 2 retries
    let lastRes: Response | null = null;
    let attempt = 0;
    while (attempt < maxAttempts) {
      const ac = new AbortController();
      const timer = setTimeout(() => { try { ac.abort(); } catch {} }, timeoutMs);
      try {
        const res = await fetch(azureUrl, {
          method: 'POST',
          headers: {
            'Accept': 'audio/*',
            'User-Agent': 'ListenMode-Backend/1.0',
            'Ocp-Apim-Subscription-Key': c.env.AZURE_TTS_API_KEY,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': outputFormat
          },
          body: ssml,
          signal: ac.signal,
        });
        clearTimeout(timer);
        lastRes = res;
        if (res.status >= 500 && res.status <= 599 && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 300));
          attempt++;
          continue;
        }
        break;
      } catch (e) {
        clearTimeout(timer);
        // timeout/abort or network error → retry if attempts left
        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 300));
          attempt++;
          continue;
        }
        await logEvent(c.env.DB, payload.license_id, 'tts_timeout', { timeoutMs });
        return jsonError(c, 504, 'UPSTREAM_TIMEOUT', 'TTS upstream timeout');
      }
    }
    const res = lastRes!;

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      await logEvent(c.env.DB, payload.license_id, 'tts_azure_error', { status: res.status, text });
      const status = res.status >= 500 ? 502 : 400;
      return jsonError(c, status, 'TTS_SERVICE_ERROR', `TTS service error: ${res.status}`);
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
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error');
  }
});

export { tts as ttsRoutes };

