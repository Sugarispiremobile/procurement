# Восстановление из копии

```bash
# остановить приложение, чтобы оно не писало в базу
docker compose -f docker-compose.prod.yml stop app
# база (пересоздаёт объекты)
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U procurement -d procurement --clean --if-exists < backups/db_ГГГГ-ММ-ДД_ЧЧММ.dump
# вложения
docker compose -f docker-compose.prod.yml run --rm -v "$PWD/backups:/b" app sh -c "tar -xzf /b/uploads_ГГГГ-ММ-ДД_ЧЧММ.tar.gz -C /data/uploads"
docker compose -f docker-compose.prod.yml start app
```

Автоматическая проверка восстановления (`deploy/verify-restore.sh`) выполняется 1-го числа каждого месяца и по `BACKUP_VERIFY=1`; раз в квартал всё равно проверяйте полное восстановление на тестовой машине.
