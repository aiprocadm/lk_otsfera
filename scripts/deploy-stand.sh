#!/usr/bin/env bash
#
# Развёртывание стенда lk.ptsfera.online из свежей ветки main.
#
# Запускается по расписанию (cron пользователя aiproc, раз в 10 минут).
# Если нового кода нет — молча выходит, ничего не трогает.
#
# Главный принцип: стенд НИКОГДА не должен остаться без рабочей сборки.
# Перед пересборкой снимается копия рабочей папки .next, и при любой осечке
# (не встали зависимости, не собралось, не применились миграции) код и сборка
# откатываются на предыдущее рабочее состояние, а служба не трогается.
#
# Службы крутятся от пользователя aiproc, поэтому перезапуск делается через
# kill главного процесса: systemd с Restart=always поднимет его сам. sudo не нужен.
#
# Ручной запуск:
#   npm run deploy:stand              # обычный прогон (обновит, если есть новый код)
#   npm run deploy:stand -- --dry-run # только показать, что будет сделано
#   npm run deploy:stand -- --force   # пересобрать текущий коммит заново
#
# Настройки переопределяются через переменные окружения (см. блок «Настройки»).
# Подробности — docs/runbook-stand-autoupdate.md

set -uo pipefail

# --- Самокопирование ---------------------------------------------------------
# Скрипт лежит внутри репозитория, который сам же и обновляет. Во время
# `git reset --hard` файл скрипта перезаписывается на диске, а bash дочитывает
# его по мере выполнения — и может исполнить обрывок новой версии. Поэтому
# первым делом копируем себя во временный файл и продолжаем работу уже оттуда.
if [ -z "${LK_DEPLOY_SELF_COPY:-}" ]; then
    _self_copy=$(mktemp "${TMPDIR:-/tmp}/lk-deploy-XXXXXX.sh") || exit 1
    if ! cat "$0" > "$_self_copy"; then
        rm -f "$_self_copy"
        exit 1
    fi
    export LK_DEPLOY_SELF_COPY="$_self_copy"
    exec bash "$_self_copy" "$@"
fi
trap 'rm -f "$LK_DEPLOY_SELF_COPY"' EXIT

# --- Настройки ---------------------------------------------------------------
STAND=${LK_STAND_DIR:-/home/aiproc/stands/lk_otsfera}
UNITS=${LK_UNITS:-"lk-otsfera-web lk-otsfera-worker"}
LOGDIR=${LK_LOG_DIR:-/home/aiproc/stands/logs}
LOG=${LK_LOG_FILE:-$LOGDIR/lk-update.log}
LOCK=${LK_LOCK_FILE:-/home/aiproc/stands/lk-update.lock}
NODE_BIN=${LK_NODE_BIN:-/home/aiproc/.nvm/versions/node/v24.18.0/bin}
BRANCH=${LK_BRANCH:-main}
HEALTH_URL=${LK_HEALTH_URL:-http://127.0.0.1:3000/}
HEALTH_TIMEOUT=${LK_HEALTH_TIMEOUT:-60}

# --- Аргументы ---------------------------------------------------------------
FORCE=0; DRY_RUN=0; DO_RESTART=1; DO_MIGRATE=1

usage() {
    # Печатаем шапку файла: всё от второй строки до первой не-комментарной.
    awk 'NR==1 {next} /^#/ {sub(/^#[[:space:]]?/, ""); print; next} {exit}' "$0"
    cat <<'EOF'

Флаги:
  --force        пересобрать даже если новый код не появился
  --dry-run      только показать, что будет сделано, ничего не менять
  --no-restart   собрать и обновить код, но не перезапускать службы
  --no-migrate   не применять миграции базы
  -h, --help     эта справка
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --force)      FORCE=1 ;;
        --dry-run)    DRY_RUN=1 ;;
        --no-restart) DO_RESTART=0 ;;
        --no-migrate) DO_MIGRATE=0 ;;
        -h|--help)    usage; exit 0 ;;
        *)            echo "Неизвестный аргумент: $1 (--help для справки)" >&2; exit 2 ;;
    esac
    shift
done

export PATH="$NODE_BIN:$PATH"
mkdir -p "$LOGDIR"

# В файл пишем всегда; при ручном запуске дублируем на экран, иначе кажется,
# что скрипт завис и ничего не делает.
log() {
    local line
    line="$(date '+%F %T') $*"
    echo "$line" >> "$LOG"
    [ -t 2 ] && echo "$line" >&2
    return 0
}

# --- Защита от наложения запусков -------------------------------------------
# Сборка длится дольше, чем промежуток между запусками по расписанию.
exec 9>"$LOCK"
if ! flock -n 9; then
    log "предыдущее обновление ещё идёт — пропускаю этот запуск"
    exit 0
fi

cd "$STAND" || { log "ОШИБКА: нет папки стенда $STAND"; exit 1; }

if ! git fetch --depth=1 origin "$BRANCH" --quiet 2>>"$LOG"; then
    log "ОШИБКА: не удалось получить обновления с GitHub"
    exit 1
fi

PREV=$(git rev-parse HEAD)
TARGET=$(git rev-parse "origin/$BRANCH")

if [ "$PREV" = "$TARGET" ] && [ "$FORCE" -eq 0 ]; then
    exit 0   # нового кода нет — обычный случай, молчим
fi

if [ "$DRY_RUN" -eq 1 ]; then
    log "ПРОБНЫЙ ПРОГОН: ${PREV:0:8} -> ${TARGET:0:8}"
    log "  собрал бы: npx prisma generate && npm run build"
    [ "$DO_MIGRATE" -eq 1 ] && log "  применил бы миграции: npx prisma migrate deploy"
    [ "$DO_RESTART" -eq 1 ] && log "  перезапустил бы службы: $UNITS"
    exit 0
fi

log "новый код ${PREV:0:8} -> ${TARGET:0:8}, начинаю обновление"

if [ ! -f ./.env.production ]; then
    log "ОШИБКА: нет файла .env.production в $STAND"
    exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env.production
set +a

# Снимок рабочей сборки — страховка на случай неудачи.
rm -rf .next.bak
cp -a .next .next.bak 2>/dev/null

# Откат к предыдущему рабочему состоянию: и код, и сборка.
rollback() {
    log "ОТКАТ: возвращаю предыдущую рабочую версию ${PREV:0:8}"
    git reset --hard "$PREV" --quiet 2>>"$LOG"
    if [ -d .next.bak ]; then
        rm -rf .next
        mv .next.bak .next
    fi
    log "откат завершён, стенд продолжает работать на старой версии"
}

LOCK_BEFORE=$(md5sum package-lock.json 2>/dev/null | cut -d' ' -f1)

if ! git reset --hard "$TARGET" --quiet 2>>"$LOG"; then
    log "ОШИБКА: не удалось переключить код"
    rollback
    exit 1
fi

LOCK_AFTER=$(md5sum package-lock.json 2>/dev/null | cut -d' ' -f1)

# Зависимости переустанавливаем только если список реально изменился —
# иначе это лишние несколько минут на каждом обновлении.
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
    log "изменился список зависимостей — переустанавливаю"
    if ! npm ci >>"$LOG" 2>&1; then
        log "ОШИБКА: не встали зависимости"
        rollback
        exit 1
    fi
fi

if ! npx prisma generate >>"$LOG" 2>&1; then
    log "ОШИБКА: не сгенерировался клиент базы"
    rollback
    exit 1
fi

if ! npm run build >>"$LOG" 2>&1; then
    log "ОШИБКА: не собралось"
    rollback
    exit 1
fi

# Боевая сборка обязана существовать: без BUILD_ID `next start` не поднимется,
# а служба уйдёт в бесконечный цикл перезапуска.
if [ ! -f .next/BUILD_ID ]; then
    log "ОШИБКА: сборка прошла, но .next/BUILD_ID не появился"
    rollback
    exit 1
fi

# Миграции применяем ПОСЛЕ успешной сборки: база общая с разработкой,
# и трогать её из-за кода, который даже не собрался, нельзя.
if [ "$DO_MIGRATE" -eq 1 ]; then
    if ! npx prisma migrate deploy >>"$LOG" 2>&1; then
        log "ОШИБКА: не применились миграции базы"
        rollback
        exit 1
    fi
fi

rm -rf .next.bak

if [ "$DO_RESTART" -eq 0 ]; then
    log "готово (без перезапуска): код обновлён до ${TARGET:0:8}"
    exit 0
fi

for unit in $UNITS; do
    MAIN_PID=$(systemctl show -p MainPID --value "$unit" 2>/dev/null)
    if [ -n "$MAIN_PID" ] && [ "$MAIN_PID" != "0" ]; then
        kill "$MAIN_PID" 2>>"$LOG"
    else
        log "ПРЕДУПРЕЖДЕНИЕ: не нашёл процесс службы $unit, перезапуск пропущен"
    fi
done

# Проверка, что сайт действительно поднялся. Без неё неудачный запуск виден
# только тогда, когда на него пожалуется живой человек.
if command -v curl >/dev/null 2>&1; then
    deadline=$(( SECONDS + HEALTH_TIMEOUT ))
    code=""
    while [ "$SECONDS" -lt "$deadline" ]; do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --noproxy '*' "$HEALTH_URL" 2>/dev/null)
        [ -n "$code" ] && [ "$code" != "000" ] && break
        sleep 2
    done
    if [ -n "$code" ] && [ "$code" != "000" ]; then
        log "стенд отвечает (HTTP $code)"
    else
        log "ВНИМАНИЕ: стенд не ответил за ${HEALTH_TIMEOUT}с — проверьте: systemctl status ${UNITS%% *}"
    fi
fi

log "готово: стенд обновлён до ${TARGET:0:8} — $(git log -1 --format='%s' | head -c 80)"
