# RUNBOOK — единая точка входа дежурного при инциденте

**Scope**: быстрая диагностика, типовые инциденты, откаты, восстановление. Это
сводный документ: короткая процедура здесь, детали — по ссылкам (§5). Прод —
топология C: одна VM с `docker compose -f docker-compose.prod.yml`
(web + worker + Redis + Caddy), PostgreSQL и S3 — внешние managed
([runbook-prod-infra-rf.md](runbook-prod-infra-rf.md) §0).

---

## 1. Быстрая диагностика

1. **Liveness** (без токена, публичный):
   ```bash
   curl -fsS https://<APP_DOMAIN>/api/health/live      # 200 = процесс web жив
   ```
2. **Readiness** (нужен `HEALTH_TOKEN` из `.env.production`):
   ```bash
   curl -fsS -H "Authorization: Bearer <HEALTH_TOKEN>" https://<APP_DOMAIN>/api/health
   ```
   Ответ `{status, checks: {db, redis, s3}}` ([код](../src/app/api/health/route.ts)):
   - `db.ok=false` — недоступен managed-PostgreSQL (`DATABASE_URL`);
   - `redis.ok=false` — лежит контейнер `redis` (очереди, см. §2.6);
   - `s3.ok=false` — недоступно S3-хранилище (`S3_*` env);
   - `503 health_token_unconfigured` — не задан `HEALTH_TOKEN` (fail-closed, это не «всё упало»).
3. **Состояние контейнеров и логи** (на VM):
   ```bash
   docker compose -f docker-compose.prod.yml ps        # worker healthy = heartbeat-файл свежее 3 мин
   docker compose -f docker-compose.prod.yml logs --tail=100 web worker
   ```
4. **Админ-панели** (роль admin). Адреса изменились (ТЗ 2026-08-04): всё
   редконастраиваемое собрано в хабе `/admin/settings`; старые адреса
   (`/admin/health`, `/admin/sync`, `/admin/audit`, …) продолжают работать —
   переадресуют на новые, пока включён флаг `settings_hub`.

   **Импорт из 1С (Т-29 ТЗ починки импорта).** Страницы
   `/admin/settings/integrations/1c/{excel,payments}` и зеркала руководителя
   `/leader/settings/integrations/1c/{excel,payments}` доступны при дефолтных
   флагах: `FEATURE_SETTINGS_HUB` **не выставлять** в `0/false/off` (флаг
   opt-out — включён по умолчанию; выключенным он лишь отключает редиректы со
   старых адресов, сами страницы хаба отвечают всегда), собственного флага у
   раздела «Обмен с 1С» нет. Кабинету руководителя нужны включённые
   `FEATURE_MANAGER_CABINET` (+`FEATURE_LEADER_CABINET` только вместе с ним).
   Право импорта — только admin и руководитель (Т-25); обычный менеджер
   получает `/forbidden`, это не сбой.
   - **`/admin/settings/system/health`** — DB/Redis/worker, глубина всех очередей BullMQ, таблица DLQ
     (упавшие задачи, кнопки retry / retry-all), активные алерты, ошибки синка.
     Отдельных страниц `/admin/queues` и `/admin/dlq` **нет** — всё здесь;
     API — `/api/admin/dlq` (+ `/[queue]/[jobId]/retry`, `/[queue]/retry-all`).
   - **`/admin/settings/integrations/sync`** — центр управления 1С-синком: cursor-lag, пауза/запуск расписаний,
     ручной триггер, dead-letter записи 1С (возврат в очередь).
5. **Куда приходят алерты.** Воркер каждые 5 минут (`monitoring.evaluateAlerts`,
   cron `*/5 * * * *`) сверяет метрики с порогами
   ([thresholds.ts](../src/lib/monitoring/thresholds.ts), [evaluate.ts](../src/lib/monitoring/evaluate.ts)):

   | Сигнал | Порог (env, дефолт) | Severity |
   |---|---|---|
   | Очередь: waiting | `ALERT_QUEUE_WAITING_MAX` (100) | warning |
   | Очередь: failed (DLQ) | `ALERT_DLQ_MAX` (0) | critical |
   | Лаг 1С-синка | `ALERT_SYNC_LAG_MAX_HOURS` (24 ч) | critical |
   | 1С dead-letter записи | `ALERT_ONEC_DEADLETTER_MAX` (0) | critical |

   Доставка ([deliver.ts](../src/lib/monitoring/deliver.ts)): in-app всем активным admin +
   email (через Resend) + Telegram-чат — **только если** выставлены
   `ALERT_TELEGRAM_BOT_TOKEN` и `ALERT_TELEGRAM_CHAT_ID`, иначе канал молча
   пропускается (**не настроено по умолчанию**). Повтор алерта —
   `ALERT_RENOTIFY_COOLDOWN_HOURS` (6 ч).

   ⚠️ Алерты вычисляет **сам воркер**: если упал воркер — алертов не будет.
   Внешнего мониторинга нет (**не настроено**); лежащий воркер видно только по
   `docker compose ps` (healthcheck heartbeat) и по `/admin/settings/system/health`.

---

## 2. Типовые инциденты

### 2.1 DLQ растёт / очередь копится

**Симптом**: алерт `dlq:<queue>` / `queue_depth:<queue>`; на `/admin/settings/system/health` растут failed/waiting.

1. `/admin/settings/system/health` → таблица DLQ: смотреть `failedReason` свежих задач (общая причина видна сразу).
2. Упавшие задачи **не удаляются** (`removeOnFail:false` — намеренно, для расследования; CLAUDE.md §7). Ретраи: 5 попыток с экспоненциальным backoff — в DLQ попадает то, что упало 5 раз.
3. Устранить причину (ClamAV — §2.4, 1С — §2.3, внешний сервис) → на `/admin/settings/system/health` кнопка **retry** по задаче или **retry-all** по очереди (bulk до 500 задач за вызов).
4. `waiting` копится при живой причине = воркер не разбирает → §2.2.
5. Известный источник DLQ-шума — включённые заглушки-адаптеры (`inbound_messaging` с `INBOUND_EMAIL_ADAPTER≠fake`, `telephony_mango` без боевого адаптера) — см. [feature-flags-matrix.md](feature-flags-matrix.md).

### 2.2 Воркер упал или завис

**Симптом**: `docker compose ps worker` → `unhealthy` (heartbeat старше 3 мин) или контейнер в рестарт-цикле; очереди копятся; алертов нет (§1 п.5).

1. ```bash
   docker compose -f docker-compose.prod.yml logs --tail=200 worker
   ```
2. Перезапуск:
   ```bash
   docker compose -f docker-compose.prod.yml restart worker
   ```
   (после правки `.env.production` — `up -d`, пересоздаёт контейнер с новым env).
3. Проверить: `ps` → worker `healthy`; `/admin/settings/system/health` — waiting уходит вниз.
4. Джобы не теряются: очереди в Redis (AOF-том `redisdata`), после старта воркер разбирает накопленное; cron-расписания (`registerSyncSchedules` и др.) он перерегистрирует сам.

### 2.3 1С-синк молчит

**Симптом**: алерт `sync_lag:<entity>`; в `/admin/settings/integrations/sync` cursor-lag растёт.

1. `/admin/settings/integrations/sync`: не поставлено ли расписание на паузу; свежие ошибки синка; dead-letter записи (`OneCPendingRecord` со статусом `dead` — алерт `onec_dead_letters`).
2. Проверить адаптер: env `ONE_C_ADAPTER` (`fake` = живых записей нет вообще, `rest` = боевой; требует `ONE_C_API_URL`+`ONE_C_API_TOKEN`) и `ONE_C_MODE` (**дефолт `live`**; `shadow` = читает, но не пишет — [config.ts](../src/lib/services/oneCSync/config.ts)). Эффективное значение адаптера может быть переопределено в БД через `/admin/settings/integrations` ([integrationSettings.ts](../src/lib/config/integrationSettings.ts), ключ `onec.adapter`).
3. Ручной прогон: `/admin/settings/integrations/sync` → «Запустить» нужную сущность; наблюдать cursor и журнал.
4. Воркер жив? (§2.2 — расписания исполняет он: pull каждые 15 мин/1 ч/6 ч, reconcile в 03:00 МСК — [scheduling.ts](../src/lib/jobs/scheduling.ts)).
5. Dead-letter записи после устранения причины возвращаются в очередь со страницы `/admin/settings/integrations/sync`.
6. Откат при аварии на стороне 1С: `ONE_C_ADAPTER=fake` (или `ONE_C_MODE=shadow`) → `up -d`. Запись идемпотентна, данные не портятся ([runbook-launch-deploy.md](runbook-launch-deploy.md) §4).

### 2.4 ClamAV недоступен

**Симптом**: DLQ по очереди `docs.scanDocument` с `ClamAV unreachable`; документы висят в `scanStatus=pending`.

Что происходит ([scan-document.ts](../src/worker/processors/scan-document.ts)): при недоступном сканере файл **намеренно НЕ помечается clean** — job ретраится (5×), затем ложится в DLQ, строка остаётся `pending`. Раз в час воркер запускает backfill-свип ([backfill.ts](../src/lib/services/scan/backfill.ts)): пере-энкьюит все `pending` строки — после восстановления ClamAV всё досканируется **само**, максимум через час.

1. Поднять ClamAV (адрес — `CLAMAV_HOST`/`CLAMAV_PORT`; если `CLAMAV_HOST` не задан вовсе — файлы помечаются clean by default с warn в SyncLog, это режим «окружение без сканера»).
2. Не ждать час — на `/admin/settings/system/health` retry-all по `docs.scanDocument`.
3. Проверить: количество `pending` падает, DLQ пуст. Помнить: `pending`-файлы остаются скачиваемыми; `infected` отдают 410 (CLAUDE.md §10).

### 2.5 Письма не уходят

**Симптом**: пользователи не получают email; в логах `[email] отправка включена, но не задан ключ Resend` или молчание.

1. Отправка гейтится в [send.tsx](../src/lib/email/send.tsx): `skipped/disabled` — выключен `email.enabled`; `skipped/no-api-key` — нет `RESEND_API_KEY`; `skipped/no-recipient` — у получателя нет email.
2. Эффективные значения: `/admin/settings/integrations` (настройки в БД перекрывают env `EMAIL_ENABLED`/`RESEND_API_KEY`/`EMAIL_FROM`) — проверить и прогнать тестовую отправку там же.
3. Если правился env — `docker compose -f docker-compose.prod.yml up -d` (web **и** worker).
4. При включённом `notif_queue` email уходит через очередь `notifications.dispatch` — проверить её DLQ на `/admin/settings/system/health`; сбой enqueue деградирует в inline-доставку сам ([dispatch.ts](../src/lib/notifications/channels/dispatch.ts)).
5. Дальше — статус Resend и валидность домена `EMAIL_FROM` (сторона провайдера).

### 2.6 Redis лежит

**Симптом**: `/api/health` → `redis.ok=false`; `docker compose ps redis` нездоров.

**Что деградирует**: все очереди BullMQ (1С-синк, скан, PDF/XLSX комиссий, `notifications.dispatch` при `notif_queue`, алерты), rate-limit логина, readiness → 503.
**Что работает**: web-UI и вся работа с БД/S3 — сбои enqueue логируются и проглатываются, основной путь не блокируется (CLAUDE.md §3); доставка уведомлений падает обратно в inline.

1. ```bash
   docker compose -f docker-compose.prod.yml restart redis
   docker compose -f docker-compose.prod.yml ps      # redis healthy, web/worker живы
   ```
2. Данные очередей — в томе `redisdata` (AOF). Том потерян? Принятый риск: не бэкапится, reconcile 1С догонит, уведомления перегенерятся ([runbook-backups.md](runbook-backups.md) §1).
3. После восстановления сверить `/admin/settings/system/health` (воркер разобрал накопленное) и при необходимости ручной триггер синка (§2.3).

### 2.7 Инцидент с ПДн

1. Картина доступа сотрудников к ПДн — журнал `/admin/settings/security/personal-data` (модель `PiiAccessEvent`, запись — [recordPiiAccess](../src/lib/pii/record.ts)).
2. Флаг `pii_access_log` (opt-out, включён по умолчанию) — **аварийный рычаг**: `FEATURE_PII_ACCESS_LOG=0` → `up -d` останавливает запись журнала (no-op) и вешает баннер на `/admin/settings/security/personal-data`. Выключать **только на время инцидента** — выключенный флаг = пауза комплаенс-журнала ([feature-flags-matrix.md](feature-flags-matrix.md)). Не выпиливать.
3. После инцидента вернуть флаг (убрать env / `=1`) → `up -d`, убедиться, что баннер пропал.

---

## 3. Откат

### 3.1 Откат релиза (код)

Образ один — `lk-otsfera:prod`, **по SHA/версиям не тегируется** (не настроено; рекомендация из [runbook-launch-deploy.md](runbook-launch-deploy.md) §5 — начать тегировать). Registry в CI тоже нет — откат = пересборка из git на VM:

```bash
git log --oneline -10                       # найти прошлый рабочий tag/SHA
git checkout <прошлый tag/SHA>
docker build -t lk-otsfera:prod .
docker compose -f docker-compose.prod.yml up -d
curl -fsS https://<APP_DOMAIN>/api/health/live
```

⚠️ `up -d` прогонит one-shot сервис `migrate` (`prisma migrate deploy`) — для старого кода это no-op, если новых миграций тот релиз не приносил; если приносил — см. §3.2.

### 3.2 Откат миграции Prisma

**Честно: Prisma не умеет down-миграции.** Миграции проекта аддитивны и при выключенных флагах безвредны — в типовом релизе откатывать схему **не нужно** ([runbook-launch-deploy.md](runbook-launch-deploy.md) §5). Если всё же нужно (деструктивная миграция / миграция упала посередине):

1. Точка отката — снапшот/дамп, снятый **до** `migrate deploy` (обязательный шаг launch-deploy §3.2).
2. Восстановить БД из бэкапа — §4.
3. Если миграция числится failed в `_prisma_migrations`, пометить её откаченной:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm web \
     npx prisma migrate resolve --rolled-back <имя_миграции>
   docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate status
   ```
4. Дальше — либо откат кода на релиз без этой миграции (§3.1), либо исправленная миграция вперёд.

### 3.3 Откат фиче-флага

```bash
# 1. В .env.production: FEATURE_<UPPER_SNAKE>=0 (или убрать строку для opt-in)
# 2. docker compose -f docker-compose.prod.yml up -d   # пересоздаёт web И worker
# 3. Проверить: префикс фичи отдаёт 404; /api/health green
```

Флип требует рестарта **обоих** процессов (env фиксируется на старте). Семантика и зависимости каждого флага — [feature-flags-matrix.md](feature-flags-matrix.md); триггеры и процедура отката кабинетов — [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md) §5. Миграции при откате флага не трогать.

---

## 4. Восстановление из бэкапа (сжатая версия)

Полная матрица «что бэкапится», RPO/RTO и принятые риски — [runbook-backups.md](runbook-backups.md).

**PostgreSQL, основной путь** (автобэкапы managed-провайдера, RTO ≤ 2 ч):

1. В консоли провайдера: restore бэкапа/PITR в **новую** managed-БД.
2. Проверить восстановленную БД **до** переключения:
   ```bash
   ./scripts/backup/restore-check.sh <дамп>   # для логического дампа; смоук: _prisma_migrations без failed, ключевые таблицы непусты, счётчики Order/Payment
   ```
   (для provider-restore — тот же смоук руками: `migrate status`, счётчики строк против прод-чисел).
3. Переключить `DATABASE_URL`/`DIRECT_URL` в `.env.production` → `docker compose -f docker-compose.prod.yml up -d`.
4. `curl /api/health` (Bearer) — db ok; выборочно проверить свежие данные глазами.

**PostgreSQL, запасной путь** — логический дамп с VM (`scripts/backup/pg-dump.sh`, cron daily 02:30, ротация 14 дней + недельная копия во второй бакет): восстановить `pg_restore`-ом в новую БД, дальше шаги 2–4.

**S3 `documents`**: удалённый/перезаписанный объект — откат версии (versioning на бакете, минуты); потеря бакета — `rclone`-копия из второго бакета (часы; настройка remote — вне репозитория, см. комментарий в `pg-dump.sh`).

Результат каждой проверки восстановления фиксируется в журнале владельца; плановая проверка — ежеквартально ([runbook-backups.md](runbook-backups.md) §4).

---

## 5. Ссылки — когда какой документ открывать

| Документ | Когда открывать |
|---|---|
| [runbook-backups.md](runbook-backups.md) | Восстановление БД/файлов, регламент бэкапов, RPO/RTO, restore-check |
| [runbook-prod-infra-rf.md](runbook-prod-infra-rf.md) | Прод с нуля: провижн VM/PG/S3, TLS/Caddy, infra-smoke; проблемы уровня DNS/сертификатов |
| [runbook-launch-deploy.md](runbook-launch-deploy.md) | Боевой деплой релиза: миграции, dedupe-гейт, флип флагов, перевод 1С в live, откат релиза |
| [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md) | Включение/откат кабинетов org/manager, smoke-чеклисты, наблюдение после флипа |
| [runbook-test-stand.md](runbook-test-stand.md) | Демо-стенд lk.ptsfera.online: автообновление, «сайт не открывается» (это НЕ прод) |
| [feature-flags-matrix.md](feature-flags-matrix.md) | Реестр всех флагов: семантика, зависимости, аварийные рычаги |
| [CI.md](CI.md) | Конвейер CI, branch protection, Renovate, процессы PR |
| [INVARIANTS.md](INVARIANTS.md) | Доменные инварианты (что нельзя сломать при фиксах) |
| [qa-staging-smoke-organization.md](qa-staging-smoke-organization.md) · [qa-staging-smoke-manager.md](qa-staging-smoke-manager.md) | Ручной смоук кабинетов после деплоя/отката |

## 6. Sentry (когда решите подключить)

Код готов: server/edge/worker-инициализация есть, события чистятся
`scrubSentryEvent` (`sendDefaultPii: false`); без `SENTRY_DSN` всё — no-op.

1. Завести проект в Sentry, выставить `SENTRY_DSN` в `.env.production`
   (web и worker) → `docker compose up -d`. События пойдут сразу.
2. **Source maps** (читабельные стеки клиентских ошибок) — отдельный шаг,
   сейчас намеренно не настроен (нет DSN — некуда грузить): обернуть
   `next.config.mjs` в `withSentryConfig(...)` из `@sentry/nextjs` и задать
   на сборке `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
   (в CI — секретами GitHub). Без этих переменных плагин не грузит карты.
