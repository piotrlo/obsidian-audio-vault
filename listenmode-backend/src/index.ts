import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { authRoutes } from './auth/routes';
import { ttsRoutes } from './tts/routes';
import { voicesRoutes } from './voices/routes';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());
app.use('/v1/*', cors({
  origin: (origin) => {
    if (!origin) return false;
    if (origin === 'https://obsidian.md') return true;
    if (origin === 'obsidian://') return true;
    if (origin === 'capacitor://localhost') return true;
    if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
    return false;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString(), env: c.env.ENVIRONMENT || 'unknown' }));

app.route('/v1/auth', authRoutes);
app.route('/v1/tts', ttsRoutes);
app.route('/v1/voices', voicesRoutes);

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((e, c) => c.json({ success: false, error: 'Internal error' }, 500));

export default app;

