# Алертинг (operability) — design

**Дата:** 2026-05-31
**Автор:** Claude (session-driven, brainstorming)
**Статус:** Approved (design step), pending implementation
**Related:** Трек 1 (production-readiness), подсистема 1В (operability), часть 2. Завершает 1В после health/readiness-пробы (PR #82, часть 1). Идёт после страховочной сетки (PR #81). Переиспользует данные мониторинга (`getSyncLag/getQueueStats/getDlq`), доставку (`notifications.ts`) и паттерн cron-расписаний (`scheduling.ts`).

## Проблема

Мониторинговые данные есть, но **пассивны** — видны, только если человек откроет `admin/health`. Нет проактивного сигнала: если очередь BullMQ забилась, задачи падают в DLQ или синк с 1С отстал — оператор узнаёт об этом, лишь зайдя на страницу. Для production это значит «узнаём об аварии постфактум».

## Цель

Периодически оценивать пороги по уже собираемым метрикам и **проактивно уведомлять операторов** при нарушении — с дедупликацией (не спамить каждый цикл) и уведомлением о восстановлении.

## Не-цели / Out of scope (явно)

- **Новые метрики** — используем только существующие `getQueueStats/getDlq/getSyncLag`. Сбор новых сигналов (latency, CPU) — не здесь.
- **Prometheus/Grafana/трейсинг** — другой класс задачи.
- **Конфиг порогов через UI** — пороги из env; админ-UI для них — возможный follow-up.
- **Per-recipient подписки / правила маршрутизации** — все админы получают все алерты; тонкая настройка — позже.
- **Изменение admin/health** — остаётся как on-demand дашборд.
- **Пейджинг-эскалация** (PagerDuty-стиль ack/escalate) — YAGNI.

## Дизайн

### Архитектура

Новый cron-job **в процессе воркера** (там cron, Redis и Postgres): каждые ~5 мин читает метрики → `evaluate()` применяет пороги → дедуп-диф против персистентного `AlertState` → `deliver()` шлёт только *новые* (FIRE) и *восстановившиеся* (RESOLVE) алерты в три канала. Логика разнесена на маленькие тестируемые модули; оркестратор-процессор их склеивает.

### Компоненты (новые файлы)

- **`src/lib/monitoring/thresholds.ts`** — `getThresholds()`: читает пороги из env с дефолтами (см. ниже). Чистая функция от `process.env`.
- **`src/lib/monitoring/evaluate.ts`** — **чистая функция** `evaluate(metrics, thresholds): Breach[]`, где `metrics = { queues: QueueStatsRow[], syncLag: SyncLagRow[] }` и `Breach = { key: string; severity: 'warning'|'critical'; message: string; value: number }`. Без БД/IO → максимально тестируема. Правила:
  - для каждой очереди: `counts.waiting > ALERT_QUEUE_WAITING_MAX` → `queue_depth:<queue>`; `counts.failed > ALERT_DLQ_MAX` → `dlq:<queue>`;
  - для каждой sync-сущности: `lagMs > ALERT_SYNC_LAG_MAX_HOURS*3600e3` → `sync_lag:<entity>`.
- **`src/lib/monitoring/dedup.ts`** — `diffAlerts(breaches, activeStates, now, cooldownMs): { toFire, toRenotify, toResolve }`. Чистая функция (состояние передаётся аргументом) → тестируема без БД.
- **`src/lib/monitoring/deliver.ts`** — `deliverAlert(prisma, { kind: 'fire'|'resolve', breach|key, message })`: fan-out для каждого `role='admin', isActive` → `createNotification({ type:'ops_alert', ... })` + `triggerNotificationEmail(...)`; плюс `deliverTelegram(text)`. **Каждый канал в своём try/catch** (§3 graceful degradation): падение одного канала логируется и не мешает остальным.
- **`src/worker/processors/evaluate-alerts.ts`** — оркестратор: `getQueueStats()` + `getSyncLag(prisma)` → `evaluate()` → читает `AlertState(status='firing')` → `diffAlerts()` → `deliver()` для FIRE/RESOLVE (+повтор по cooldown) → upsert/update `AlertState`.

### Дедупликация (edge-trigger + cooldown)

Стабильный `key` на условие: `queue_depth:oneCSync.pullOrders`, `dlq:docs.scanDocument`, `sync_lag:order`. Прогон сравнивает текущие breaches с активными `AlertState`:

- breach есть, состояния нет или `resolved` → **FIRE** (🔴): доставка + upsert `AlertState{status:'firing', firstSeenAt:now, lastNotifiedAt:now}`.
- breach есть, `firing`, `now - lastNotifiedAt > cooldown` → **повтор-напоминание**: доставка + `lastNotifiedAt=now`.
- breach есть, `firing`, в пределах cooldown → **молчим**.
- breach пропал, `AlertState` ещё `firing` → **RESOLVE** (✅): доставка + `status='resolved', resolvedAt:now`.

### Prisma-модель `AlertState`

```prisma
model AlertState {
  key            String    @id           // "queue_depth:oneCSync.pullOrders"
  status         String                  // "firing" | "resolved"
  severity       String                  // "warning" | "critical"
  message        String
  value          Int?                    // observed (waiting count / lagMs / failed count)
  firstSeenAt    DateTime  @default(now())
  lastNotifiedAt DateTime  @default(now())
  resolvedAt     DateTime?
  updatedAt      DateTime  @updatedAt

  @@index([status])
}
```

Состояние в Postgres (не Redis): durable, queryable, и позволяет позже показать «активные алерты» в админке. Новая миграция (§CLAUDE.md: применённые миграции не редактируем).

### Пороги (env, дефолты)

| env | дефолт | смысл |
|---|---|---|
| `ALERT_QUEUE_WAITING_MAX` | 100 | ожидающих задач в очереди |
| `ALERT_DLQ_MAX` | 0 | упавших задач (job в `failed` лишь исчерпав 5 ретраев → любой = реальная проблема; не «восстановится», пока DLQ не очистят — это цель) |
| `ALERT_SYNC_LAG_MAX_HOURS` | 24 | лаг синка (24ч = «красный» admin/health; щедро, т.к. orgs синкаются раз в 6ч — против ложных) |
| `ALERT_RENOTIFY_COOLDOWN_HOURS` | 6 | период повтора, пока breach длится |

### Каналы / конфиг

- **In-app + email** — всем `role='admin', isActive`. In-app тип `ops_alert` (новый строковый тип; админ-фид может потребовать лейбл — мелкий follow-up). Email через `triggerNotificationEmail` (сам no-op при `EMAIL_ENABLED!=true`).
- **Telegram** — `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`; `POST https://api.telegram.org/bot<token>/sendMessage` с `{ chat_id, text }`, обёрнут в таймаут (как health-чеки — внешний HTTP не должен висеть). Не заданы → канал тихо пропускается.
- **Расписание** — `ALERT_SCHEDULES` рядом с `SYNC_SCHEDULES` в `scheduling.ts`; очередь `monitoring.evaluateAlerts` (добавить в `QUEUE_NAMES`); регистрируется в `worker/index.ts` за существующим `ENABLE_SYNC_CRON`; паттерн `*/5 * * * *`.

### Раскладка файлов

```
prisma/schema.prisma                          (edit — +AlertState) + новая миграция
src/lib/monitoring/thresholds.ts              (new)
src/lib/monitoring/evaluate.ts                (new — чистая)
src/lib/monitoring/dedup.ts                   (new — чистая)
src/lib/monitoring/deliver.ts                 (new — fan-out + telegram)
src/worker/processors/evaluate-alerts.ts      (new — оркестратор)
src/lib/jobs/queues.ts                        (edit — +'monitoring.evaluateAlerts')
src/lib/jobs/scheduling.ts                    (edit — +ALERT_SCHEDULES + registerAlertSchedules)
src/worker/index.ts                           (edit — register processor + schedule)
.env.example                                  (edit — +пороги + Telegram env)
```

### Rollout

1. Ветка от `main`: `claude/alerting` (создана).
2. Prisma: `AlertState` + `prisma migrate dev` (новая миграция) + `prisma generate`.
3. `thresholds.ts` + unit.
4. `evaluate.ts` + unit (чистые: норма/превышение по каждому типу).
5. `dedup.ts` + unit (FIRE/повтор/молчим/RESOLVE).
6. `deliver.ts` + unit (моки delivery + fetch; per-channel try/catch).
7. Очередь + расписание (`queues.ts`, `scheduling.ts`) + unit на `registerAlertSchedules`.
8. Процессор-оркестратор + integration-тест (живой Postgres для `AlertState`).
9. `worker/index.ts` wiring; `.env.example`.
10. `typecheck`/`lint`/`test:unit` зелёные; integration через L3/гейт; PR со ссылкой на спеку.

## Tests

- **`evaluate.ts`** (unit): каждый тип порога — норма не даёт breach, превышение даёт breach с верным `key/severity/value`; пустые метрики → пусто.
- **`dedup.ts`** (unit): breach без состояния → `toFire`; `firing` в пределах cooldown → ничего; `firing` за пределами → `toRenotify`; исчез breach → `toResolve`.
- **`thresholds.ts`** (unit): дефолты; переопределение env; нечисловой env → дефолт.
- **`deliver.ts`** (unit): моки `createNotification`/`triggerNotificationEmail`/`fetch`; шлёт всем админам; **Telegram бросает → in-app/email всё равно доставлены** (per-channel изоляция); Telegram env не задан → fetch не вызывается.
- **`registerAlertSchedules`** (unit): `upsertJobScheduler` вызван с верными id/pattern (мок очереди, как существующие jobs.scheduling-тесты).
- **процессор** (integration, живой Postgres): на засеянных метриках (через провайдер-стабы для очередей + реальный `AlertState`) — первый прогон FIRE создаёт `AlertState`; повторный в пределах cooldown молчит; снятие breach → RESOLVE.

## Принятые решения (по делегированию пользователя)

1. **Три канала:** in-app + email + Telegram.
2. **Telegram** (не generic/Slack): bot-token + chat-id.
3. **Дедуп = edge-trigger + cooldown** (дефолт 6ч), с уведомлением о восстановлении.
4. **Состояние в Postgres** (`AlertState`), не Redis.
5. **Пороги из env** с дефолтами выше; `DLQ_MAX=0`, `SYNC_LAG=24ч`, `QUEUE_WAITING=100`.
6. **Тип `ops_alert`**; гейт `ENABLE_SYNC_CRON`; период 5 мин.
7. **Логика разнесена** на `thresholds/evaluate/dedup/deliver` (чистые ядра) + тонкий процессор.

## Риск

Низкий–средний.

- **Спам алертами** — главный риск; закрыт edge-trigger + cooldown + RESOLVE. Покрыт unit-тестами дедупа.
- **Внешний Telegram висит/падает** — обёрнут в таймаут + per-channel try/catch; не блокирует in-app/email и не валит cron-job.
- **DLQ-порог не «восстанавливается»** (failed накапливается при `removeOnFail:false`) — это **намеренно**: алерт держится `firing`, пока DLQ не разгребут; RESOLVE при падении ниже порога.
- **Ложные алерты по лагу** при разной каденции синка — митигировано щедрым дефолтом 24ч; при необходимости — per-entity пороги (follow-up).
- **Шум в админ-фиде** от нового типа `ops_alert` — возможен отсутствующий лейбл; мелкий UI follow-up, не блокер.
