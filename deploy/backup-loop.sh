#!/bin/bash
# Цикл резервного копирования: первая копия сразу, затем каждый день в BACKUP_HOUR (по умолчанию 03:00 по времени контейнера).
# Ошибка копии не останавливает цикл (о ней сообщает backup.sh).
hour="${BACKUP_HOUR:-03}"
bash /backup.sh || true
while true; do
  now=$(date +%s)
  next=$(date -d "today ${hour}:00" +%s)
  [ "$next" -gt "$now" ] || next=$(date -d "tomorrow ${hour}:00" +%s)
  sleep $((next - now))
  bash /backup.sh || true
done
