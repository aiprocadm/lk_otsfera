# Admin 1С Sync Control Center (v1) — design

**Дата:** 2026-06-07
**Статус:** draft (утверждён в brainstorming 2026-06-07, ждёт вычитки спеки)
**Автор:** brainstorming-сессия «всё ли реализовано у admin для организации работы проекта»
**Связанные:** [admin-cabinet 6.3-6.7 DONE](../plans/2026-05-29-admin-cabinet-6.3-6.7-DONE.md), [1C Phase 3b readiness](../plans/2026-06-01-1c-phase3b-readiness-2026-06-01.md), CLAUDE.md §2/§3/§4/§6/§7/§9

---

## 0. Журнал решений (из brainstorming)

Сессия искала пробелы в admin-кабинете «для организации работы всего проекта». Зафиксированные развилки:

1. **Срез фокуса** → *операционные рычаги* (управление рантаймом), а не полнота CRUD / кросс-ролевой надзор. Причина: CRUD-полнота админки уже зрелая (users/partners/orgs/managers/commissions/audit), а настоящие пробелы — там, где оператор может **наблюдать, но не действовать**.
2. **Подсистема первого spec** → *A — 1С Sync Control Center*. Причины: выровнено с единственной оставшейся вехой роадмапа (Track A — боевой 1С), технически самое готовое (тонкий пульт над уже работающими очередями/процессорами/`SyncState`).
3. **Объём v1** → *полный пульт + перемотка курсора* (все 4 рычага, включая footgun-перемотку под guardrails).
4. **Архитектурный подход** → *Подход 1* (service + server-actions + персистентный флаг паузы + расширение `/admin/sync`).

Остальные операционные подсистемы (**B** — страница алертов, **C** — управление Company, **D** — runtime feature-flag тумблеры) — отдельные spec-циклы; **D** дополнительно требует явного отступления от CLAUDE.md §5 (флаги env-only).

---

## 1. Цель

`/admin/sync` сегодня — **только наблюдение** ([page.tsx](../../src/app/admin/sync/page.tsx) рендерит read-only таблицу из `getSyncSummary`). Цель v1 — дать оператору-админу **рычаги управления** уже работающей 1С-синхронизацией:

1. **Ручной запуск** синка по сущности.
2. **Bulk-retry** всех failed-джобов очереди (DLQ).
3. **Пауза/резюм** расписания (крона) — переживающая рестарт воркера.
4. **Перемотка/сброс курсора** `SyncState.cursor`.

Готовность — к дню боевого ввода 1С (Track A). Работает и на `ONE_C_ADAPTER=fake` (сейчас, для проверки пульта), и на `real` (потом). Пульт должен быть готов **до** cutover, а не строиться в момент пожара.

### Контекст процессов (почему это дёшево)

- Web и worker — разные процессы, но web уже умеет дёргать очереди в Redis: существующий роут [/api/admin/dlq/[queue]/[jobId]/retry](../../src/app/api/admin/dlq/[queue]/[jobId]/retry/route.ts) делает `getQueue → job.retry()`. Значит запуск/retry/курсор — операции из web-процесса, **без нового worker-side IPC**.
- Воркеры слушают очереди всегда; `registerSyncSchedules` (крон) гейтится `ENABLE_SYNC_CRON=1` ([worker/index.ts:67](../../src/worker/index.ts)). **Ручной запуск работает даже при выключенном кроне** (hot standby).
- Один `Worker` на очередь → `job.name` не влияет на диспатч (процессор выбирается очередью).
- `reason: 'manual'` **уже** в типе `SyncJobPayload` ([types.ts:5](../../src/lib/jobs/types.ts)) — правка типов не нужна.
- `SyncState.cursor` — это **ISO-таймстамп-watermark** (`lagMs = now − Date.parse(cursor)`, [syncHealth.ts:29](../../src/lib/services/admin/syncHealth.ts)). Перемотка = выбор даты/времени; сброс = `null`.

---

## 2. Архитектура (Подход 1)

Направление зависимостей по CLAUDE.md §2: `app → server-actions → services → lib/jobs`.

```
src/app/admin/sync/page.tsx              (edit — read-only → control center)
src/app/admin/health/page.tsx            (edit — +bulk-retry рядом с DLQ-таблицей)
src/components/admin/sync-*.tsx          (new — клиентские обёртки кнопок/диалогов)
src/server-actions/admin/syncControl.ts  (new — тонкие server-actions: trigger/pause/cursor)
src/app/api/admin/dlq/[queue]/retry-all/route.ts  (new — bulk-retry, sibling per-job; guard-style)
src/lib/services/admin/syncControl.ts    (new — логика, Result-тип, injectable provider)
src/lib/services/admin/queueStats.ts     (edit — +retryAllDlq)
src/lib/auth/audit.ts                    (edit — +AuditEntity: 'sync_state'|'sync_schedule'|'job_queue')
src/lib/jobs/scheduling.ts               (edit — registerSyncSchedules принимает pausedSchedulerIds)
src/worker/index.ts                      (edit — читает SyncSchedulePause, прокидывает set)
prisma/schema.prisma                     (edit — +model SyncSchedulePause)
prisma/migrations/<ts>_sync_schedule_pause/  (new)
```

### Карта сущностей (в `syncControl.ts`)

`SYNC_ENTITIES`: статическая карта `entity → { queueName, schedulerId, hasCursor }`.

| entity | queueName | schedulerId | курсор |
|---|---|---|---|
| `organization` | `oneCSync.pullOrganizations` | `oneCSync.pullOrganizations.cron` | да |
| `order` | `oneCSync.pullOrders` | `oneCSync.pullOrders.cron` | да |
| `payment` | `oneCSync.pullPayments` | `oneCSync.pullPayments.cron` | да |
| `document` | `oneCSync.pullDocuments` | `oneCSync.pullDocuments.cron` | да |
| `reconcile`* | `oneCSync.reconcile` | `oneCSync.reconcile.cron` | нет |

\* `reconcile` — расписание без сущности/курсора: можно запускать вручную и паузить, перемотки курсора нет. `pushLead` — событийная очередь (не по крону), в пульт **не входит**.

### Расширение injection-seam

Текущий `QueueProvider` ([queueStats.ts:31](../../src/lib/services/admin/queueStats.ts)) — `Pick<Queue, 'getJobCounts'|'getFailed'|'getJob'>`. Расширяем до:

```ts
type SyncControlQueueProvider = (name: QueueName) => Pick<Queue,
  'getJobCounts' | 'getFailed' | 'getJob' | 'add' | 'upsertJobScheduler' | 'removeJobScheduler'>;
```

Дефолт — `getQueue`; в тестах — стаб (паттерн `vi.hoisted`, §6). Так весь сервис юнит-тестируется без живого Redis.

---

## 3. Четыре рычага

Все функции сервиса возвращают стабильный Result-тип (§3): `{ ok: true; ...data } | { ok: false; error: <stable code> }`. Все мутации пишут audit через `recordAudit` ([audit.ts](../../src/lib/auth/audit.ts)).

**Расширение `AuditEntity` union** ([audit.ts:3](../../src/lib/auth/audit.ts)): добавить `'sync_state'` (запуск + курсор), `'sync_schedule'` (пауза/резюм), `'job_queue'` (bulk-retry). `entity` строго типизирован — без этого typecheck упадёт; прецедент — расширение union в Phase 6. `action` — свободная строка, новых типов не требует.

### 3.1 Ручной запуск — `triggerSync(provider, prisma, actorUserId, entity)`

- Резолвит `queueName` по `SYNC_ENTITIES[entity]`.
- Перед enqueue читает `getJobCounts('active','waiting')`. Если `active > 0` → **не дублируем**, `error: 'already_running'` (джоб уже выполняется; оператор ждёт). `waiting > 0` без active — допускаем (BullMQ сериализует).
- `queue.add('manual', { triggeredAt: new Date().toISOString(), reason: 'manual' }, { jobId })`. `jobId` = `manual:<entity>:<unix-ms>` (уникальность одного клика).
- Audit: `action: 'sync_triggered'`, `entity: 'sync_state'`, `entityId: <entity>`.
- **Result:** `{ ok: true; jobId }` | `error: 'already_running' | 'queue_unavailable' | 'unknown_entity'`.
- Работает в hot-standby (крон off) — джоб подхватит слушающий воркер.

### 3.2 Bulk-retry DLQ — `retryAllDlq(provider, queue)` (логика в `queueStats.ts`, поверхность — API-роут)

- Поверхность: `POST /api/admin/dlq/[queue]/retry-all` — **sibling существующего per-job** [retry-роута](../../src/app/api/admin/dlq/[queue]/[jobId]/retry/route.ts), guard-style auth (см. §6). Не server-action: DLQ-таблица на `/admin/health` уже клиентская и дёргает per-job роут fetch'ем.
- Итерирует `getFailed(0, CAP-1)`, на каждом `job.retry()`; `CAP = 500` (защита от runaway; если failed > CAP — ретраим первые CAP, остаток логируем, возвращаем флаг `truncated`).
- Частичные провалы retry собираются в счётчик `failed` (не роняют операцию).
- Audit (в роуте): `action: 'sync_dlq_bulk_retried'`, `entity: 'job_queue'`, `entityId: <queue>`, `after: { retried, failed, truncated }` (существующий per-job retry audit **не** пишет — для bulk вводим осознанно, операция массовая).
- **Result:** `{ ok: true; retried; failed; truncated }` | `error: 'queue_unavailable' | 'unknown_queue'`.

### 3.3 Пауза/резюм расписания — `setSchedulePaused(provider, prisma, actorUserId, schedulerId, paused)`

- **Пауза:** `prisma.syncSchedulePause.upsert({ schedulerId, pausedBy })` **+** `queue.removeJobScheduler(schedulerId)` (крон встаёт сразу, не ждёт рестарта).
- **Резюм:** `prisma.syncSchedulePause.delete` **+** `queue.upsertJobScheduler(...)` из `SYNC_SCHEDULES`-константы (повторная регистрация).
- Порядок: сначала запись в БД (источник правды), затем Redis-операция; провал Redis-шага → Result `queue_unavailable`, но флаг в БД уже отражает намерение (воркер на старте его уважит). Это допустимо: БД — источник правды, Redis догонит при следующей регистрации.
- Audit: `action: 'sync_schedule_paused' | 'sync_schedule_resumed'`, `entity: 'sync_schedule'`, `entityId: <schedulerId>`.
- **Result:** `{ ok: true; paused }` | `error: 'queue_unavailable' | 'unknown_schedule'`.

### 3.4 Перемотка/сброс курсора — `rewindCursor(prisma, actorUserId, entity, cursorIso | null)` — footgun

- Пишет `SyncState.cursor` (Postgres; **не зависит от Redis**).
- Валидация: `entity` известна и `hasCursor`; `cursorIso` парсится как дата и **не в будущем** (иначе `invalid_cursor`); `null` = полный re-pull с начала.
- **Обязательный** audit (`action: 'cursor_rewound'`, `entity: 'sync_state'`, `entityId: <entity>`) с `before` (текущий курсор) и `after` (новый) — для расследования последствий re-pull.
- **Result:** `{ ok: true; entity; cursor }` | `error: 'unknown_entity' | 'invalid_cursor' | 'storage'`.
- Семантика для оператора: «перемотка на 01.06 = повторный pull всех изменений 1С с этого момента» (идемпотентность pull-процессоров — ответственность 1С-адаптера, см. 1C Phase 3b).

---

## 4. Модель данных / миграция

Одна таблица. Presence-of-row = paused (без tri-state булева).

```prisma
model SyncSchedulePause {
  schedulerId String   @id
  pausedAt    DateTime @default(now())
  pausedBy    String   // userId, для аудита «кто поставил на паузу»
}
```

Миграция non-breaking (новая таблица). Имя: `<ts>_sync_schedule_pause`. После — `npm run prisma:generate`.

---

## 5. Worker-side

В блоке `ENABLE_SYNC_CRON === '1'` ([worker/index.ts:67](../../src/worker/index.ts)):

```ts
const pausedIds = new Set((await prisma.syncSchedulePause.findMany({ select: { schedulerId: true } })).map(r => r.schedulerId));
const syncSchedules = await registerSyncSchedules(getQueue, pausedIds);
```

`registerSyncSchedules(getQueueFn, pausedSchedulerIds = new Set())` ([scheduling.ts:103](../../src/lib/jobs/scheduling.ts)) пропускает расписания, чьи `schedulerId ∈ pausedSchedulerIds`. **Так пауза переживает рестарт воркера** — ключевое отличие от Подхода 3 (Redis-only пауза снималась бы при рестарте). Сигнатура расширяется обратносовместимо (второй аргумент опционален; `registerCommissionSchedules`/`registerAlertSchedules` не трогаем).

Процессоры (`sync-orders` и т.д.) **не меняются**: `reason: 'manual'` — лишь метка; путь обработки идентичен крону.

---

## 6. RBAC + guardrails

- **RBAC (§4 defense-in-depth):** middleware уже режет `/admin/*` и `/api/admin/*`; каждый server-action/роут проверяет admin; сервис не доверяет вызывающему. Admin internal-only, под-ролей нет — отдельного скоупа не требуется.
- **Два guard-модуля (не путать):** server-actions/страницы (trigger/pause/cursor) — `requireAdmin()` из [`@/lib/auth/requireRole`](../../src/lib/auth/requireRole.ts) (redirect-стиль, `redirect('/forbidden')`). API-роут retry-all — `requireSession()` + `requireAdmin(session)` из [`@/lib/auth/guard`](../../src/lib/auth/guard.ts) (response-стиль `{ok, response}`, как существующий per-job retry). Перепутать = редирект в JSON-эндпоинте или необработанный `{ok}` на странице.
- **Перемотка курсора (3.4):** модалка с **type-to-confirm** — оператор вводит имя сущности (как удаление репозитория в GitHub), кнопка до этого disabled. Явное предупреждение про re-pull. При `ONE_C_ADAPTER=real` — усиленный warning-баннер (**не блок**: курсор нужен именно на real в день cutover).
- **Bulk-retry / пауза:** обычный confirm-диалог (без type-to-confirm — обратимые операции).
- **A11y (§9):** все модалки на `useDialogFocus(open)` — `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape, live-region (`role="status"`/`role="alert"`) для результата. Эталон — [invite-org-user-form.tsx](../../src/components/organization/invite-org-user-form.tsx).

---

## 7. Обработка ошибок

Сервис возвращает стабильные коды; server-action маппит в русское сообщение. Стабильные коды (§3, не менять без миграции вызовов):

| Код | Когда | UI-сообщение (RU) |
|---|---|---|
| `already_running` | trigger при `active > 0` | «Синк уже выполняется» |
| `queue_unavailable` | Redis недоступен (trigger/retry/pause) | «Очередь недоступна (Redis)» |
| `unknown_entity` | неизвестная сущность | «Неизвестная сущность» |
| `unknown_queue` / `unknown_schedule` | неизвестная очередь/расписание | «Неизвестная очередь» |
| `invalid_cursor` | курсор в будущем / не парсится | «Недопустимое значение курсора» |
| `storage` | сбой записи `SyncState` | «Ошибка записи» |

Принципы:
- **Enqueue-фейл здесь surface'ится**, а не глотается — это основное действие пользователя (в отличие от §3-fan-out, где побочные эффекты degrade gracefully).
- Redis-down изолирован: trigger/retry/pause отдают `queue_unavailable`; **перемотка курсора (Postgres) работает независимо** — в день cutover это важно.
- Частичные провалы bulk-retry не роняют операцию (см. 3.2).

---

## 8. UI

### `/admin/sync` — расширяем read-only таблицу в control center

К существующей таблице (server-component) — действия в client-обёртках:
- Колонка/панель «выполняется сейчас» — из `getJobCounts(active, waiting)` per-queue (оператор видит in-flight до запуска).
- На строку-сущность: **[Запустить]**, **[Курсор…]** (открывает модалку), тумблер **[Пауза/Активно]**.
- Строка `reconcile`: **[Запустить]** + тумблер паузы (без курсора).
- Страница остаётся server-component (`requireAdmin` + загрузка summary + paused-set + queue-counts); кнопки/модалки — отдельные `'use client'` компоненты.

### `/admin/health` — bulk-retry рядом с DLQ-таблицей

DLQ-таблица кросс-очередная (sync + docs + notifications + emails) → её законный дом — health. Добавляем **[Повторить все]** на очередь (рядом с существующим per-job retry). Кросс-ссылка `/admin/sync` ↔ `/admin/health`. **Решение:** не дублировать DLQ-таблицу на двух страницах.

Цвета/локализация — оранжевая палитра, RU-строки (§13).

---

## 9. Тестовая стратегия (§6)

**L1 / unit (без Postgres/Redis):**
- `services.admin.syncControl.test.ts` — `triggerSync` (already_running при active>0; happy path `queue.add` с `reason:'manual'`; queue_unavailable), `setSchedulePaused` (БД-запись + removeJobScheduler; резюм), `rewindCursor` (валидация future→invalid_cursor; null→reset; happy + before/after audit) — всё через mock-провайдер и mock-prisma (`vi.hoisted`).
- `services.admin.queueStats.test.ts` (расширить) — `retryAllDlq` (счётчики retried/failed; truncated при >CAP).
- `server-actions.admin.syncControl.test.ts` — zod-валидация, `requireAdmin`-гейт (redirect-стиль), маппинг кодов.
- `api.admin.dlq.retry-all.test.ts` — guard-гейт (response-стиль), `isKnownQueue`→400, маппинг Result в JSON.
- `jobs.scheduling.test.ts` (расширить) — `registerSyncSchedules` пропускает paused schedulerId.
- Компонент-тесты модалок — `renderToString` (vitest `environment: 'node'`, без jsdom/RTL): type-to-confirm гейтит кнопку; live-region присутствует. `import React` обязателен (classic JSX transform).

**L2.5 / L3 (живой Postgres):**
- `rewindCursor` против реального PG: `SyncState.cursor` записан + audit-row создан.
- `SyncSchedulePause` upsert/delete + повторное чтение.

**e2e (опционально):** snapshot control-панели `/admin/sync`; baselines генерируются на staged Linux-прогоне (`npm run e2e:visual:update`), не коммитятся с Windows — паттерн прошлых фаз.

---

## 10. Открытые вопросы (не баги, явные)

1. **Дедуп manual-триггера за пределами одного процесса.** `jobId = manual:<entity>:<ms>` защищает от двойного клика, но два админа одновременно дадут два джоба. Приемлемо для ≤10 операторов; усиливать (advisory-lock) — при измеримой проблеме.
2. **Каскад при перемотке курсора.** v1 пишет только `cursor`; не трогает `lastError`/`lastSuccessAt`. Если понадобится «сбросить и ошибку» — отдельное требование.
3. **Видимость состояния воркера.** Пульт показывает счётчики очередей, но не «жив ли воркер». Лайвнесс воркера — это подсистема B (алерты) / health-probe, не дублируем здесь.

---

## 11. Не входит в v1 (non-goals)

- Runtime feature-flag тумблеры (подсистема **D**; требует отступления от §5).
- Управление Company / `managerTeamVisibility` из админки (подсистема **C**).
- Admin-страница алертов поверх `AlertState` (подсистема **B**).
- «Retry-all по всем очередям сразу», пер-джоб приоритеты, отмена активного джоба, reset `SyncLog`.
- Изменение расписаний (cron-паттернов) из UI — они остаются в коде (`SYNC_SCHEDULES`).
