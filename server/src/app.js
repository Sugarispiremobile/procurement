import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authenticate, createLimiters } from './auth.js';
import { query } from './db.js';
import { errorHandler, HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import { dictionaryRouter, usersRouter, statsRouter } from './routes/misc.js';

export const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.token'],
});

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // A8: только через TRUST_PROXY

  // Логи (pino, JSON): id запроса и id пользователя в каждой записи; тела и токены не логируются
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url.split('?')[0].replace(/\/invite\/[^/]+/, '/invite/***') }), res: (r) => ({ statusCode: r.statusCode }) },
    // пользователь становится известен только после authenticate, поэтому добавляем его при завершении запроса
    customSuccessObject: (req, res, val) => ({ ...val, userId: req.user?.id ?? null }),
    customErrorObject: (req, res, err, val) => ({ ...val, userId: req.user?.id ?? null }),
    autoLogging: { ignore: (req) => req.url === '/api/health' },
  }));

  // A9: заголовки безопасности и CSP
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    strictTransportSecurity: config.isProd,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '100kb' }));

  const limiters = createLimiters();
  app.get('/api/health', async (req, res) => {
    try { await query({ text: 'SELECT 1', query_timeout: 2000 }); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.get('/api/config', (req, res) =>
    res.json({ currency: config.currency, timeZone: config.timeZone, registrationOpen: Boolean(config.allowedEmailDomain), domain: config.allowedEmailDomain || null }));
  app.use('/api/auth', authRoutes(limiters));
  app.use('/api/requests', authenticate, requestRoutes);
  app.use('/api/categories', dictionaryRouter('categories'));
  app.use('/api/departments', dictionaryRouter('departments', { publicRead: true }));
  app.use('/api/users', usersRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api', () => { throw new HttpError(404, 'Маршрут не найден'); });

  // В production Express раздаёт собранный клиент (client/dist)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.CLIENT_DIST || '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  app.use(errorHandler);
  return app;
}
