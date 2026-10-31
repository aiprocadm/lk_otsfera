#!/usr/bin/env bash
# deploy.sh <IMAGE_TAG> — выкладка одного образа; одинаковый на стейджинге и проде
# (`У-339`, ТЗ 28.10.2026, ДП §7). Разница сред — только в `.env.production` и
# `.deploy.env` рядом со стеком.
#
#   ./scripts/deploy/deploy.sh v0.12.0           # прод (запускает только человек)
#   ./scripts/deploy/deploy.sh staging-<sha>     # стейджинг
#   ./scripts/deploy/deploy.sh <прежний тег>     # откат: прежний образ, схема БД остаётся
#
# Что делает: берёт образ по тегу (локальный или из реестра), поднимает стек и
# ждёт здоровья всех сервисов (миграции идут отдельным сервисом `migrate` ДО
# приложения), проверяет /api/health/live и дописывает тег в deploy.log — это
# история для отката; работающий тег запоминается в `.env` стека. Если что-то не поднялось, печатает команду отката на
# прежний тег; сам не откатывает — решение за человеком (ДП §7, п. 6).
#
# Миграции при откате НЕ отменяются: прежний образ обязан работать на новой
# схеме — это держат правила совместимости (CLAUDE.md §2c) и страж миграций.
#
# Отличие от scripts/stand/update-stand.sh: тот обновляет тестовый стенд из
# исходников (systemd, без Docker) и остаётся для него; стейджинг и прод
# выкладываются только этим скриптом, из готового образа.
#
# Env (или файл `.deploy.env` в папке стека):
#   DEPLOY_DIR          папка стека: docker-compose.prod.yml, .env.production
#                       (по умолчанию — корень репозитория над этим скриптом)
#   COMPOSE_FILE        стандартная переменная docker compose; на стейджинге —
#                       docker-compose.prod.yml:docker-compose.staging.yml
#   IMAGE_REPO          репозиторий образа в реестре (по умолчанию lk-otsfera)
#   DEPLOY_HEALTH_URL   проверка после подъёма (http://127.0.0.1:3000/api/health/live)
#   DEPLOY_WAIT_TIMEOUT сколько ждать здоровья сервисов, секунд (600)
set -euo pipefail

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  '')
    echo "deploy.sh: не указан тег образа" >&2
    usage >&2
    exit 2
    ;;
esac

IMAGE_TAG="$1"
# Тег попадает в имя образа и в журнал: только безопасные символы, без пробелов
# и путей — опечатка не должна превратиться в чужую команду.
if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "deploy.sh: недопустимый тег «$IMAGE_TAG» (буквы, цифры, . _ -)" >&2
  exit 2
fi

DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$DEPLOY_DIR"

if [[ -f .deploy.env ]]; then
  # shellcheck disable=SC1091
  set -a && . ./.deploy.env && set +a
fi

export IMAGE_TAG
export IMAGE_REPO="${IMAGE_REPO:-lk-otsfera}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/api/health/live}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-600}"
IMAGE="$IMAGE_REPO:$IMAGE_TAG"

if [[ ! -f .env.production ]]; then
  echo "deploy.sh: в $DEPLOY_DIR нет .env.production (собрать по .env.production.example)" >&2
  exit 1
fi

PREV_TAG=""
if [[ -s deploy.log ]]; then
  PREV_TAG="$(tail -n 1 deploy.log | awk '{print $2}')"
fi

rollback_hint() {
  echo "deploy.sh: выкладка $IMAGE_TAG НЕ удалась: $1" >&2
  if [[ -n "$PREV_TAG" && "$PREV_TAG" != "$IMAGE_TAG" ]]; then
    echo "  Откат на прежний образ (схема БД остаётся новой):" >&2
    echo "    $0 $PREV_TAG" >&2
  else
    echo "  Прежнего тега в deploy.log нет — откатывать не на что, разбирайтесь по журналам:" >&2
  fi
  echo "    docker compose logs --tail=200 migrate web worker" >&2
}

echo "deploy.sh: $IMAGE (было: ${PREV_TAG:-—}), стек: $COMPOSE_FILE"

# Образ, собранный на этой же машине, тянуть неоткуда — берём локальный.
if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  if ! docker compose pull migrate web worker; then
    rollback_hint "образ $IMAGE не найден ни локально, ни в реестре"
    exit 1
  fi
fi

if ! docker compose up -d --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"; then
  rollback_hint "сервисы не стали здоровыми за ${WAIT_TIMEOUT} с (или упали миграции)"
  exit 1
fi

if ! curl -fsS --retry 5 --retry-delay 3 --retry-all-errors "$HEALTH_URL" > /dev/null; then
  rollback_hint "не отвечает $HEALTH_URL"
  exit 1
fi

echo "$(date -Is) $IMAGE_TAG" >> deploy.log
# `.env` в папке стека docker compose читает сам: после выкладки служебные
# команды (`docker compose ps/logs/restart`) знают работающий тег без
# повторного ввода. Пишется только после успеха — при осечке там прежний тег.
cat > .env << EOF_ENV
# Пишет scripts/deploy/deploy.sh — работающий релиз. Руками не править.
IMAGE_TAG=$IMAGE_TAG
IMAGE_REPO=$IMAGE_REPO
COMPOSE_FILE=$COMPOSE_FILE
EOF_ENV
echo "deploy.sh: готово — $IMAGE_TAG работает. Дальше: смоук по ранбуку и наблюдение."
