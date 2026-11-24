#!/bin/bash
# Копия: pg_dump + каталог вложений; локально хранится 14 дней.
# Порядок важен: сначала база, потом вложения — в архиве могут оказаться «лишние» файлы (безвредно),
# но не будет записей в базе без файла.
# Дополнительно (переменные окружения):
#   BACKUP_UPLOAD_CMD  — команда копирования ВОВНЕ; пути файлов в $BACKUP_FILES (rsync, rclone, aws s3 cp …)
#   BACKUP_ALERT_URL   — при ошибке отправляется POST с текстом (Slack/Telegram/Mattermost-вебхук, healthchecks.io /fail)
#   BACKUP_OK_URL      — при успехе отправляется GET (healthchecks.io: сигнал «копия сделана»)
#   BACKUP_VERIFY=1    — проверить восстановление; по умолчанию проверка выполняется 1-го числа месяца
# Запуск вручную: docker compose -f docker-compose.prod.yml exec backup bash /backup.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"

alert() {
  echo "[backup] ОШИБКА: $1" >&2
  if [ -n "${BACKUP_ALERT_URL:-}" ]; then
    curl -fsS -m 20 -X POST --data-urlencode "text=[procurement] резервная копия не выполнена: $1" "$BACKUP_ALERT_URL" >/dev/null \
      || echo "[backup] не удалось отправить оповещение" >&2
  fi
}
trap 'alert "строка $LINENO (код $?)"' ERR

cd "$BACKUP_DIR"
stamp=$(date +%Y-%m-%d_%H%M)
db="db_${stamp}.dump"
up="uploads_${stamp}.tar.gz"

pg_dump --format=custom --file="$db"
tar -czf "$up" -C "$UPLOADS_DIR" .

# Быстрая проверка, что файлы читаются и не пустые
pg_restore --list "$db" >/dev/null
[ -s "$db" ] && tar -tzf "$up" >/dev/null

# Проверка восстановления во временную базу (раз в месяц или по BACKUP_VERIFY=1)
if [ "${BACKUP_VERIFY:-}" = "1" ] || [ "$(date +%d)" = "01" ]; then
  bash "$SCRIPT_DIR/verify-restore.sh" "$BACKUP_DIR/$db"
fi

# Копия вовне
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  BACKUP_FILES="$BACKUP_DIR/$db $BACKUP_DIR/$up" bash -c "$BACKUP_UPLOAD_CMD"
else
  echo "[backup] ВНИМАНИЕ: BACKUP_UPLOAD_CMD не задан — копии лежат только на этом сервере" >&2
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db_*.dump' -o -name 'uploads_*.tar.gz' \) -mtime +14 -delete
echo "[backup] готово: ${stamp}"
[ -z "${BACKUP_OK_URL:-}" ] || curl -fsS -m 20 "$BACKUP_OK_URL" >/dev/null || true
