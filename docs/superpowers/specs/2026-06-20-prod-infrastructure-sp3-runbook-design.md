# Дизайн — прод-инфраструктура, SP3: greenfield-runbook РФ (TLS + провижн + bring-up)

**Дата:** 2026-06-20
**Статус:** утверждён (дизайн), готов к плану
**Родительская задача:** гринфилд прод-запуск на РФ-инфраструктуре (см. [SP1-спеку §0](2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md) — контекст 152-ФЗ, топология C, декомпозиция SP1→SP2→SP3).
**Зависит от:** SP1 (S3-адаптер, [PR #134](https://github.com/aiprocadm/lk_otsfera/pull/134)) + SP2 (упаковка, [PR #135](https://github.com/aiprocadm/lk_otsfera/pull/135) — образ + `docker-compose.prod.yml` + `.env.production.example`).
**Эстафета в:** [runbook-launch-deploy.md](../../runbook-launch-deploy.md) §0.1 (свежая БД: bootstrap-admin, миграции, флип флагов, 1С).
**Naming-эталон:** [runbook-staged-rollout-cabinets.md](../../runbook-staged-rollout-cabinets.md) (жанр операционного документа).

---

## 0. Цель и граница

SP2 опубликовал web **только на loopback** (`127.0.0.1:3000`) и намеренно отложил TLS/reverse-proxy + провижн инфры. Сейчас приложение в принципе недостижимо снаружи VM. **SP3 закрывает «последний километр»:** провижн РФ-инфры → DNS → firewall → TLS-терминация → запуск compose → передача эстафеты в launch-deploy.

**Граница SP3 (что владеет):**
- reverse-proxy + автоматический HTTPS (Caddy в compose);
- provider-agnostic чеклист провижна (managed PostgreSQL + S3 + VM + DNS + firewall);
- инфра-уровневый smoke (TLS, health через домен, worker→Redis);
- контейнерные формы команд bootstrap-admin/миграций (адаптация launch-deploy под контейнеры).

**Не-цель (явно):**
- миграции БД, bootstrap первого админа, флип feature-флагов, перевод 1С в live — это **[launch-deploy §0.1](../../runbook-launch-deploy.md)**; SP3 только дотягивает первые два до контейнерной формы и ссылается;
- CI/CD сборка образа (push в registry);
- provider-специфичные CLI/консоль-команды (провайдер не зафиксирован — Yandex/VK/Selectel; описание абстрактное);
- авто-миграции на старте (остаются операторской командой, как в SP2 §5).

**Решения брейншторма 2026-06-20:**
- **TLS = Caddy в compose** (4-й сервис), а не nginx+certbot и не provider-LB. Авто-выпуск Let's Encrypt из коробки + авто-renew = минимум ops-действий под профиль «базовые ops-навыки».
- **Провижн — чисто provider-agnostic** (без worked-example на конкретном провайдере). S3 API и managed-PG-контракт одинаковы у РФ-провайдеров → максимальная переносимость.
- **Отдельный runbook**, а не врезка в launch-deploy. Зеркалит разделение `staged-rollout` ↔ `launch-deploy`: один документ — одна ответственность.

---

## 1. Артефакты (код/конфиг)

| Файл | Действие | Ответственность |
|---|---|---|
| `Caddyfile` | создать | reverse-proxy `:443` → `web:3000`, авто-HTTPS (Let's Encrypt), HTTP→HTTPS-редирект |
| `docker-compose.prod.yml` | правка | добавить сервис `caddy` (публикует `80`+`443`) + тома `caddy_data`/`caddy_config` |
| `.env.production.example` | правка | добавить `APP_DOMAIN` (Caddy выпускает сертификат на этот домен) |
| `docs/runbook-prod-infra-rf.md` | создать | операторская процедура: провижн → DNS → firewall → TLS → bring-up → эстафета |

---

## 2. `Caddyfile` (новый)

Весь файл:

```
{$APP_DOMAIN} {
	reverse_proxy web:3000
	encode gzip
}
```

- Caddy автоматически выпускает сертификат Let's Encrypt при первом запросе на домен, редиректит HTTP→HTTPS и авто-обновляет сертификат (без cron, в отличие от certbot).
- `web:3000` резолвится по compose-сети (имя сервиса), TLS терминируется в Caddy, к web идёт plain HTTP внутри сети.
- `encode gzip` — компрессия ответов.
- **Опционально** (в комментарии, не в активном конфиге): глобальный блок `{ email <ops-email> }` для ACME-уведомлений об истечении. Не обязателен для работы.

**Next.js за прокси:** Caddy по умолчанию выставляет `X-Forwarded-Proto`/`X-Forwarded-For`/`Host`. Дополнительной настройки `trustHost` в Next не требуется для текущих маршрутов (приложение строит абсолютные URL из `NEXT_PUBLIC_APP_URL`, а не из заголовков запроса).

---

## 3. `docker-compose.prod.yml` — правка (добавить `caddy`)

Добавляется 4-й сервис и два именованных тома. Существующие `web`/`worker`/`redis` из SP2 **не меняются** (web остаётся на `127.0.0.1:3000:3000` — для прямого `curl` health на VM при отладке; Caddy ходит к нему по внутренней сети).

```yaml
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]          # единственный сервис, смотрящий наружу
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data                 # сертификаты + ACME-аккаунт (stateful!)
      - caddy_config:/config
    env_file: .env.production            # грузит APP_DOMAIN в контейнер → Caddyfile {$APP_DOMAIN}
    depends_on: [web]
    restart: unless-stopped

volumes:
  redisdata:
  caddy_data:
  caddy_config:
```

- Наружу публикуется **только Caddy** (`80`/`443`). Redis/web/worker — внутри сети; PG/S3 внешние через env.
- `caddy_data` — **stateful-том наравне с `redisdata`** (не кэш): хранит выпущенные сертификаты и ACME-аккаунт.
- `APP_DOMAIN` Caddy читает из **собственного окружения контейнера**, поэтому `caddy` получает `env_file: .env.production` (как web/worker). Это надёжнее, чем `environment: APP_DOMAIN: ${APP_DOMAIN}` — последнее зависит от интерполяции из shell/`--env-file` и молча даст пустой домен, если оператор не экспортировал переменную.

---

## 4. `.env.production.example` — правка

Добавить одну переменную (в секцию «Приложение», рядом с `NEXT_PUBLIC_APP_URL`):

```bash
# --- Домен (Caddy выпускает на него TLS-сертификат) ---
APP_DOMAIN=lk.example.ru
NEXT_PUBLIC_APP_URL=https://lk.example.ru   # ДОЛЖЕН совпадать с APP_DOMAIN (схема https)
```

Инвариант: `NEXT_PUBLIC_APP_URL` = `https://${APP_DOMAIN}`. Рассинхрон → ссылки в письмах/редиректы указывают не на тот хост.

---

## 5. `docs/runbook-prod-infra-rf.md` (новый) — структура

Жанр — операционный документ (реальные действия выполняет оператор; агент даёт процедуру, чеклисты, go/no-go). Секции:

**Шапка:** Owner (ops/тех.лид), Scope (топология C, provider-agnostic), Non-goal (миграции/флаги/bootstrap/1С = launch-deploy; SP3 их только дотягивает до контейнера), ссылки на SP1/SP2-спеки + оба существующих runbook'а.

**§0. Топология (прочитать один раз).** ASCII-схема:
```
            Интернет (443/80)
                  │
              [ Caddy ]  ← TLS, авто-Let's Encrypt
                  │ web:3000 (внутр. сеть)
              [ web ]──┐
              [worker] ├── Redis (внутр., не публикуется)
                       │
        внешние: managed PostgreSQL (РФ) · S3 (РФ)
```
Подчёркивает: наружу смотрит только Caddy; PG/S3 — внешние managed-сервисы.

**§1. Провижн инфры (provider-agnostic чеклист):**
- **Managed PostgreSQL:** 🔴 **создавать БД с ICU-коллацией** (известная гоча: locale C → кириллица в `ILIKE` возвращает 0 строк — это дефект окружения, не кода); версия 16; бэкапы/HA на стороне провайдера; сетевой доступ ограничить IP VM; получить `DATABASE_URL` + `DIRECT_URL`.
- **S3-бакет `documents`:** создать бакет, access key/secret, регион; 🔴 `S3_FORCE_PATH_STYLE=1` для Yandex/VK/Selectel (гоча SP1); доступ presigned-URL (CORS не требуется).
- **VM:** ориентир 2 vCPU / 4 ГБ; установлен Docker + compose-plugin; публичный IP.
- **DNS:** A-запись `APP_DOMAIN` → публичный IP VM — **до §3** (иначе ACME провалится).
- **Firewall:** вход только `22` (ограничить по источнику) / `80` / `443`; исход — к PG, S3, Resend (email), Let's Encrypt.

**§2. Подготовка VM:** доставить образ (`docker build` на VM из репо, либо pull из registry); `cp .env.production.example .env.production` и заполнить реальными значениями (вкл. `APP_DOMAIN`, `NEXT_PUBLIC_APP_URL`, `JWT_SECRET`≥32, `HEALTH_TOKEN`≥32, S3-*, DB-*).

**§3. TLS bring-up:**
```bash
# DNS должен резолвиться в IP VM:
dig +short <APP_DOMAIN>            # ожидание: публичный IP VM
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f caddy   # наблюдать "certificate obtained"
curl -fsS https://<APP_DOMAIN>/api/health/live            # 200 через валидный TLS
```

**§4. Infra-smoke (до данных, гейт перехода к §5):**
| Чек | Команда | Ожидание |
|---|---|---|
| TLS валиден | `curl -fsS https://<domain>/api/health/live` | 200, цепочка сертификата валидна |
| HTTP→HTTPS | `curl -sI http://<domain>` | 308/301 на `https://` |
| readiness | `curl -fsS -H "Authorization: Bearer $HEALTH_TOKEN" https://<domain>/api/health` | DB+Redis ok |
| worker жив | `docker compose ... logs worker` | подключился к Redis, нет crash-loop |

**§5. 🤝 Эстафета → launch-deploy §0.1.** Контейнерные формы команд (адаптация — launch-deploy написан до контейнеров):
```bash
# bootstrap первого админа (launch-deploy §0.1 Step 0):
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL=<email> -e ADMIN_PASSWORD=<≥8 символов> \
  web npm run db:create-admin
# миграции (launch-deploy §3.2 — pre-deploy gate dedupe:commission на свежей БД no-op):
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
```
Дальше — `SHOW_DEMO_LOGINS` не ставить, demo-seed не запускать, флип opt-in флагов (org/manager/leader/enrollment[+chat]) и 1С — **строго по launch-deploy** (§0.1, §3.3, §4). SP3 это не дублирует.

**§6. Откат / типовые проблемы инфра-уровня:**
- **ACME-фейл** (`certificate obtained` не появляется): DNS ещё не распространился, или порт 80/443 закрыт firewall'ом → проверить `dig` + входящие правила.
- **Cert rate-limit** (Let's Encrypt: 5 сертификатов/неделю на домен): обычно из-за потери тома `caddy_data` при пересоздании контейнера → **`caddy_data` беречь**; при упоре в лимит — ждать окна или staging-ACME.
- **Postgres: кириллица не ищется** → БД создана без ICU-коллации (§1) → пересоздать БД с ICU.
- **S3: ошибки доступа/404 при upload/download** → `S3_FORCE_PATH_STYLE`/`S3_REGION` не под провайдера (гоча SP1) → сверить с консолью провайдера.
- **Откат инфры:** `docker compose -f docker-compose.prod.yml down` (тома сохраняются); фичи/1С откатываются флагами по launch-deploy §5.

**§7. Чек-лист одной страницей** (строгий порядок):
- [ ] §1 провижн: PG (ICU!) + S3 (`documents`) + VM (Docker) подготовлены
- [ ] §1 DNS A-запись `APP_DOMAIN` → IP VM распространилась (`dig`)
- [ ] §1 firewall: только 22/80/443 вход
- [ ] §2 `.env.production` заполнен (`APP_DOMAIN`=`NEXT_PUBLIC_APP_URL` без схемы, секреты ≥32)
- [ ] §3 `docker compose up -d` → в логах caddy `certificate obtained`
- [ ] §4 infra-smoke зелёный (TLS / health / redirect / worker)
- [ ] §5 эстафета: bootstrap-admin + `migrate deploy` (контейнерные формы) → дальше launch-deploy

---

## 6. Тест-стратегия (верификация)

SP3 — инфра/конфиг + операционная документация, не unit-тестируемый код. Проверки:

1. **`docker compose -f docker-compose.prod.yml config`** — валидирует синтаксис после добавления `caddy` (статический парс; временный `.env.production` с `APP_DOMAIN`, как в SP2-плане Task 4).
2. **Статическая проверка Caddyfile** — наличие `reverse_proxy web:3000` и `{$APP_DOMAIN}`.
3. **`.env.production.example`** содержит `APP_DOMAIN` (grep-чек, как в SP2 Task 5).
4. **Markdown-линки runbook'а** разрешаются (relative-paths до launch-deploy/staged-rollout/specs).
5. **`npm run typecheck`/`lint`** не затронуты (SP3 не трогает `src/`).

**operator-deferred (требуют живой VM + домен + DNS):** реальный выпуск сертификата Let's Encrypt, end-to-end HTTPS-smoke, эстафетные команды против managed-PG. Runbook §3–§5 и есть этот операторский чеклист. Локально Docker на dev-машине интермиттентный (см. память) — `docker compose config` прогоняется, если демон доступен, иначе статический YAML-чек.

---

## 7. Критерии готовности SP3

- [ ] `Caddyfile` создан: `reverse_proxy web:3000` + `{$APP_DOMAIN}` + `encode gzip`.
- [ ] `docker-compose.prod.yml`: сервис `caddy` (image `caddy:2-alpine`, ports 80/443, тома `caddy_data`/`caddy_config`, `restart: unless-stopped`, `depends_on: web`); existing web/worker/redis не изменены.
- [ ] `.env.production.example`: добавлен `APP_DOMAIN` + инвариант с `NEXT_PUBLIC_APP_URL`.
- [ ] `docs/runbook-prod-infra-rf.md`: §0 топология, §1 провижн (ICU + S3-path-style + DNS + firewall), §2 подготовка VM, §3 TLS bring-up, §4 infra-smoke, §5 эстафета (контейнерные команды), §6 откат/проблемы, §7 одностраничный чеклист.
- [ ] `docker compose -f docker-compose.prod.yml config` валиден (или статический YAML-чек, если Docker недоступен).
- [ ] `npm run typecheck`/`lint` зелёные (SP3 не трогает `src/`).
- [ ] **operator-deferred:** реальный выпуск TLS + HTTPS-smoke + эстафета против managed-PG — на живой VM с доменом.

---

## 8. Файлы SP3

| Файл | Действие |
|---|---|
| `Caddyfile` | создать |
| `docker-compose.prod.yml` | правка (сервис `caddy` + тома) |
| `.env.production.example` | правка (`APP_DOMAIN`) |
| `docs/runbook-prod-infra-rf.md` | создать |
