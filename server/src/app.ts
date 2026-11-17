import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { WEB_DIST } from './config.js';
import { createServices, type Services } from './services.js';
import { registerApiRoutes } from './routes/api.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerRunRoutes } from './routes/run.js';
import { PathError } from './fs/FileSystemService.js';

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export async function buildApp(services: Services = createServices(), { logger = true } = {}) {
  const app = Fastify({ logger: logger ? { level: process.env.LOG_LEVEL ?? 'warn' } : false, bodyLimit: 20 * 1024 * 1024 });

  // This server can run code on the machine: refuse requests that don't come from our own local origin
  // (protects against DNS rebinding and cross-site requests from other web pages).
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    const origin = req.headers.origin;
    if (!LOCAL_HOST.test(host) || (origin && !LOCAL_ORIGIN.test(origin))) {
      return reply.code(403).send({ error: 'Forbidden: LLD Studio only accepts local requests' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err instanceof PathError ? 400 : err.code === 'ENOENT' ? 404 : (err.statusCode ?? 500);
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: err.code === 'ENOENT' ? 'File or folder not found' : err.message });
  });

  await app.register(fastifyWebsocket);
  registerApiRoutes(app, services);
  registerAiRoutes(app, services);
  registerRunRoutes(app, services);

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply.type('text/html').send('<h1>LLD Studio</h1><p>The web UI is not built. Run <code>npm start</code> (or <code>npm run dev</code> and open the Vite URL).</p>'),
    );
  }
  return app;
}
