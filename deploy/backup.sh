#!/bin/bash
# Ежедневная копия: pg_dump + каталог вложений; хранится 14 дней. Запуск вручную: docker compose -f docker-compose.prod.yml exec backup bash /backup.sh
set -euo pipefail
cd /backups
stamp=$(date +%Y-%m-%d_%H%M)
pg_dump --format=custom --file="db_${stamp}.dump"
tar -czf "uploads_${stamp}.tar.gz" -C /uploads .
find /backups -maxdepth 1 -type f \( -name 'db_*.dump' -o -name 'uploads_*.tar.gz' \) -mtime +14 -delete
echo "[backup] готово: ${stamp}"
