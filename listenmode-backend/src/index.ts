import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { authRoutes } from './auth/routes';
import { ttsRoutes } from './tts/routes';
import { voicesRoutes } from './voices/routes';
import { adminRoutes } from './admin/routes';
import { adminUiRoutes } from './admin/ui';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());
app.use('/v1/*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (origin === 'https://obsidian.md') return origin;
    if (origin === 'obsidian://') return origin;
    if (origin === 'capacitor://localhost') return origin;
    if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
    return null;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token'],
  allowMethods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString(), env: c.env.ENVIRONMENT || 'unknown' }));

app.route('/v1/auth', authRoutes);
app.route('/v1/tts', ttsRoutes);
app.route('/v1/voices', voicesRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/admin', adminUiRoutes);

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((e, c) => c.json({ success: false, error: 'Internal error' }, 500));

export default app;

