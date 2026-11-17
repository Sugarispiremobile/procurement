import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authenticate } from './auth.js';
import { errorHandler, HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import { dictionaryRouter, usersRouter, statsRouter } from './routes/misc.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // только если реально есть прокси (TRUST_PROXY)
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/requests', authenticate, requestRoutes);
  app.use('/api/categories', dictionaryRouter('categories'));
  app.use('/api/departments', dictionaryRouter('departments', { publicRead: true }));
  app.use('/api/users', usersRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api', () => {
    throw new HttpError(404, 'Маршрут не найден');
  });

  // В production Express раздаёт собранный клиент (client/dist)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
