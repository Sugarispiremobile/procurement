#!/bin/bash
# Проверка восстановления: разворачивает дамп во временную базу, проверяет, что таблицы читаются, и удаляет её.
# Использование: bash verify-restore.sh /backups/db_ГГГГ-ММ-ДД_ЧЧММ.dump   (PGHOST/PGUSER/PGPASSWORD — как у pg_dump)
set -euo pipefail
dump="${1:?укажите файл дампа}"
tmp="restore_check_$(date +%s)"
cleanup() { dropdb --if-exists "$tmp" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$tmp"
pg_restore --no-owner --exit-on-error -d "$tmp" "$dump"
users=$(psql -At -d "$tmp" -c 'SELECT count(*) FROM users')
reqs=$(psql -At -d "$tmp" -c 'SELECT count(*) FROM requests')
echo "[verify] восстановление проверено: пользователей $users, заявок $reqs"
[ "$users" -ge 1 ] || { echo "[verify] ОШИБКА: в копии нет пользователей" >&2; exit 1; }
