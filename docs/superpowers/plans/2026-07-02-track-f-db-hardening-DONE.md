# Close-out: Трек F (P1) — укрепление базы данных

Дата: 2026-07-02. Источник: промт «Трек F» (ТЗ §16, §25.6). Предпосылка: A+C в `main`.
Объём: F1 (индексы AuditLog) + F2 (аудит горячих списков) + F3 (изоляция списков, тесты)
+ **F4 (история ставки организации — по явному решению владельца, не отложена)**.

## F1 — индексы `AuditLog` (был подтверждённый full scan)

Модель не имела ни одного `@@index`. Добавлены — сверено с фактическими `where`/`orderBy`:

| Индекс | Обслуживает |
|---|---|
| `[entity, entityId]` | трейл сущности: `manager/orderDetail.ts` (таймлайн заказа), `admin/commissionStatements.getStatementAuditLog` |
| `[userId, createdAt]` | `admin/auditLog.listAudit` (фильтр по актору + сортировка recency) |
| `[createdAt]` | `admin/dashboard.recentEvents`, дефолтная сортировка `listAudit` |

Миграция: `20260702000000_auditlog_indexes` (index-only, обратимая).

**EXPLAIN, ключевой запрос** `entity='order' AND entityId=… ORDER BY createdAt DESC LIMIT 50`
(100k строк; «до» получено транзакционным `DROP INDEX … ROLLBACK` на тех же данных,
воспроизводится `tsx scripts/_explain-probe.ts seed|before|explain|clean`):

```
ДО:     Seq Scan on "AuditLog" … Rows Removed by Filter: 99990 … Execution Time: 15.873 ms
ПОСЛЕ:  Index Scan using "AuditLog_entity_entityId_idx" … Execution Time: 0.090 ms   (×176)
```

## F2 — аудит индексов горячих списков

Принцип: composite-индекс покрывает запросы по leading-префиксу; одиночные дубли не добавлялись.

| Модель | Вердикт |
|---|---|
| `Order` | **+`[companyId, executionStatus]`, +`[companyId, financialStatus]`** — горячие после C8 (company-wide scope = `where {companyId,…}`: `manager/orders.listOrders`, `leader/dashboard` groupBy, KPI менеджера). Запрошенные `(managerId)`/`(organizationId)`/`(partnerId)` — leading-префиксы существующих композитов → не дублировались |
| `Payment` | `[orderId]`, `[organizationId]`, `[paidAt]` уже существуют → без изменений |
| `Notification` | **`[userId]` → `[userId, createdAt]`** (лента `api/notifications`; одиночный стал избыточным префиксом и удалён), **+`[userId, isRead]`** (unread-бейдж `manager/dashboard/kpis`) |
| `Document` | `[orderId,type]`, `[companyId]`, `[scanStatus]` уже существуют → без изменений |
| `Organization` | **+`[companyId]`** — C8 org-scope (`manager/organizations`, `manager/finance`) |

Миграция: `20260702001000_hotlist_indexes` (index-only, обратимая).

**EXPLAIN (те же данные, до/после):**

```
Q2 Order companyId+executionStatus (агрегат KPI/leader-groupBy, 40k строк):
ДО:     Seq Scan on "Order" … Rows Removed by Filter: 26664 … Execution Time: 5.899 ms
ПОСЛЕ:  Index Only Scan using "Order_companyId_executionStatus_idx" … Heap Fetches: 0 … 1.617 ms

Q3 Notification userId ORDER BY createdAt DESC LIMIT 50 (60k строк):
ДО:     Index Scan Backward using "Notification_createdAt_idx" + Filter userId … 0.426 ms (деградирует с ростом чужих строк)
ПОСЛЕ:  Index Scan Backward using "Notification_userId_createdAt_idx", Index Cond … 0.100 ms
```

## F3 — изоляция по юрлицу на списках (доведение C4)

Аудит списочных сервисов: менеджерские выборки **уже** company-scoped через
`managerOrderScope`/`managerOrgScope`/`managerDocumentScope` (оба режима C8 держат
cross-company границу; sentinel deny-all при `companyId=null`), leader-dashboard —
`where {companyId}` напрямую; admin-списки глобальны намеренно (Model A).
Логика не менялась — добавлены **тесты**: `src/__tests__/f.list-cross-tenant.test.ts`
(расширение c3.idor с одиночных id на списки): менеджер компании A не получает данные
компании B в `listOrders` (team on/off), `listOrganizations` (on/off),
`getManagerFinanceOverview` (payments, on/off), `listDocuments` (через живой флаг
`managerTeamVisibility` on/off) + позитивные контроли и симметрия A↔B.

## F4 — история индивидуальной ставки организации (A5)

Решение close-out A+C («достаточно `CommissionStatementItem.rate`») **пересмотрено
владельцем** — F4 реализован для воспроизводимости пересчёта при изменении договорной
ставки задним числом:

- **Модель `OrganizationCommissionRateChange`** по образцу `CommissionRateChange`;
  отличие: `newRate` nullable — null = событие «очистка» (возврат к наследованию).
  Индекс `[organizationId, effectiveFrom]` (`map:` — дефолтное имя длиннее 63 байт PG).
  Миграция: `20260702002000_org_commission_rate_history` (новая пустая таблица, обратимая).
- **Писатели**: `setOrgCommissionRate`/`clearOrgCommissionRate` append-строку в своей
  транзакции (единственные мутации `partnerCommissionRate`; 1С-sync поле не пишет).
- **Резолвер**: `resolveOrgOverrideAt` (чистая, зеркало `resolveRateAt`; пустая история →
  fallback на текущее значение = поведение до-F4 для нетронутых организаций).
  `resolveEffectiveRate` получил опциональный `orgChanges` — приоритет
  override→история партнёра→дефолт НЕ менялся; без аргумента поведение идентично прежнему.
- **Потребители**: `statement.ts` (bulk-выборка истории по организациям периода),
  `corrections.ts` (поздние возвраты). Cross-partner гейт сохранён и для истории:
  чужой организации передаётся `[]`, не `undefined` — её текущий override не
  просачивается через fallback.
- **Тесты**: +11 unit-кейсов (`services.commission.rateResolve.test.ts`), запись истории
  в unit-моках (`services.partner.rateOverride.unit.test.ts`), интеграционный
  `f4.org-rate-history.test.ts`: таймлайн set→set→clear; ретро-смена ставки НЕ
  переписывает прошлый период (0.07, а не текущие 0.03); override, введённый после
  периода, не действует ретроспективно; clear до периода → партнёрский уровень;
  организация без истории → текущее значение (до-F4 поведение).

## Верификация

- `npm run typecheck` ✅, `npm run lint` ✅
- `npm run test:unit` ✅ 3395 passed (318 файлов; +2 файла моков дополнены новой моделью)
- `prisma migrate status` ✅ «Database schema is up to date!» (39 миграций)
- `prisma migrate diff --from-url … --to-schema-datamodel` ✅ «No difference detected»
  (ручной SQL миграций эквивалентен схеме байт-в-байт)
- `npm run gate` (migrate deploy + seed + integration) ✅ 73/73 файлов, 504/504 тестов
  (в т.ч. `f.list-cross-tenant` 9 ✓, `f4.org-rate-history` 5 ✓). Для повторного seed
  нужен живой Redis (`docker compose up -d redis`): fan-out уведомлений на upsert-ветках
  иначе уходит в бесконечный ioredis-retry и seed не завершается.

## Решения/заметки

- Миграции написаны вручную (Prisma CLI 5.22 local; `npx prisma` тянет v7 — не использовать).
- EXPLAIN-доказательства воспроизводимы скриптом `scripts/_explain-probe.ts`
  (синтетика маркируется `f-explain-probe*` и вычищается командой `clean`).
- `Order.[companyId,…]`-индексы при `LIMIT`+`ORDER BY id` планировщик может законно
  обходить через PK-walk на низкоселективных данных; выгода доказана на агрегатной
  форме (KPI/groupBy) — Index Only Scan, Heap Fetches: 0.
