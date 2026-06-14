# T4 — Точечные launch-блокеры: дизайн

**Дата:** 2026-06-14
**Трек:** T4 из [launch-readiness-roadmap](2026-06-13-launch-readiness-roadmap.md) (🔴 launch-критичный, независимый)
**Метод подготовки:** 3 параллельных code-разведки (Explore) — каждая находка подтверждена в реальном коде с file:line, ни одна не взята «на слово» из аудита.

## Цель

Закрыть 4 точечных дефекта, не складывающихся в отдельную фичу, но блокирующих боевой запуск: утечку документа между организациями одной компании (DOC-01), дубли начислений комиссии при гонке (C-01) и при пересечении периодов (C-05), отсутствие уведомления партнёра о готовой ведомости (C-02).

Принцип: **минимальный точечный фикс + defense-in-depth + regression-тест на каждый**. Никакого расширения смежного функционала.

---

## DOC-01 — утечка документа между sibling-организациями (P1)

### Подтверждённая причина
Дженерик-роут [src/app/api/documents/[id]/download/route.ts](../../../src/app/api/documents/[id]/download/route.ts) (`requireSession()`, доступен в т.ч. org-роли) → `canReadDocument` → [src/lib/auth/policy.ts:123](../../../src/lib/auth/policy.ts):

```ts
} else if (session.role === 'organization') {
  // Org-channel id is not re-checked here: canReadOrder() below ties the order to the
  // user's org/company. (Partner branch must pin counterpartyId ...)
  if (doc.counterpartyType !== 'organization') return false;   // ← проверяет ТИП, не ID
}
return canReadOrder(session, { id: doc.orderId, companyId: doc.order.companyId });
```

`canReadOrder` для org ([policy.ts:54](../../../src/lib/auth/policy.ts)) проверяет лишь, что `session.organizationId` принадлежит **компании** заказа — не что документ канализирован именно на организацию пользователя. Партнёрская ветка `counterpartyId` пинит (правильно), org-ветка — нет. Org-кабинетный роут `/api/organization/documents/[id]/download` безопасен (идёт через `documentInChannel`), но дженерик — нет.

### Решение
Запинить org-канал по id, симметрично партнёрской ветке:
```ts
} else if (session.role === 'organization') {
  if (doc.counterpartyType !== 'organization' || doc.counterpartyId !== session.organizationId) return false;
}
```

### Открытый вопрос (DOC-01-Q)
Может ли org-пользователь быть участником **нескольких** организаций (`OrganizationUser` junction, `session.organizationMemberships`)? Если да и доступ к документам нужен по всем активным членствам — пин должен быть по `organizationMemberships`, а не по единственному `session.organizationId`.
**Решение по умолчанию (если владелец не уточнит):** пин по `session.organizationId` (home-org) — совпадает с поведением безопасного org-кабинетного роута (`resolveActiveOrgId`), это и есть текущая фактическая граница доступа. Более широкий вариант — отдельным решением.

### Заодно проверить (не раздувая scope)
Доступен ли дженерик-роут org-роли через middleware/`protectedPrefixes` вообще. Память проекта: `GET /api/documents` (листинг) ограничен admin/manager. Если и `[id]/download` отрезан для org на уровне middleware — фикс остаётся как defense-in-depth (CLAUDE.md §4: не сокращать ни один слой), но severity ниже. Зафиксировать факт в close-out.

---

## C-01 — дубли начислений комиссии при гонке (P1)

### Подтверждённая причина
[prisma/schema.prisma](../../../prisma/schema.prisma) `CommissionStatement`: только `@@index([partnerId, periodFrom, periodTo])` (**не unique**). [src/lib/services/commission/statement.ts:148](../../../src/lib/services/commission/statement.ts) делает `findFirst` вне транзакции, затем `create` в транзакции — две параллельные джобы/вызова на один (partner, period) обе видят `null` и обе создают строку.

### Решение
1. **Schema:** `@@unique([partnerId, periodFrom, periodTo])` на `CommissionStatement`. **Только non-superseded строки** должны быть уникальны — но `supersededBy` участвует в жизненном цикле (старая строка остаётся с `supersededBy=created.id`). → нужен **partial unique index** `WHERE "supersededBy" IS NULL` (полный unique сломает supersede-флоу, где для одного периода легитимно живут superseded + актуальная).
2. **Миграция:** ручной partial-unique (Prisma `@@unique` не умеет `WHERE`; пишем `CREATE UNIQUE INDEX ... WHERE "supersededBy" IS NULL` в SQL-миграции, в schema помечаем комментарием — стандартный приём для partial-unique в Prisma).
3. **Код:** обернуть `create` в try/catch на `P2002` → при коллизии перечитать `findFirst` и пойти по update-ветке (граничный catch, не глотать — §3 Result/контракт воркера).

### Открытый вопрос (C-01-Q) — БЛОКЕР миграции
В **проде/staging могут быть существующие дубли** (partner+period с двумя non-superseded строками). Partial-unique index не построится, миграция упадёт. → нужен **pre-check + одноразовая дедупликация** перед применением (оставить самую свежую `calculatedAt`, остальные пометить superseded). Это операторский шаг, как в [[1c-file-import]] M5 (inn-unique pre-check). Зафиксировать в плане как pre-deploy gate.

---

## C-05 — пересечение периодов ручного расчёта → двойной учёт (P2)

### Подтверждённая причина
[src/app/api/partner/finance/statements/route.ts:14](../../../src/app/api/partner/finance/statements/route.ts) валидирует формат и `periodFrom < periodTo`, но **не** пересечение с существующими ведомостями. `calculateStatementForPartner` ищет только точное совпадение периода. UI ([manual-calc-form.tsx](../../../src/components/partner/manual-calc-form.tsx)) ограничивает ввод целым месяцем, но API принимает произвольные `from/to` → апрель и «март–июнь» дадут двойной учёт апреля.

### Решение
Overlap-гард в **сервисе** (`calculateStatementForPartner`, не только в роуте — §2 направление зависимостей, чтобы и воркер был защищён), возвращающий стабильный код `period_overlap` (§3 Result), который роут мапит в **409**:
```ts
where: { partnerId, supersededBy: null,
  AND: [{ periodFrom: { lte: periodTo } }, { periodTo: { gte: periodFrom } }] }
```
Исключить из проверки точное совпадение, если оно ведёт в легитимную update-ветку (тот же период = пересчёт черновика, не overlap). Граница: overlap-гард срабатывает на **разные, но пересекающиеся** периоды.

### Открытый вопрос (C-05-Q)
Монотонный месячный генератор (`docs.calculateMonthlyCommissions`) всегда создаёт строго месячные периоды → между собой не пересекаются. Overlap-гард не должен ломать его (полные месяцы не пересекаются по построению). Проверить тестом, что месяц-за-месяцем проходит.

---

## C-02 — партнёр не уведомляется о готовой ведомости (P1)

### Подтверждённая причина — всё мёртвое
- Шаблон [src/lib/email/templates/commission-ready.tsx](../../../src/lib/email/templates/commission-ready.tsx) + `sendCommissionReadyEmail` ([send.tsx:143](../../../src/lib/email/send.tsx)) — **0 вызовов в проде** (только тесты).
- Enum `NotificationType.commission_statement_ready` (schema) — **0 инстанцирований**.
- `notifyPartnerUsers` ([src/lib/notifications/partner.ts:12](../../../src/lib/notifications/partner.ts)) поддерживает только `type: 'document_published'`.
- Воркеры `generate-commission-{pdf,xlsx}` пишут `pdfPath`/`xlsxPath` и молчат.

### Решение
1. Расширить `PartnerNotifyInput` union типом `commission_statement_ready` (payload: `statementId`, `period`, `amount`).
2. Добавить диспетчер в `notifyPartnerUsers` → `sendCommissionReadyEmail` (паттерн как `dispatchOrgEmail` в org.ts; партнёр-юзеры через `partnerUsers` junction, не `User.partnerId`).
3. **Точка вызова — completion-gate:** уведомлять, когда готовы **оба** файла. Воркеры PDF/XLSX независимы и гоняются параллельно → нельзя слать из одного. После update `xlsxPath`/`pdfPath` перечитать строку: если **оба** path выставлены → `notifyPartnerUsers` (graceful, log-and-swallow §3). Идемпотентность: слать один раз — добавить флаг/проверку, что уведомление этого типа для statementId ещё не отправлено (или гейтить по «оба готовы И раньше был ровно один готов»).

### Открытый вопрос (C-02-Q)
Идемпотентность completion-gate при ре-генерации (пересчёт черновика заново ставит оба path). Варианты: (а) слать при каждом переходе «оба готовы», (б) однократно через маркер. **Решение по умолчанию:** уведомлять только при переходе `draft → не-draft` (ведомость становится видимой партнёру), а не на каждую ре-генерацию файлов — статус-переход семантически и есть «готова партнёру». Уточнить точную точку статус-перехода в `calculateStatementForPartner`.

---

## Тестовая стратегия

| Блокер | Слой | Тест |
|---|---|---|
| DOC-01 | integration | org-A user НЕ может скачать документ org-B той же компании через дженерик-роут (403); org-A может скачать свой (200). Расширить `services.document-channel-isolation.test.ts`. |
| C-01 | integration | partial-unique держит инвариант: вставка второй non-superseded строки на (partner, period) → P2002; supersede-флоу (superseded + актуальная) проходит. |
| C-01 | unit | `calculateStatementForPartner` ловит P2002 → уходит в update-ветку, не падает (мок-гонка). |
| C-05 | unit | overlapping период → `{ok:false, error:'period_overlap'}` → роут 409; идентичный период (пересчёт) → НЕ overlap; смежные месяцы (monthly gen) → НЕ overlap. |
| C-02 | unit | оба path готовы → `notifyPartnerUsers(commission_statement_ready)` вызван; один path → НЕ вызван; идемпотентность (повторный «оба готовы» по умолчанию не дублирует). |

Гейты как обычно: typecheck/lint/`test:unit`, integration через WSL live-PG ([[project-wsl-live-pg-verification]]; Docker headless на этой машине падает), `build`.

## Порядок реализации (subagent-driven, §8)
1. DOC-01 (чистый одно-местный фикс + integration-тест) — быстрый, без миграции.
2. C-02 (тип + диспетчер + completion-gate + unit) — без миграции.
3. C-05 (overlap-гард в сервисе + Result-код + роут 409 + unit) — без миграции.
4. C-01 (schema partial-unique + миграция + P2002-catch + тесты) — **последним**, требует pre-deploy дедупликации (C-01-Q); миграция применяется оператором после pre-check.

## Pre-deploy зависимости (операторские, в close-out)
- C-01: pre-check дублей `CommissionStatement` на (partnerId, periodFrom, periodTo) WHERE supersededBy IS NULL + одноразовая дедупликация перед миграцией.
- Integration-прогон — через WSL live-PG.
