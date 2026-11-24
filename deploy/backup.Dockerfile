# Образ для резервного копирования: postgres-клиент + инструменты для копирования вовне и оповещений
FROM postgres:16
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl rsync openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
