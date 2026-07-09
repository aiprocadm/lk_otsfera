#!/usr/bin/env bash
# Логический бэкап PostgreSQL (R0.5, docs/runbook-backups.md §3).
# Belt-and-suspenders поверх автобэкапов managed-провайдера: защищает от
# инцидента уровня аккаунта/провайдера. Запускается cron'ом на прод-VM.
#
# Зависимости: docker (pg_dump берётся из контейнера postgres:16-alpine),
# gzip; openssl — только при включённом шифровании.
#
# Env:
#   DATABASE_URL                — если не задан, читается из .env.production
#   BACKUP_DIR                  — куда класть (default /var/backups/lk-otsfera)
#   BACKUP_KEEP_DAYS            — ротация, дней (default 14)
#   BACKUP_ENCRYPT_PASSPHRASE   — если задан, дамп шифруется openssl enc -aes-256-cbc
#
# Выгрузка недельной копии во второй бакет (rclone) — отдельной строкой cron:
#   rclone copy "$BACKUP_DIR" secondary:lk-otsfera-backups --min-age 0 --max-age 24h
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/lk-otsfera}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
ENV_FILE="${ENV_FILE:-.env.production}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "[pg-dump] DATABASE_URL не задан и $ENV_FILE не найден" >&2
    exit 1
  fi
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [[ -z "$DATABASE_URL" ]]; then
  echo "[pg-dump] пустой DATABASE_URL" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/cabinet-$STAMP.dump.gz"

# -Fc (custom format) → pg_restore выборочно и параллельно; --no-owner для
# восстановления под другим пользователем managed-БД.
docker run --rm --network host -e DATABASE_URL="$DATABASE_URL" postgres:16-alpine \
  pg_dump --dbname="$DATABASE_URL" -Fc --no-owner | gzip > "$OUT"

if [[ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt \
    -pass env:BACKUP_ENCRYPT_PASSPHRASE -in "$OUT" -out "$OUT.enc"
  rm -f "$OUT"
  OUT="$OUT.enc"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[pg-dump] OK: $OUT ($SIZE)"

# Ротация: только наши файлы, строго по маске.
find "$BACKUP_DIR" -maxdepth 1 -name 'cabinet-*.dump.gz*' -mtime "+$KEEP_DAYS" -print -delete \
  | sed 's/^/[pg-dump] rotated: /'

# Санити: дамп не должен быть подозрительно мал (пустая БД ~ единицы КБ).
if [[ "$(stat -c%s "$OUT")" -lt 10240 ]]; then
  echo "[pg-dump] WARNING: дамп меньше 10КБ — проверьте DATABASE_URL/содержимое БД" >&2
  exit 2
fi
