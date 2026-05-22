# Phase 4 — Plan: Финансы и комиссия

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents are available) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Дата начала:** 2026-05-22
**Base commit:** `a85d34c` (feat(phase3): sync hardening, storage RLS doc, lead attachments, pushLead pipeline) — после merge PR #46 в `main` зафиксируем фактический base.
**Branch:** `claude/partner-cabinet-phase4`
**Spec reference:** `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` §§ 5.8 (финансы UI), 6.3 (алгоритм расчёта), 6.4 (триггер попадания), 6.5 (PDF), 6.6 (Excel), 6.7 (per-org override), 6.8 (lifecycle), 7.3 (RBAC), 9.1 (Phase 4).

## Цель фазы

После Phase 3 партнёрский кабинет имеет каркас, портфель, сделки, лиды с вложениями, sync-инфраструктуру к 1С и admin-наблюдаемость. Phase 4 по §9.1 спеки — «Финансы и комиссия»: партнёр должен видеть свой финансовый поток (заработано / в обработке / выплачено), получать сформированный отчёт по комиссиям за период с PDF и XLSX-выгрузкой, и переводить отчёты по lifecycle `draft → approved → paid`.

Это **последняя функциональная фаза перед Phase 5 (полировка и rollout)**. После её завершения cabinet закроет финансовый цикл pilot-партнёра.

Фаза опирается на уже существующие в схеме модели `CommissionStatement` и `CommissionStatementItem` (Phase 0), сервис `rateOverride.ts` (Phase 1) и зарегистрированные но пустые очереди `docs.generateCommissionPdf` / `docs.generateCommissionXlsx` (Phase 0).

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│  /partner/finance (Server Component)                                │
│  ↓ читает через                                                     │
│  src/lib/services/partner/finance.ts (read API)                     │
│  ↓                                                                  │
│  src/lib/services/commission/                                       │
│     calculator.ts    ← pure расчёт по period                        │
│     statement.ts     ← orchestration: расчёт + БД + enqueue PDF/XLSX│
│     lifecycle.ts     ← approve/pay/supersede transitions            │
│     pdf.ts           ← @react-pdf/renderer rendering                │
│     xlsx.ts          ← exceljs rendering                            │
│                                                                     │
│  src/worker/processors/                                             │
│     generate-commission-pdf.ts                                      │
│     generate-commission-xlsx.ts                                     │
│                                                                     │
│  src/lib/jobs/scheduling.ts                                         │
│     + monthly cron 0 6 1 * * → enqueue calc per partner             │
│                                                                     │
│  API /api/partner/finance/                                          │
│     route.ts                          (GET kpis + list)             │
│     statements/route.ts               (POST manual calc)            │
│     statements/[id]/route.ts          (GET detail, PATCH lifecycle) │
│     statements/[id]/pdf/route.ts      (GET signed URL → 307)        │
│     statements/[id]/xlsx/route.ts     (GET signed URL → 307)        │
└─────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Calculator — чистая функция.** Принимает массив orders + override-карту ставок, возвращает items + totals. Без БД, без I/O — легко тестируется.
2. **Snapshot rates.** `CommissionStatementItem.rate` хранит ставку на момент расчёта. Поздние изменения `Organization.partnerCommissionRate` не пересчитывают существующие `draft`-statement-ы (только новые).
3. **Idempotency per period.** Повторный расчёт за тот же period+partner не дублирует statement — обновляет существующий `draft`. После `approved` — расчёт создаёт новый и помечает старый `supersededBy`.
4. **PDF/XLSX — асинхронно через очереди.** Расчёт возвращает statement сразу, файлы появляются позже. UI показывает spinner на кнопке скачивания если `pdfPath === null`.
5. **Lifecycle через PATCH** с явным `action` (`approve`, `markPaid`). Никаких неявных переходов.

## Что входит в Phase 4

### Часть 1 — Зависимости

- `npm install @react-pdf/renderer exceljs` — две новые библиотеки.
  - `@react-pdf/renderer ^4.0.0` — нативный (без headless Chrome), работает в Node-worker. ~3 MB bundle, deps: pdfkit, fontkit.
  - `exceljs ^4.4.0` — pure-JS Excel writer, streaming. ~1.5 MB bundle.
- Обе попадают в worker bundle (Next.js не тащит их в client), `next.config.ts` уже разрешает server-side native deps.

### Часть 2 — Calculator (чистая функция)

`src/lib/services/commission/calculator.ts`:

```ts
export type OrderForCalc = {
  id: string;
  orderNumber: string | null;
  organizationName: string;
  totalAmount: number;
  vatIncluded: boolean;
  vatRate: number | null;
  rate: number; // resolved rate at calc time (org override or partner default)
};

export type CalculatorResult = {
  items: Array<{
    orderId: string;
    orderNumber: string | null;
    organizationName: string;
    baseAmount: number;     // depends on COMMISSION_TRIGGER_VAT_MODE
    rate: number;
    commissionAmount: number;
  }>;
  totals: {
    totalBaseAmount: number;
    totalCommissionAmount: number;
    averageRate: number; // weighted by baseAmount, 0 if base is 0
  };
};

export function calculateCommission(
  orders: OrderForCalc[],
  opts?: { vatMode?: 'full' | 'exclude_vat' }
): CalculatorResult;
```

**Default**: `vatMode='full'` — комиссия от полной суммы. `exclude_vat` отделяет НДС если `vatIncluded && vatRate`. Управляется env `COMMISSION_VAT_MODE`.

Pure-функция: легко покрыть unit-тестами с фиксированными данными.

### Часть 3 — Statement service

`src/lib/services/commission/statement.ts`:

```ts
export type CalculateStatementInput = {
  partnerId: string;
  periodFrom: Date;
  periodTo: Date;
  calculatedByUserId: string | null;  // null если cron
};

export async function calculateStatementForPartner(
  prisma: PrismaClient,
  input: CalculateStatementInput
): Promise<{
  statement: CommissionStatement;
  itemCount: number;
  isNew: boolean;  // true если создали; false если обновили существующий draft
}>;
```

**Логика:**
1. Найти `Order` где `partnerId = input.partnerId AND closedAt BETWEEN periodFrom AND periodTo AND financialStatus = 'paid'`.
   - Триггер настраивается env `COMMISSION_TRIGGER`:
     - `paid_and_closed` (default) — нужны оба
     - `paid` — только `financialStatus='paid'`, по `paidAt`
     - `completed` — `executionStatus='completed' AND completedAt BETWEEN ...`
2. Для каждой order — resolve rate: если `org.partnerCommissionRate != null` — взять её, иначе `partner.commissionRate`.
3. Вызвать `calculateCommission(orders)`.
4. Найти существующий statement за этот period+partner:
   - Если есть `draft` — обновить (delete items + insert новых, обновить totals).
   - Если есть `approved`/`paid` — создать новый, поставить новый `id` в `oldStatement.supersededBy`.
   - Если нет — create.
5. Enqueue `docs.generateCommissionPdf` и `docs.generateCommissionXlsx`.
6. Audit log `commission_statement_calculated`.

### Часть 4 — Lifecycle service

`src/lib/services/commission/lifecycle.ts`:

```ts
export async function approveStatement(prisma, args: {
  statementId: string;
  partnerId: string;
  approvedByUserId: string;
}): Promise<CommissionStatement>;

export async function markStatementPaid(prisma, args: {
  statementId: string;
  partnerId: string;
  paidByUserId: string;  // только role=admin платформы (не partner-admin)
  paidAt?: Date;         // default now
}): Promise<CommissionStatement>;
```

**Transitions:**
- `draft → approved`: только partner-admin своего partnerId. Записывает `approvedByUserId`, `approvedAt`.
- `approved → paid`: только **platform admin** (role=admin), не partner-admin. Записывает `paidAt`. Audit `commission_statement_paid`.
- `superseded`: проставляется автоматически при пересчёте (Часть 3).

Все попытки нарушить порядок (`draft → paid` без approve, повторный approve и т.п.) → `LIFECYCLE_VIOLATION`.

### Часть 5 — PDF rendering

`src/lib/services/commission/pdf.ts`:

```ts
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import QRCode from 'qrcode';  // bonus dep, если будем делать QR

export async function renderStatementPdf(args: {
  statement: CommissionStatement;
  items: CommissionStatementItem[];
  partner: { name: string; legalName: string | null };
  verifyUrl: string | null;  // QR ссылка на /partner/finance/[id]
}): Promise<Buffer>;
```

**Шаблон:**
- Шапка: логотип Промтехносферы (статичный SVG из `public/logo.svg`), название партнёра, реквизиты.
- Период: «За май 2026», calculatedAt.
- Таблица: №, Заказ, Организация, База, %, Комиссия. Right-align на числовых.
- Итог: totalBase, averageRate, totalCommission. Жирно.
- Подвал: «Сформировано в кабинете ОТСФЕРА», дата.
- (опционально, добавим если есть время) QR в углу со ссылкой на `verifyUrl`.

Работает в worker (Node-only, без браузера). Bundle ≈ 3 MB но это server-side.

### Часть 6 — XLSX rendering

`src/lib/services/commission/xlsx.ts`:

```ts
import ExcelJS from 'exceljs';

export async function renderStatementXlsx(args: {
  statement: CommissionStatement;
  items: CommissionStatementItem[];
  partner: { name: string };
}): Promise<Buffer>;
```

**Лист 1 «Items»**: заголовки в первой строке, items строками. Колонки: №, Заказ, Организация, База, %, Комиссия. Auto-filter включен, freeze pane на строке 1.

**Лист 2 «Summary»**: статичные пары field/value (Партнёр, Период, Total base, Average rate, Total commission, Status).

### Часть 7 — Worker processors

`src/worker/processors/generate-commission-pdf.ts`:

```ts
export async function generateCommissionPdfProcessor(
  job: Job<GenerateCommissionPdfPayload>,
  db: PrismaClient = prisma
): Promise<{ statementId: string; path: string }>;
```

1. Загрузить statement + items + partner.
2. `renderStatementPdf(...)` → Buffer.
3. Upload в Supabase Storage: `partners/{partnerId}/commission/{statementId}.pdf`.
4. Update `CommissionStatement.pdfPath`.
5. SyncLog не пишем — это не sync.

Аналогично `generate-commission-xlsx.ts` для XLSX (path → `{statementId}.xlsx`).

### Часть 8 — Cron schedule

В `src/lib/jobs/scheduling.ts` добавить новое расписание:
- `docs.calculateMonthlyCommissions` — pattern `0 6 1 * *` (1-го числа в 6 утра МСК), tz Europe/Moscow.
- Регистрируется тем же `registerSyncSchedules` (или новой `registerCommissionSchedules`, чтобы не мешать sync).

Новый processor `src/worker/processors/calculate-monthly-commissions.ts`:
1. periodFrom = первый день прошлого месяца, periodTo = последний день прошлого месяца.
2. Для каждого активного `Partner` (`commissionRate > 0`):
   - `calculateStatementForPartner(prisma, { partnerId, periodFrom, periodTo, calculatedByUserId: null })`.
3. Возврат summary: how many partners processed, total errors.

Регистрация очереди `docs.calculateMonthlyCommissions` в `queues.ts` (новое имя).

### Часть 9 — API роуты

**`GET /api/partner/finance`** — KPI:
- earnedTotal (sum totalCommissionAmount across approved+paid statements)
- pendingTotal (sum across draft+approved, not paid)
- paidTotal (sum across paid)
- expectedThisMonth (расчёт на лету для текущего открытого периода)

**`GET /api/partner/finance/statements`** — list, query `?status=&from=&to=` пагинация.

**`POST /api/partner/finance/statements`** — manual calc. Body: `{ periodFrom, periodTo }`. Только partner-admin. Вызывает `calculateStatementForPartner` синхронно (расчёт быстрый, файлы — асинхронно).

**`GET /api/partner/finance/statements/[id]`** — detail + items.

**`PATCH /api/partner/finance/statements/[id]`** — body `{ action: 'approve' }` или `{ action: 'markPaid' }`. Маршрутизация в `lifecycle.ts`.

**`GET /api/partner/finance/statements/[id]/pdf`** — 307 redirect на signed URL Supabase. 404 если `pdfPath === null` (ещё не сгенерирован).

**`GET /api/partner/finance/statements/[id]/xlsx`** — то же для XLSX.

Все ручки кроме PATCH `markPaid` — для partner-admin. `markPaid` — для platform-admin (`requireAdmin`).

### Часть 10 — UI `/partner/finance`

Снимаем `disabled: true` с пункта «Финансы» в `navigation/cabinet.ts`.

`src/app/partner/finance/page.tsx` — Server Component:
- KPI-grid (заработано / выплачено / в обработке / ожидается за этот месяц). Стиль как `KpiGrid` для дашборда.
- Кнопка «Сформировать за период» (только partner-admin) → модалка с `<input type="month">` периода → POST.
- Список statements по периодам:
  - Период, totalCommission, status (badge), кнопки [⬇ PDF] [⬇ XLSX].
  - Аккордеон-раскрытие со списком items.
  - Для `draft` — кнопка «Утвердить» (partner-admin).

Client components:
- `commission-statements-list.tsx` (с accordion и кнопками)
- `manual-calc-form.tsx` (модалка)

### Часть 11 — Mobile-tab bar

Заменить «Документы» на «Финансы» в `bottom-tab-bar.tsx`? **Нет** — оставляем 4 вкладки (Кабинет/Сделки/Заявки/Документы), Финансы доступны через sidebar. На мобиле партнёр сначала идёт в Кабинет, оттуда в Финансы.

### Часть 12 — Seed

В `prisma/seed.ts` добавить:
- Создать demo Order для `partner@demo.local` (через demo organization), `financialStatus='paid'`, `closedAt = месяц назад`, totalAmount=100000.
- Вызвать `calculateStatementForPartner` для прошлого месяца → создастся demo statement.
- НЕ генерируем PDF/XLSX в seed (worker не запущен), они появятся только при ручном `npm run worker`.

### Часть 13 — Тесты

- `src/__tests__/commission.calculator.test.ts` — unit, pure functions:
  - пустой массив → totals zero
  - один order → корректный item + totals
  - смешанные ставки → weighted average rate правильный
  - VAT mode `exclude_vat` корректно вычитает НДС
- `src/__tests__/services.commission.statement.test.ts` — integration (live PG):
  - happy path: создаются statement + items
  - re-calc на draft → обновляет, не дублирует
  - re-calc на approved → создаёт новый, помечает старый supersededBy
  - триггер `paid` vs `paid_and_closed` отбирает разные orders
- `src/__tests__/services.commission.lifecycle.test.ts` — integration:
  - draft → approved transition
  - approved → paid (платформа admin)
  - partner-admin не может markPaid (FORBIDDEN)
  - повторный approve → LIFECYCLE_VIOLATION
- `src/__tests__/services.commission.pdf.test.ts` — unit:
  - rendering returns Buffer длины > 1000 (приближённая sanity-проверка)
  - содержит partner.name (декодируем PDF в текст через pdf-parse или просто проверяем что Buffer не пустой)
- `src/__tests__/services.commission.xlsx.test.ts` — unit:
  - rendering returns Buffer, парсится обратно через ExcelJS, "Items" лист имеет N+1 строк
- `src/__tests__/api.partner.finance.test.ts` — unit с моками:
  - GET 401/403, 200 happy path
  - POST partner-manager → 403
  - PATCH approve → 200, повторно → 409
  - PATCH markPaid от partner-admin → 403
- `src/__tests__/worker.calculate-monthly-commissions.test.ts` — integration:
  - mock prisma, обрабатывает 2 партнёра, для одного нет orders → 0 statement-ов, для другого 1 → создаётся.

## Что НЕ делаем в Phase 4

- **Перевод денег**. Только маркер `paid`. Реальная выплата — вне scope (банковский процесс).
- **Email-уведомления о готовности statement**. Пометка через bell-icon в навбаре (Phase 0 notifications) — OK. Email pipeline — Phase 5.
- **Историю изменения ставки на UI**. На карточке организации сейчас только текущая ставка. История changes — отдельный план.
- **Bulk approve** через checkboxes. Один statement за раз — этого достаточно для pilot.
- **Reconcile комиссии с фактическими выплатами**. Phase 5+.

## Сознательные упрощения Phase 4

1. **Calculator — pure function без БД** — нельзя в одном проходе считать rate-override per-org. Поэтому resolver ставок выполняется в `statement.ts` ДО передачи в calculator. Это разделяет «чистый расчёт» и «I/O для подбора данных» — упрощает тесты.
2. **`supersededBy` — chain, не tree**. Если statement пересчитан 3 раза, история: A → B (A.supersededBy=B) → C (B.supersededBy=C). UI показывает только latest non-superseded.
3. **PDF/XLSX — fire-and-forget**. Не блокируем POST на их генерацию. UI обновится через `router.refresh()` после возвращения в список.
4. **Manual calc — синхронный API** (расчёт быстрый, ≤100ms для < 1000 orders). Если потребуется больше — выносим в `docs.calculateMonthlyCommissions` job с явным trigger.
5. **NDS-режим — env-флаг**, не per-partner. Phase 5+ может ввести `Partner.vatMode`.
6. **QR-код в PDF — стретч**, делаем если успеваем. Базовый PDF без QR — приемлем.

## Метрики приёмки

- `npm test` — все Phase 3 тесты + новые проходят. Ожидается +35-40 тестов.
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful. Новые роуты: `/partner/finance`, `POST/GET /api/partner/finance`, `/api/partner/finance/statements`, `/api/partner/finance/statements/[id]`, `[id]/pdf`, `[id]/xlsx`.
- `npm run prisma:seed` → у `partner@demo.local` появляется 1 demo statement за прошлый месяц со статусом `draft`.
- Manual smoke: partner-admin вручную формирует statement за выбранный период → видит итог, может утвердить.
- Manual smoke (admin): после approve может через какую-то админ-ручку перевести в paid (если admin UI отсутствует — через `curl` PATCH).
- Worker запускается с `ENABLE_SYNC_CRON=1`, через `docs.calculateMonthlyCommissions` schedule видно в логах: `[worker] schedule registered docs.calculateMonthlyCommissions ...`.

## Зависимости

Нужны новые npm-зависимости:
- `@react-pdf/renderer` — для PDF
- `exceljs` — для XLSX
- (optional) `qrcode` — для QR в PDF, стретч

Всё остальное уже есть:
- Models `CommissionStatement` + `CommissionStatementItem` (Phase 0)
- Queue names `docs.generateCommissionPdf`, `docs.generateCommissionXlsx` (Phase 0)
- Supabase Storage bucket `documents` (Phase 0)
- `requireAdmin`, `requirePartner`, `requirePartnerAdmin` guards (Phase 1/3)
- `auditLog` model + rateOverride service (Phase 1)
- BullMQ scheduling helpers (Phase 3)
- `getServerClient` для Supabase upload + `documentBucket` constant (Phase 3)

## Открытые вопросы (для бизнеса, не блочат план)

Из §6.9 спеки:
- [ ] НДС: комиссия с НДС или без? **Default**: с НДС (vatMode='full'). Закладываем env-флаг.
- [ ] Минимальная сумма к выплате (cutoff)? **Default**: нет cutoff, выплачиваем любую положительную сумму.
- [ ] Когда фактически платформа платит партнёру (по графику / по approve / по факту закрытия)? **Default**: после approve, мануально через `markPaid` от platform-admin.

Эти вопросы НЕ блокируют разработку — у нас разумные defaults. Бизнес может прийти и попросить tune через env / config UI позже.

## Test plan (для исполнителя)

Чек-лист, который должен пройти исполнитель плана:

- [ ] `npm test` зелёный (включая новые тесты Phase 4)
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 новых warnings
- [ ] `npm run build` — successful
- [ ] Manual smoke: `partner@demo.local` (partner-admin) на `/partner/finance` видит KPI и пустой/демо statement
- [ ] Manual smoke: кнопка «Сформировать за период» → выбрать прошлый месяц → создаётся statement (если есть подходящие orders)
- [ ] Manual smoke: `/api/partner/finance/statements/[id]/pdf` отдаёт 404 пока PDF не сгенерирован, потом 307 на signed URL → файл качается
- [ ] Manual smoke: PATCH approve → status меняется на approved, кнопка «Утвердить» исчезает
- [ ] Manual smoke (admin): PATCH markPaid → status = paid; partner-admin при попытке тех же PATCH → 403
- [ ] `npm run prisma:seed` → не падает, создаёт demo statement
- [ ] Lighthouse mobile (375px) для `/partner/finance` ≥ 85

---

## Bite-sized tasks (для агентов-исполнителей)

### Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1.1**: `npm install @react-pdf/renderer exceljs`
- [ ] **Step 1.2**: Verify in `package.json` под `dependencies`:
  - `"@react-pdf/renderer": "^4.0.0"` (или текущая стабильная)
  - `"exceljs": "^4.4.0"`
- [ ] **Step 1.3**: `npm run typecheck` — 0 errors (deps подхватились).
- [ ] **Step 1.4 — Commit**: `chore(deps): add @react-pdf/renderer and exceljs for commission generation`

### Task 2: Calculator pure function

**Files:**
- Create: `src/lib/services/commission/calculator.ts`
- Test: `src/__tests__/commission.calculator.test.ts`

- [ ] **Step 2.1**: Создать тест `commission.calculator.test.ts` со cases (см. §«Тесты» выше).
- [ ] **Step 2.2**: `npm test -- commission.calculator` → FAIL (модуль не существует).
- [ ] **Step 2.3**: Создать `calculator.ts` с типами `OrderForCalc`, `CalculatorResult` и функцией `calculateCommission` per §«Calculator».
- [ ] **Step 2.4**: `npm test -- commission.calculator` → PASS.
- [ ] **Step 2.5 — Commit**: `feat(commission): pure calculator for partner commission per period`

### Task 3: Statement service + idempotency

**Files:**
- Create: `src/lib/services/commission/statement.ts`
- Test: `src/__tests__/services.commission.statement.test.ts`

- [ ] **Step 3.1**: Тест integration: happy path, re-calc draft, re-calc approved → supersededBy.
- [ ] **Step 3.2**: Имплементация `calculateStatementForPartner` per §«Statement service».
- [ ] **Step 3.3**: Env-чтение `COMMISSION_TRIGGER` (default `paid_and_closed`).
- [ ] **Step 3.4**: `enqueue('docs.generateCommissionPdf', { statementId })` + `docs.generateCommissionXlsx`.
- [ ] **Step 3.5**: Тесты → PASS.
- [ ] **Step 3.6 — Commit**: `feat(commission): statement orchestration with idempotent re-calc and supersede chain`

### Task 4: Lifecycle service

**Files:**
- Create: `src/lib/services/commission/lifecycle.ts`
- Test: `src/__tests__/services.commission.lifecycle.test.ts`

- [ ] **Step 4.1**: Тесты для всех transitions + violations.
- [ ] **Step 4.2**: `approveStatement` и `markStatementPaid` функции с audit log.
- [ ] **Step 4.3**: Жёсткий чек роли в `markStatementPaid` — `session.role === 'admin'`.
- [ ] **Step 4.4 — Commit**: `feat(commission): lifecycle transitions draft→approved→paid with RBAC and audit`

### Task 5: PDF rendering

**Files:**
- Create: `src/lib/services/commission/pdf.ts`
- Test: `src/__tests__/services.commission.pdf.test.ts`

- [ ] **Step 5.1**: Sanity-тест: rendering вернул Buffer > 1000 байт.
- [ ] **Step 5.2**: Создать `pdf.ts` с React-pdf компонентами (Document, Page, View, Text, StyleSheet).
- [ ] **Step 5.3**: Шапка + таблица + итог per §«PDF rendering».
- [ ] **Step 5.4 — Commit**: `feat(commission): PDF rendering via @react-pdf/renderer`

### Task 6: XLSX rendering

**Files:**
- Create: `src/lib/services/commission/xlsx.ts`
- Test: `src/__tests__/services.commission.xlsx.test.ts`

- [ ] **Step 6.1**: Тест: rendering → Buffer, парсится обратно ExcelJS, "Items" лист has N+1 строк.
- [ ] **Step 6.2**: Создать `xlsx.ts` с двумя листами (Items + Summary) per §«XLSX rendering».
- [ ] **Step 6.3 — Commit**: `feat(commission): XLSX rendering with two sheets via exceljs`

### Task 7: Worker processors для PDF/XLSX

**Files:**
- Create: `src/worker/processors/generate-commission-pdf.ts`
- Create: `src/worker/processors/generate-commission-xlsx.ts`
- Modify: `src/worker/index.ts:5-15` (imports), `src/worker/index.ts:30-45` (startWorker calls)

- [ ] **Step 7.1**: Создать оба processor — загружают statement, рендерят, загружают в Supabase, обновляют path.
- [ ] **Step 7.2**: Подключить в `worker/index.ts`.
- [ ] **Step 7.3 — Commit**: `feat(worker): processors for commission PDF and XLSX generation`

### Task 8: Monthly cron job

**Files:**
- Modify: `src/lib/jobs/queues.ts` (add `docs.calculateMonthlyCommissions` to QUEUE_NAMES)
- Modify: `src/lib/jobs/scheduling.ts` (add to SYNC_SCHEDULES)
- Create: `src/worker/processors/calculate-monthly-commissions.ts`
- Modify: `src/worker/index.ts` (register processor)
- Test: `src/__tests__/worker.calculate-monthly-commissions.test.ts`

- [ ] **Step 8.1**: Расширить `QUEUE_NAMES` + соответствующий тест в `jobs.queues.test.ts`.
- [ ] **Step 8.2**: Добавить schedule в `scheduling.ts` с pattern `0 6 1 * *`, Europe/Moscow.
- [ ] **Step 8.3**: Processor: вычислить prev-month period, итерировать активных партнёров, вызвать `calculateStatementForPartner`.
- [ ] **Step 8.4**: Тест processor (mock prisma, 2 partner).
- [ ] **Step 8.5 — Commit**: `feat(commission): monthly cron job for automatic statement calculation`

### Task 9: API routes

**Files:**
- Create: `src/app/api/partner/finance/route.ts`
- Create: `src/app/api/partner/finance/statements/route.ts`
- Create: `src/app/api/partner/finance/statements/[id]/route.ts`
- Create: `src/app/api/partner/finance/statements/[id]/pdf/route.ts`
- Create: `src/app/api/partner/finance/statements/[id]/xlsx/route.ts`
- Create: `src/lib/services/partner/finance.ts` (KPI read service)
- Test: `src/__tests__/api.partner.finance.test.ts`

- [ ] **Step 9.1**: `finance.ts` сервис чтения (kpis + list).
- [ ] **Step 9.2**: GET `/api/partner/finance` (KPI), GET `/api/partner/finance/statements` (list).
- [ ] **Step 9.3**: POST `/api/partner/finance/statements` (manual calc, partner-admin).
- [ ] **Step 9.4**: GET/PATCH `/statements/[id]` (detail + lifecycle).
- [ ] **Step 9.5**: GET `/pdf` и `/xlsx` (307 redirect или 404).
- [ ] **Step 9.6**: Тесты с моками, все RBAC-кейсы.
- [ ] **Step 9.7 — Commit**: `feat(api): partner finance KPI + statement CRUD + PDF/XLSX download routes`

### Task 10: UI /partner/finance

**Files:**
- Create: `src/app/partner/finance/page.tsx`
- Create: `src/components/partner/commission-statements-list.tsx`
- Create: `src/components/partner/manual-calc-form.tsx`
- Modify: `src/lib/navigation/cabinet.ts` (remove `disabled: true` from Финансы)

- [ ] **Step 10.1**: Сервер-компонент `/partner/finance/page.tsx`: загрузка KPI + list через finance service.
- [ ] **Step 10.2**: `commission-statements-list.tsx` — клиентский компонент с accordion на per-statement items + кнопки [PDF] [XLSX] [Утвердить].
- [ ] **Step 10.3**: `manual-calc-form.tsx` — модалка с `<input type="month">`, POST.
- [ ] **Step 10.4**: Снять `disabled: true` с пункта «Финансы».
- [ ] **Step 10.5 — Commit**: `feat(partner): finance dashboard page with statements list and manual calc`

### Task 11: Seed extension

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 11.1**: Создать demo Organization + Order для partner@demo.local если ещё нет.
- [ ] **Step 11.2**: Order с `financialStatus='paid'`, `closedAt = prevMonth.lastDay`.
- [ ] **Step 11.3**: Вызвать `calculateStatementForPartner` за prevMonth → создаётся draft.
- [ ] **Step 11.4 — Commit**: `chore(seed): demo paid order + draft commission statement for prev month`

### Task 12: Lint + typecheck + build + final tests

- [ ] **Step 12.1**: `npm run typecheck` → 0 errors.
- [ ] **Step 12.2**: `npm run lint` → 0 new warnings.
- [ ] **Step 12.3**: `npm run build` → successful (новые роуты в выводе).
- [ ] **Step 12.4**: `npm test` → все 262+новые tests green.
- [ ] **Step 12.5**: Manual smoke per «Test plan» выше.
- [ ] **Step 12.6 — Final commit (если нужны мелкие правки)**: ` chore(phase4): final polish`.

---

**После завершения**: PR на main, заголовок `feat(phase4): commission calculation, PDF/XLSX, finance UI`. После merge — `Phase 5 — Полировка и rollout` (PWA polish, ClamAV async scan, мониторинг, performance).
