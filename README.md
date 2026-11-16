# Заявки в отдел снабжения

Веб-сервис по ТЗ (`docs/spec.md`): сотрудники подают заявки на закупку, снабжение меняет статусы и комментирует, администратор управляет ролями и справочниками.

- **Backend:** Node.js 20.6+, Express 5, PostgreSQL, JWT, bcrypt (пакет `bcryptjs`), zod
- **Frontend:** React 19, Vite, React Router
- **Прототип:** `prototype/zayavki.html` (+ `style.css`, `app.js`) — исходный статический вариант

## Запуск для разработки

Нужны Node.js 20.6+ и PostgreSQL 14+ (или Docker — тогда база поднимется сама).

```bash
# 1. Сервер: одна команда настраивает всё, что связано с БД
cd server
npm install
npm run setup     # создаёт .env, запускает PostgreSQL через Docker (если он не запущен),
                  # создаёт базу, применяет схему, загружает данные
npm run dev       # http://localhost:3000

# 2. Клиент (в другом терминале)
cd client
npm install
npm run dev       # http://localhost:5173 (запросы /api проксируются на :3000)
```

По умолчанию администратор: `admin@example.com` / `admin12345` (меняется в `server/.env`). Если PostgreSQL установлен без Docker, создайте пользователя и базу из `DATABASE_URL` (`procurement` / `procurement`) — `npm run setup` сделает остальное. Если сервер не видит базу, он при старте скажет об этом и подскажет команду.

Демо-аккаунты (при `SEED_DEMO=1`, пароль у всех `demo12345`):

| Email | Роль |
| --- | --- |
| `anna@example.com`, `sergey@example.com` | сотрудник |
| `buyer@example.com` | снабжение |
| `ADMIN_EMAIL` из `.env` | администратор |

## Production

```bash
cd client && npm run build      # создаёт client/dist
cd ../server
NODE_ENV=production npm start   # Express раздаёт и API, и собранный клиент
```

В production задайте `JWT_SECRET` не короче 32 символов, `SEED_DEMO=0`, смените пароль администратора и поставьте сервис за HTTPS.

## База данных

Схема: `server/db/schema.sql` (идемпотентная, `npm run db:migrate`). Таблицы: `departments`, `categories`, `users`, `requests` (нумерация с 1001), `request_items`, `status_history`. Ограничения целостности (количество > 0, сумма ≥ 0, допустимые роли и статусы, email в нижнем регистре, каскадное удаление позиций и истории) заданы на уровне БД, а не только в коде.

## Структура

```
procurement/
├─ server/
│  ├─ db/schema.sql          схема PostgreSQL
│  ├─ scripts/               migrate.js, seed.js
│  ├─ src/                   app, config, db, auth, schemas (zod), statuses, errors
│  │  └─ routes/             auth, requests, misc (справочники, пользователи, статистика)
│  └─ test/                  тесты правил статусов и валидации (npm test)
├─ client/src/               App, context, api, pages/*, components/*, docs/* (ТЗ и конкуренты)
├─ docs/                     spec.md, competitors.md
├─ prototype/                исходный HTML-прототип
└─ docker-compose.yml        PostgreSQL для разработки
```

## Что реализовано

Всё из раздела MVP ТЗ, а также из «если останется время»: поиск, история статусов, CSV, статистика, тёмная тема. Не сделаны: email-уведомления, файлы-вложения, пагинация (список ограничен 500 записями).

Правила, которые проверяет сервер: сотрудник видит и меняет только свои заявки (чужая — 404); менять и отменять заявку можно только в статусе «Новая»; статусы меняются только по цепочке `new → review → buying → done` или в `rejected` (нарушение — 409); отклонение требует комментария; регистрация всегда создаёт роль `employee`; администратор не может снять с себя роль; число попыток входа ограничено.

## Отличия от ТЗ

- Вместо `bcrypt` используется `bcryptjs` (тот же алгоритм и формат хеша, но без нативной сборки).
- `GET /api/departments` открыт без входа: список нужен на странице регистрации.
- Подразделение заявки берётся из профиля автора (в ТЗ оно хранится только у пользователя).
