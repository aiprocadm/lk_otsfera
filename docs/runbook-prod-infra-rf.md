# Runbook — прод-инфраструктура РФ (greenfield: провижн → TLS → bring-up)

**Owner**: ops / тех.лид Промтехносфера (провижн инфры + запуск compose + TLS)
**Scope**: развернуть приложение с нуля на **топологии C** (одна VM: web+worker+Redis+Caddy через docker-compose; managed-PostgreSQL и S3 — внешние). Описание **provider-agnostic** (Yandex/VK/Selectel — S3 API и managed-PG-контракт одинаковы).
**Не-цель**: миграции БД, bootstrap первого админа, флип feature-флагов, перевод 1С в live — это [runbook-launch-deploy.md §0.1](runbook-launch-deploy.md). Этот runbook ведёт от пустой VM до работающего HTTPS-эндпоинта и передаёт эстафету (§5).
**Связанное**: дизайн — [SP3-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md); упаковка — [SP2-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp2-packaging-design.md); хранилище — [SP1-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md). Постадийная раскатка кабинетов — [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md).

> Операционный документ. Реальные действия выполняет оператор; этот файл даёт процедуру, чеклисты и go/no-go. Артефакты (`Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`) уже в репозитории (SP1–SP3).

---

## 0. Топология (прочитать один раз)

```
            Интернет (443/80)
                  │
              [ Caddy ]  ← TLS-терминация, авто Let's Encrypt + renew
                  │  web:3000  (внутренняя compose-сеть)
              [  web  ]──┐
              [ worker ] ├── [ Redis ]  (внутр., НЕ публикуется наружу)
                         │
   внешние managed: PostgreSQL (РФ)  ·  S3-хранилище (РФ)
```

- Наружу смотрит **только Caddy** (порты 80/443). `web` остаётся на loopback (`127.0.0.1:3000`) — для прямого `curl` health на VM при отладке.
- `web` и `worker` — **один образ** `lk-otsfera:prod`, разные команды (`npm run start` / `npm run worker`).
- PostgreSQL и S3 — внешние managed-сервисы, доступны только через env в `.env.production`.

---

## 1. Провижн инфры (provider-agnostic чеклист)

| Ресурс | Что сделать | Критично |
|---|---|---|
| **Managed PostgreSQL** | Создать БД `cabinet`, версия 16. Сетевой доступ ограничить IP VM. Получить `DATABASE_URL` + `DIRECT_URL`. **Включить автобэкапы: daily, retention ≥ 7 дней, PITR если доступен — и убедиться в консоли, что первый бэкап создан.** | 🔴 **Создавать БД с ICU-коллацией.** Дефолтный locale `C` ломает кириллицу в `ILIKE` (поиск возвращает 0 строк) — это дефект окружения, не кода. Бэкапы/HA — на стороне провайдера, но их включение проверяет оператор (регламент — [runbook-backups.md](runbook-backups.md)). |
| **S3-хранилище** | Создать бакет `documents`, выпустить access key / secret, узнать регион и endpoint. **Бакет — приватный** (анонимный/public-read доступ запрещён; проверить анонимным GET по прямому URL объекта → 403). **Включить versioning** + lifecycle на noncurrent (30–90 дн) и **шифрование бакета по умолчанию (SSE)**. | 🔴 `S3_FORCE_PATH_STYLE=1` для Yandex/VK/Selectel; `S3_REGION` — под провайдера (дефолт `ru-central1` — яндексовый). Доступ к файлам — presigned-URL (CORS не нужен). Публичный бакет обесценил бы весь presigned-контур. |
| **VM** | Ориентир 2 vCPU / 4 ГБ RAM / 20+ ГБ диск. Установить Docker Engine + compose-plugin. Публичный IP. | — |
| **DNS** | A-запись `APP_DOMAIN` → публичный IP VM. | 🔴 Должна **распространиться до §3** — иначе ACME-челлендж Let's Encrypt провалится. |
| **Firewall** | Вход: только `22` (ограничить по источнику), `80`, `443`. Исход: к PostgreSQL, S3, Resend (email), Let's Encrypt. | Порт `3000` наружу НЕ открывать (web на loopback). |

---

## 2. Подготовка VM

1. **Доставить образ.** Либо собрать на VM из репозитория:
   ```bash
   docker build -t lk-otsfera:prod .
   ```
   либо `docker pull` из вашего registry (если образ публикуется в CI — вне scope SP3).
2. **Заполнить env.**
   ```bash
   cp .env.production.example .env.production
   # отредактировать .env.production реальными значениями:
   #   APP_DOMAIN + APP_URL (APP_URL = https://<APP_DOMAIN>)
   #   DATABASE_URL / DIRECT_URL (managed PG)
   #   JWT_SECRET ≥32, HEALTH_TOKEN ≥32
   #   S3_* (endpoint/region/keys/bucket/force_path_style)
   #   RESEND_API_KEY / EMAIL_FROM
   # Плейсхолдеры replace_with_* оставлять нельзя: web и worker выполняют
   # fail-fast валидацию окружения на старте (src/lib/env.ts) и не поднимутся.
   ```
   `.env.production` git-ignored (см. `.gitignore`) — реальные секреты не коммитятся.

---

## 3. TLS bring-up

```bash
# 1. DNS обязан резолвиться в IP VM:
dig +short <APP_DOMAIN>            # ожидание: публичный IP этой VM

# 2. Поднять стек (Caddy выпустит сертификат при первом обращении):
docker compose -f docker-compose.prod.yml up -d

# 3. Наблюдать выпуск сертификата:
docker compose -f docker-compose.prod.yml logs -f caddy   # ждём "certificate obtained successfully"

# 4. Проверить HTTPS через домен:
curl -fsS https://<APP_DOMAIN>/api/health/live            # ожидание: 200, валидный TLS
```

**Если `certificate obtained` не появляется:** см. §6 (DNS не распространился / порт 80 закрыт).

---

## 4. Infra-smoke (до данных) — гейт перехода к §5

| Чек | Команда | Ожидание |
|---|---|---|
| TLS валиден | `curl -fsS https://<APP_DOMAIN>/api/health/live` | `200`, цепочка сертификата валидна (нет `curl: (60)`) |
| HTTP→HTTPS | `curl -sI http://<APP_DOMAIN>` | `301`/`308` на `https://` |
| readiness | `curl -fsS -H "Authorization: Bearer <HEALTH_TOKEN>" https://<APP_DOMAIN>/api/health` | DB+Redis+S3 ok |
| worker жив | `docker compose -f docker-compose.prod.yml ps worker` | статус `healthy` (heartbeat-файл свежее 3 мин; логи — без crash-loop) |

Любой ❌ → §6, разбор. Все ✅ → §5.

---

## 5. 🤝 Эстафета → launch-deploy §0.1

Инфра готова. Дальше — данные и фичи по [runbook-launch-deploy.md](runbook-launch-deploy.md). Ниже — **контейнерные формы** первых двух шагов (launch-deploy написан до контейнеров). **Порядок строгий: сначала миграции, потом админ** — `db:create-admin` на чистой БД без применённой схемы падает.

```bash
# миграции (launch-deploy §3.2). С 2026-07 compose делает это САМ: one-shot
# сервис `migrate` выполняется до старта web/worker при каждом `up -d`.
# Ручная форма нужна только вне compose-цикла:
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy

# bootstrap первого админа (launch-deploy §0.1 Step 0) — пароль только через env,
# СТРОГО ПОСЛЕ миграций:
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL=<email> -e ADMIN_PASSWORD=<≥8 символов> \
  web npm run db:create-admin
```

Затем — **строго по launch-deploy**, без дублирования здесь:
- `SHOW_DEMO_LOGINS` НЕ выставлять, demo-seed НЕ запускать (launch-deploy §0.1);
- флип opt-in флагов `FEATURE_ORGANIZATION_CABINET`/`MANAGER_CABINET`/`LEADER_CABINET`/`ENROLLMENT_REQUESTS`(+`CHAT`) — launch-deploy §3.3 (выставить в `.env.production` → `docker compose ... up -d` пересоздаёт web+worker с новым env);
- перевод 1С в live — launch-deploy §4 (отдельным окном, через shadow-репетицию).

---

## 6. Откат / типовые проблемы инфра-уровня

| Симптом | Причина | Действие |
|---|---|---|
| В логах caddy нет `certificate obtained` | DNS не распространился, или порт 80/443 закрыт firewall'ом | `dig +short <APP_DOMAIN>` (должен дать IP VM); проверить входящие правила firewall |
| Let's Encrypt rate-limit (5 сертификатов/неделю на домен) | Потеря тома `caddy_data` при пересоздании контейнера | **Беречь том `caddy_data`** (там сертификаты + ACME-аккаунт). При упоре в лимит — ждать окна; для отладки использовать staging-ACME Let's Encrypt |
| Кириллица в поиске возвращает 0 строк | БД создана без ICU-коллации (§1) | Пересоздать managed-БД с ICU-коллацией |
| Ошибки доступа / 404 при upload/download файлов | `S3_FORCE_PATH_STYLE` / `S3_REGION` не под провайдера (гоча SP1) | Сверить значения с консолью провайдера; для Yandex/VK/Selectel `S3_FORCE_PATH_STYLE=1` |
| Нужно погасить стек | — | `docker compose -f docker-compose.prod.yml down` (именованные тома сохраняются). Фичи/1С откатываются флагами по launch-deploy §5 |

---

## 7. Чек-лист одной страницей (порядок строгий)

- [ ] §1 Провижн: PostgreSQL (🔴 ICU-коллация; **автобэкапы включены и первый создан**) + S3-бакет `documents` (**приватный, versioning + SSE включены**) + VM (Docker+compose) готовы
- [ ] §1 DNS: A-запись `APP_DOMAIN` → IP VM распространилась (`dig +short`)
- [ ] §1 Firewall: вход только `22`/`80`/`443`; порт `3000` закрыт
- [ ] §2 `.env.production` заполнен (`APP_DOMAIN`, `APP_URL` = `https://<APP_DOMAIN>`, секреты ≥32 без плейсхолдеров — иначе fail-fast не даст стартовать, S3-*, DB-*)
- [ ] §2 Cron бэкапа на VM установлен ([runbook-backups.md](runbook-backups.md) §3)
- [ ] §3 `docker compose up -d` → в логах caddy `certificate obtained`
- [ ] §4 Infra-smoke зелёный (TLS / HTTP→HTTPS / readiness DB+Redis+S3 / worker `healthy`)
- [ ] §5 Эстафета: `prisma migrate deploy` → `db:create-admin` (строго в этом порядке) → дальше [launch-deploy](runbook-launch-deploy.md)
