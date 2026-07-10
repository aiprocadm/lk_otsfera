#!/usr/bin/env bash
# Проверка восстановления логического дампа (R0.5, docs/runbook-backups.md §4).
# Поднимает одноразовый Postgres-контейнер, восстанавливает дамп и гоняет smoke:
#   1) _prisma_migrations непуста и без failed-строк (миграции доехали);
#   2) ключевые таблицы непусты;
#   3) печатает контрольные количества строк для сверки с продом.
#
# Использование:
#   ./scripts/backup/restore-check.sh /var/backups/lk-otsfera/cabinet-<...>.dump.gz
#   (для .enc сначала: openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPT_PASSPHRASE -in f.enc -out f)
set -euo pipefail

DUMP="${1:?путь к .dump.gz обязателен}"
[[ -f "$DUMP" ]] || { echo "[restore-check] файл не найден: $DUMP" >&2; exit 1; }

NAME="lk-restore-check-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[restore-check] поднимаю одноразовый Postgres ($NAME)…"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore_check \
  postgres:16-alpine >/dev/null

for i in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres -d restore_check >/dev/null 2>&1 && break
  [[ "$i" == 30 ]] && { echo "[restore-check] Postgres не поднялся" >&2; exit 1; }
  sleep 2
done

echo "[restore-check] восстанавливаю дамп…"
gunzip -c "$DUMP" | docker exec -i "$NAME" \
  pg_restore --dbname=postgresql://postgres:restore@localhost/restore_check \
  --no-owner --exit-on-error

psql_q() {
  docker exec "$NAME" psql -U postgres -d restore_check -tA -c "$1"
}

echo "[restore-check] smoke…"
MIG_TOTAL="$(psql_q 'SELECT count(*) FROM "_prisma_migrations"')"
MIG_FAILED="$(psql_q 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL')"
[[ "$MIG_TOTAL" -gt 0 ]] || { echo "[restore-check] FAIL: _prisma_migrations пуста" >&2; exit 1; }
[[ "$MIG_FAILED" == 0 ]] || { echo "[restore-check] FAIL: незавершённые миграции: $MIG_FAILED" >&2; exit 1; }

FAILED=0
for t in User Company Order Document Payment; do
  CNT="$(psql_q "SELECT count(*) FROM \"$t\"")"
  echo "[restore-check]   $t: $CNT строк"
  if [[ "$CNT" == 0 ]]; then
    echo "[restore-check] FAIL: таблица \"$t\" пуста" >&2
    FAILED=1
  fi
done
[[ "$FAILED" == 0 ]] || exit 1

echo "[restore-check] миграций применено: $MIG_TOTAL"
echo "RESTORE CHECK: OK"
