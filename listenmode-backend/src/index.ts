import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { authRoutes } from './auth/routes';
import { ttsRoutes } from './tts/routes';
import { voicesRoutes } from './voices/routes';
import { adminRoutes } from './admin/routes';
import { adminUiRoutes } from './admin/ui';
import { jsonError } from './types';
import { billingRoutes } from './billing/routes';

const app = new Hono<{ Bindings: Bindings }>();

// X-Request-Id middleware: generate/echo, log entry/exit
app.use('*', async (c, next) => {
  const headerId = c.req.header('x-request-id');
  const reqId = headerId && headerId.trim() ? headerId : (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  c.header('X-Request-Id', reqId);
  const start = Date.now();
  try {
    console.log(`[req:${reqId}] → ${c.req.method} ${c.req.path}`);
  } catch {}
  await next();
  try {
    console.log(`[req:${reqId}] ← ${c.req.method} ${c.req.path} ${c.res.status} (${Date.now() - start}ms)`);
  } catch {}
});

app.use('*', logger());
app.use('/v1/*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (origin === 'https://obsidian.md') return origin;
    if (origin === 'app://obsidian.md') return origin;
    if (origin === 'obsidian://') return origin;
    if (origin === 'capacitor://localhost') return origin;
    if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
    return null;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token'],
  allowMethods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString(), env: c.env.ENVIRONMENT || 'unknown' }));

// Security headers + CSP for admin UI only
function applyAdminSecurityHeaders(c: any) {
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), document-domain=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()');
  c.header('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
  ].join('; '));
}

app.use('/admin', async (c, next) => { applyAdminSecurityHeaders(c); await next(); });
app.use('/admin/*', async (c, next) => { applyAdminSecurityHeaders(c); await next(); });

app.route('/v1/auth', authRoutes);
app.route('/v1/tts', ttsRoutes);
app.route('/v1/voices', voicesRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/admin', adminUiRoutes);

app.notFound((c) => jsonError(c, 404, 'NOT_FOUND', 'Not found'));
app.onError((e, c) => jsonError(c, 500, 'INTERNAL_ERROR', 'Internal error'));

export default app;

