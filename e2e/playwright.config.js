// E2E: сервер раздаёт собранный client/dist, поэтому перед запуском: (cd client && npm run build).
// Нужна база с демо-данными: в server выполнить `npm run db:setup` с SEED_DEMO=1.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', locale: 'ru-RU', trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/index.js',
    cwd: '../server',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://procurement:procurement@localhost:5432/procurement_e2e',
      JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
      PORT: '3000', CLIENT_DIST: '../../client/dist', UPLOAD_DIR: '/tmp/procurement-e2e-uploads',
    },
  },
});
