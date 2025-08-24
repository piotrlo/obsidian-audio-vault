import { Hono } from 'hono';
import type { Bindings, ApiResponse, VoiceInfo } from '../types';

const voices = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v1/voices – list Azure voices (cached in KV 24h)
 */
voices.get('/', async (c) => {
  try {
    const region = c.req.query('region') || c.env.AZURE_TTS_REGION;
    const cacheKey = `voices:${region}`;
    const cached = await c.env.VOICES_CACHE.get(cacheKey);
    if (cached) {
      return c.json<ApiResponse<VoiceInfo[]>>({ success: true, data: JSON.parse(cached) });
    }

    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': c.env.AZURE_TTS_API_KEY } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json<ApiResponse>({ success: false, error: `Failed to fetch voices: ${res.status} ${text}` }, 502);
    }

    const raw = await res.json<any[]>();
    const mapped: VoiceInfo[] = (Array.isArray(raw) ? raw : [])
      .filter(v => (v?.VoiceType === 'Neural') && ((v?.Name || '').includes('Neural') || (v?.Name || '').includes('HD')))
      .map(v => ({ name: v.Name || v.DisplayName || '', shortName: v.ShortName || v.Name || '', gender: v.Gender, locale: v.Locale }))
      .filter(v => v.name && v.shortName);

    await c.env.VOICES_CACHE.put(cacheKey, JSON.stringify(mapped), { expirationTtl: 86400 });
    return c.json<ApiResponse<VoiceInfo[]>>({ success: true, data: mapped });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

/**
 * DELETE /v1/voices/cache – clear region cache
 */
voices.delete('/cache', async (c) => {
  try {
    const adminHeader = c.req.header('X-Admin-Token') || '';
    if (!adminHeader || adminHeader !== c.env.ADMIN_API_TOKEN) {
      return c.json<ApiResponse>({ success: false, error: 'Unauthorized' }, 401);
    }
    const region = c.req.query('region') || c.env.AZURE_TTS_REGION;
    await c.env.VOICES_CACHE.delete(`voices:${region}`);
    return c.json<ApiResponse>({ success: true, message: `Cache cleared for region ${region}` });
  } catch (e) {
    return c.json<ApiResponse>({ success: false, error: 'Internal error' }, 500);
  }
});

export { voices as voicesRoutes };
