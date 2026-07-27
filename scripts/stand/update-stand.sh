#!/usr/bin/env bash
# Автообновление тестового стенда до свежей ветки main (docs/runbook-test-stand.md).
#
# Зачем: владелец ведёт разработку параллельно и хочет сразу смотреть результат
# в браузере глазами пользователя. Поэтому стенд не заморожен, а сам догоняет main.
#
# Стенд работает из ОТДЕЛЬНОЙ копии репозитория, а не из рабочей папки разработки.
# Причина — реальная авария 2026-07-21..27: `npm run dev` соседней сессии в общей
# папке затёр `.next`, `next start` перестал находить сборку, служба падала в цикле
# каждые 5 секунд ШЕСТЬ СУТОК, и внешне это выглядело как сетевая проблема.
# Пока стенд и разработка делят папку, это неизбежно повторяется.
#
# Главный принцип: стенд НИКОГДА не остаётся без рабочей сборки. Перед пересборкой
# снимается копия `.next`, и при любой осечке (зависимости, сборка, миграции) всё
# откатывается на предыдущее рабочее состояние, а службы не трогаются.
#
# Зависимости: git, node/npm (путь задаётся STAND_NODE_BIN), flock (util-linux),
# systemd. sudo НЕ нужен: службы объявлены с User=aiproc, поэтому перезапуск
# делается через kill главного процесса — systemd с Restart=always поднимет сам.
#
# Env:
#   STAND_DIR       — папка отдельной копии стенда (default /home/aiproc/stands/lk_otsfera)
#   STAND_BRANCH    — какую ветку показывать (default main)
#   STAND_UNITS     — службы для перезапуска (default "lk-otsfera-web lk-otsfera-worker")
#   STAND_ENV_FILE  — файл настроек внутри копии (default .env.production)
#   STAND_LOG       — журнал обновлений (default <STAND_DIR>/../logs/lk-update.log)
#   STAND_NODE_BIN  — папка с node/npm (default /home/aiproc/.nvm/versions/node/v24.18.0/bin)
#
# Установка в cron (пользователь, от которого работают службы; НЕ root):
#   */10 * * * * /home/aiproc/stands/lk_otsfera/scripts/stand/update-stand.sh
#
# Нового коммита нет — скрипт молча выходит, ничего не трогая. Ручной запуск
# безопасен и делает ровно то же самое.

# ВАЖНО: здесь намеренно НЕ `set -e`. Скрипт обязан сам перехватывать ошибки
# каждого шага и делать откат, а не умирать на первой из них.
set -uo pipefail

STAND_DIR="${STAND_DIR:-/home/aiproc/stands/lk_otsfera}"
STAND_BRANCH="${STAND_BRANCH:-main}"
STAND_UNITS="${STAND_UNITS:-lk-otsfera-web lk-otsfera-worker}"
STAND_ENV_FILE="${STAND_ENV_FILE:-.env.production}"
STAND_LOG="${STAND_LOG:-$(dirname "$STAND_DIR")/logs/lk-update.log}"
STAND_NODE_BIN="${STAND_NODE_BIN:-/home/aiproc/.nvm/versions/node/v24.18.0/bin}"

# Скрипт лежит ВНУТРИ той самой копии, которую сам же перезаписывает через
# `git reset --hard`. Bash дочитывает файл по ходу выполнения, поэтому подмена
# файла на середине приводит к непредсказуемому поведению. Поэтому первым делом
# переезжаем на временную копию себя и работаем уже с неё.
if [[ "${STAND_SELF_EXEC:-}" != "1" ]]; then
    self_copy="$(mktemp)" || exit 1
    cp "$0" "$self_copy" || { rm -f "$self_copy"; exit 1; }
    chmod +x "$self_copy"
    STAND_SELF_EXEC=1 exec "$self_copy" "$@"
fi
# Удаляем временную копию сразу: файл уже открыт, и Linux даст дочитать его
# до конца по существующему дескриптору, а мусор после себя мы не оставим.
rm -f "$0"

export PATH="$STAND_NODE_BIN:$PATH"
mkdir -p "$(dirname "$STAND_LOG")"

log() { echo "$(date '+%F %T') $*" >>"$STAND_LOG"; }

# Сборка длится дольше, чем промежуток между запусками по расписанию,
# поэтому запуски не должны накладываться друг на друга.
exec 9>"${STAND_DIR}.update.lock"
if ! flock -n 9; then
    log "предыдущее обновление ещё идёт — пропускаю этот запуск"
    exit 0
fi

cd "$STAND_DIR" || { log "ОШИБКА: нет папки $STAND_DIR"; exit 1; }

if ! git fetch --depth=1 origin "$STAND_BRANCH" --quiet 2>>"$STAND_LOG"; then
    log "ОШИБКА: не удалось получить обновления с GitHub"
    exit 1
fi

prev="$(git rev-parse HEAD)"
target="$(git rev-parse "origin/$STAND_BRANCH")"

if [[ "$prev" == "$target" ]]; then
    exit 0   # нового кода нет — обычный случай, молчим
fi

log "новый код ${prev:0:8} -> ${target:0:8}, начинаю обновление"

set -a
# shellcheck disable=SC1090
. "./$STAND_ENV_FILE"
set +a

# Снимок рабочей сборки — страховка на случай неудачи.
# Именно копия, а не жёсткие ссылки: пересборка переписывает часть файлов
# на месте и испортила бы такой «снимок» вместе с оригиналом.
rm -rf .next.bak
cp -a .next .next.bak 2>/dev/null

rollback() {
    log "ОТКАТ: возвращаю предыдущую рабочую версию ${prev:0:8}"
    git reset --hard "$prev" --quiet 2>>"$STAND_LOG"
    if [[ -d .next.bak ]]; then
        rm -rf .next
        mv .next.bak .next
    fi
    log "откат завершён, стенд продолжает работать на старой версии"
}

lock_before="$(md5sum package-lock.json 2>/dev/null | cut -d' ' -f1)"

if ! git reset --hard "$target" --quiet 2>>"$STAND_LOG"; then
    log "ОШИБКА: не удалось переключить код"
    rollback
    exit 1
fi

lock_after="$(md5sum package-lock.json 2>/dev/null | cut -d' ' -f1)"

# Переустанавливаем зависимости только если список реально изменился —
# иначе это лишние несколько минут на каждом обновлении.
if [[ "$lock_before" != "$lock_after" ]]; then
    log "изменился package-lock.json — переустанавливаю зависимости"
    if ! npm ci >>"$STAND_LOG" 2>&1; then
        log "ОШИБКА: не встали зависимости"
        rollback
        exit 1
    fi
fi

if ! npx prisma generate >>"$STAND_LOG" 2>&1; then
    log "ОШИБКА: не сгенерировался клиент Prisma"
    rollback
    exit 1
fi

if ! npm run build >>"$STAND_LOG" 2>&1; then
    log "ОШИБКА: не собралось"
    rollback
    exit 1
fi

# Миграции — ПОСЛЕ успешной сборки: база у стенда общая с разработкой,
# и менять её ради кода, который даже не собрался, нельзя.
if ! npx prisma migrate deploy >>"$STAND_LOG" 2>&1; then
    log "ОШИБКА: не применились миграции базы"
    rollback
    exit 1
fi

rm -rf .next.bak

for unit in $STAND_UNITS; do
    main_pid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null)"
    if [[ -n "$main_pid" && "$main_pid" != "0" ]]; then
        kill "$main_pid" 2>>"$STAND_LOG"
    else
        # Безобидно: служба сейчас в паузе перезапуска и стартует уже с новой сборкой.
        log "ПРЕДУПРЕЖДЕНИЕ: не нашёл процесс службы $unit, перезапуск пропущен"
    fi
done

log "готово: стенд обновлён до ${target:0:8} — $(git log -1 --format='%s' | head -c 80)"
