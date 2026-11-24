# Заявки в отдел снабжения — версия 1.1

Внутренний сервис: сотрудники подают заявки на закупку, снабжение ведёт их по статусам (ответственный, переписка, вложения), администратор управляет доступом и справочниками.
Стек: React 19 + Vite · Node.js 22 + Express 5 · PostgreSQL 16 · zod · JWT.

## Быстрый старт (разработка)
```bash
cd server && npm install && npm run setup     # .env, PostgreSQL через Docker, миграции
npm run dev                                   # API: http://localhost:3000
cd ../client && npm install && npm run dev    # UI:  http://localhost:5173
```
Пароль администратора (`admin@example.com`) генерируется случайно и печатается один раз при `setup`. Демо-пользователи по умолчанию **не создаются** (`SEED_DEMO=0` в `.env.example`). Для разработки поставьте в `server/.env` `SEED_DEMO=1` и выполните `npm run db:seed`: появятся `buyer@example.com`, `anna@example.com` (пароль `demo12345`). В `NODE_ENV=production` демо-данные не создаются никогда.

## Тесты и качество
```bash
cd server && TEST_DATABASE_URL=postgres://procurement:procurement@localhost:5432/procurement_test npm test   # база очищается!
cd client && npm test && npm run lint && npm run build
```
CI (GitHub Actions): lint → тесты сервера с PostgreSQL → тесты клиента → сборка → E2E (Playwright) → docker build.

### E2E (Playwright)

Сценарии в `e2e/tests`: «сотрудник подаёт → снабжение берёт → комментарий → файл → выполнено» и «отклонение с причиной».
Запуск: `cd client && npm run build`, затем `cd server && SEED_DEMO=1 npm run db:setup`, затем `cd e2e && npm install && npx playwright install chromium && npm test`
(нужны `DATABASE_URL` и `JWT_SECRET`; по умолчанию база `procurement_e2e`). В CI это отдельное задание `e2e`.

### Отличия от ТЗ 1.1

- Миграции: вместо `node-pg-migrate` используется собственный минимальный раннер `server/scripts/migrate.js`
  (версионные файлы `db/migrations/NNN_*.sql`, журнал `schema_migrations`, транзакция на каждый файл, advisory-lock).
  Поведение то же; зависимость не нужна.

## Продакшн
`cp .env.prod.example .env`, заполнить, затем `docker compose -f docker-compose.prod.yml up -d --build` (Caddy с HTTPS, БД наружу не публикуется, ежедневные бэкапы). Подробно — [docs/admin-guide.md](docs/admin-guide.md), восстановление — [deploy/restore.md](deploy/restore.md).

## Документы
[ТЗ: цели, роли, сценарии](docs/spec.md) · [Архитектура и правила](docs/architecture.md) · [Конкуренты](docs/competitors.md) · [Инструкция администратора](docs/admin-guide.md) · [Инструкция пользователя](docs/user-guide.md) · [CHANGELOG](CHANGELOG.md)

## Настройка
Все переменные описаны в `server/.env.example` (домен регистрации, `TRUST_PROXY`, SMTP, валюта `CURRENCY`, часовой пояс `APP_TZ`, срок приглашений).
