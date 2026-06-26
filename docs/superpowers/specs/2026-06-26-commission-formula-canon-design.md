# Корректность расчёта комиссии — канон ТЗ §9.2 (SP-1: A1–A5, A7)

**Дата:** 2026-06-26
**Статус:** дизайн на ревью
**Трек:** Track A — корректность расчёта комиссии (P0, риск по деньгам)
**Scope:** SP-1 (ядро формулы: A1–A5 + A7). A6 (корректировка по возврату после выплаты, §9.5) вынесён в отдельный sub-project SP-2.

## 1. Проблема

Текущий расчёт (`src/lib/services/commission/statement.ts`, `calculator.ts`) расходится с ТЗ §9.2 и может приводить к неверным выплатам партнёрам:

| # | Сейчас | Канон ТЗ §9.2 |
|---|---|---|
| A1 | База = `order.totalAmount` (сумма заказа) | База = Σ фактических платежей |
| A2 | Возвраты не учитываются | Возвраты (`Payment.isRefund`) уменьшают базу |
| ~~A3~~ | НДС включён (`COMMISSION_VAT_MODE` default `full`) | **ОТМЕНЁН владельцем 2026-06-26** — см. ниже |
| A4 | Период по `closedAt` (trigger `paid_and_closed`) | Период по `paidAt` (дата поступления оплаты) |
| A5 | Текущая `Partner.commissionRate` | Ставка, действовавшая на дату платежа (`CommissionRateChange`) |

**Решение владельца по НДС (2026-06-26):** база = **полная сумма полученного платежа**, НДС из неё **не вычитается**. Пример: заказчик заплатил 100000 (с НДС или без — не важно), ставка 20% → партнёр получает 20000. Это **отменяет пункт A3** и формулировку «без НДС» из ТЗ §9.2. VAT-логика из калькулятора убирается полностью.

**Канон (фиксируем в коде и тестах):**
> База партнёра за месяц = Σ(фактически полученные платежи за период по дате `paidAt`) − Σ(возвраты за период). Комиссия = база × ставка, действовавшая в периоде. Период — календарный месяц (1-е … последнее число) по дате поступления оплаты. **НДС не вычитается** (решение владельца, перекрывает «без НДС» в исходном §9.2).

## 2. Решения владельца (зафиксированы)

1. **Уровень ставки — партнёр целиком (§9.1).** Калькулятор перестаёт читать `Organization.partnerCommissionRate`. Поле и сервис `partner/rateOverride.ts` физически НЕ удаляем в этом SP (отдельное решение), но из формулы override исключён. Историческая ставка берётся целиком из `CommissionRateChange` (привязан к партнёру) — новой таблицы истории не требуется.
2. **Декомпозиция.** SP-1 = A1–A5 + A7 (этот документ). SP-2 = A6 (§9.5, корректировки) — отдельный spec→plan→TDD цикл со своей моделью схемы и ручным resolve-flow.

## 3. Денежные правила

- **R0 (НДС, решено 2026-06-26).** База = полная сумма платежа; НДС **не** вычитается. Отменяет A3. Калькулятор не использует `vatAmount`/`vatRate` для базы.
- **R2 (A2).** Отрицательный нетто-месяц (Σ возвратов > Σ платежей в одном периоде): выплата по ведомости **зажимается в 0** (`totalCommissionAmount = max(0, Σ)`), но отрицательные строки **сохраняются** в позициях для аудита. Следствие: при зажиме сумма строк ниже хранимого `totalCommissionAmount` — осознанное отклонение (выплата не уходит в минус). Перенос «минуса» в следующий период — это уже A6/SP-2, не здесь. _(подтверждено владельцем 2026-06-26)_

## 4. Архитектура и единица строки

**Развилка (выбран Вариант A):** строка ведомости = **один платёж**.

Обоснование: канон §9.2 — это Σ по платежам; при исторической ставке (A5) рассрочка по одному заказу может попасть на две ставки, поэтому единица строки обязана быть мельче заказа. Per-payment точно отражает Σ, полностью аудируем (каждая копейка → строка `Payment`), снимает проблему смены ставки в середине месяца и естественно обрабатывает платежи без заказа (`orderId = null`) и возвраты (отрицательная строка).

Отвергнуто: B (строка = заказ) ломается на платежах без заказа и на смене ставки внутри месяца; C (строка = организация) теряет трассируемость и тоже требует нарезки по сегментам ставки.

Направление зависимостей (§2 CLAUDE.md) сохраняется: `statement.ts` (сервис) → `calculator.ts` (чистая функция). Калькулятор не знает про Prisma-запросы, только про вход `PaymentForCalc[]`.

## 5. Компоненты

### 5.1 Калькулятор (`src/lib/services/commission/calculator.ts`) — переписать

Вход меняется `OrderForCalc[]` → `PaymentForCalc[]`:

```ts
export type PaymentForCalc = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  organizationName: string;
  amount: Prisma.Decimal;        // сумма платежа (всегда положительная в БД)
  isRefund: boolean;
  rate: Prisma.Decimal;          // ставка, разрешённая на paidAt (резолвит сервис)
};
```

VAT-полей в входе нет (R0): НДС на базу не влияет.

На каждую строку:
- **База (R0, A1):** `base = amount` (полная сумма платежа, без вычета НДС).
- **Знак возврата (A2):** `isRefund === true` → база и комиссия с минусом.
- **Комиссия:** `base × rate`. Всё на `Prisma.Decimal`, округление HALF_UP до копейки (сохраняем текущую денежную дисциплину и комментарий о точности).
- **Итоги:** `totalBaseAmount = Σ base` (может быть < 0); `totalCommissionAmount = max(0, Σ commission)` (R2); `averageRate` — взвешенная по базе как сейчас, с guard на `totalBase ≤ 0 → 0`.

Удаляются: `baseAmountFor`, `DEFAULT_VAT_RATE`, `CalculatorOptions.vatMode` — VAT-математики в калькуляторе больше нет.

`CalculatorItem` дополняется `paymentId`, `orderId` становится `string | null`.

### 5.2 Сборщик (`src/lib/services/commission/statement.ts`) — переписать выборку

Удаляем: `buildOrdersWhere`, `getTrigger`, `getVatMode`, `resolveRatesAndOrgNames`, типы `OrderWithCompany`/`CommissionTrigger`, env `COMMISSION_TRIGGER`/`COMMISSION_VAT_MODE`.

Новый поток `calculateStatementForPartner`:
1. Загрузить партнёра (`commissionRate` для fallback) + всю историю `CommissionRateChange` (asc по `effectiveFrom`).
2. **Выборка платежей (A1, A4):** `Payment` где `paidAt ∈ [periodFrom, periodTo]` И разрешённый-партнёр = `partnerId`, где разрешённый-партнёр = `order?.partnerId ?? organization.partnerId`. Prisma-`where`:
   ```
   paidAt: { gte: periodFrom, lte: periodTo },
   OR: [
     { order: { partnerId } },
     { order: { partnerId: null }, organization: { partnerId } },
     { orderId: null, organization: { partnerId } },
   ]
   ```
   Select узкий: id, amount, paidAt, isRefund, orderId, order{orderNumber, partnerId}, organization{name, partnerId}. (НДС-поля не нужны — R0.)
3. **Резолв ставки на дату (A5):** чистая `resolveRateAt(changes, paidAt, partnerDefault)`:
   - среди `changes` (asc) взять `newRate` последней с `effectiveFrom ≤ paidAt`;
   - если таких нет → `changes[0]?.oldRate ?? partnerDefault`.
4. Собрать `PaymentForCalc[]` (organizationName = `order?` нет → `organization.name`), вызвать `calculateCommission`.
5. Дальше **без изменений**: вся машинерия draft/supersede/race (C-01/C-05), `updateDraftInPlace`, audit-log, enqueue PDF/XLSX. Меняется только маппинг позиций (`paymentId`, nullable `orderId`).

### 5.3 Схема (`prisma/schema.prisma`) + миграция

`CommissionStatementItem`:
- `orderId String` → `orderId String?` (+ relation optional).
- добавить `paymentId String?` + optional relation `payment Payment? @relation(...)`. Решение в пользу FK-relation: ссылочная целостность полезна, платежи в нормальной эксплуатации не удаляются. (Зеркальной обратной связи на `Payment` не требуется — чтение всегда идёт от позиции к платежу.)
- `@@index([paymentId])`.

Миграция новая, ранее применённые не трогаем (§8 CLAUDE.md). `orderId` уже nullable-совместимо для старых строк (все имели orderId — остаются валидны).

### 5.4 Worker (`src/worker/processors/calculate-monthly-commissions.ts`)

`activePartners`: с `commissionRate > 0` → «партнёры, у кого есть ≥1 платёж в периоде» (при истории ставок текущая ставка 0 ≠ ноль заработка в периоде). Запрос: distinct partnerId из платежей периода через `order.partnerId`/`organization.partnerId`. Остальное (notify, syncLog, continue-on-error) без изменений.

### 5.5 Включение A5 — backdate (`src/lib/services/admin/partners.ts`)

`updatePartner` принимает опциональный `effectiveFrom?: Date`; при создании `CommissionRateChange` пишем его (default `now()`). Без этого правило исторической ставки работает только «с текущего момента» и операционно бесполезно. UI-поле — минимальное (date input), в scope SP-1.

### 5.6 PDF / XLSX (`pdf.ts`, `xlsx.ts`)

Рендер позиций: nullable номер заказа → «—» / «без заказа»; отрицательные строки возвратов отображаются со знаком минус. Заголовок базы — «База (сумма платежа)». Без структурных изменений документа.

### 5.7 A7 — документация

- Шапка `calculator.ts`/`statement.ts`: формула базы (платежи−возвраты, **НДС не вычитается** — решение владельца 2026-06-26, ставка на дату, период по `paidAt`) со ссылкой §9.2; упоминание, что A6/§9.5 — в SP-2.
- `CHANGELOG.md` `[Unreleased]`: запись о смене модели расчёта (привязка §9.2/§9.5), с предупреждением о поведенческом изменении сумм.

## 6. Обработка ошибок

- Result-контракт сервиса не меняется (функция и так бросает доменные `Error` строки `PARTNER_NOT_FOUND`/`PERIOD_OVERLAP` — сохраняем; это не route-handler).
- enqueue PDF/XLSX и notify — best-effort (graceful degrade, §3 CLAUDE.md), как сейчас.
- Платёж с разрешённым-партнёром = null молча исключается из выборки (нет партнёра — нечего начислять), как и сегодня для заказов без `partnerId`.

## 7. Тестовая стратегия

**Unit (`calculator`)** — без Postgres:
- A1: полная оплата; частичная оплата; несколько платежей по одному заказу (несколько строк).
- A2: частичный возврат уменьшает базу; полный возврат обнуляет вклад заказа; отрицательный нетто-месяц → `totalCommissionAmount = 0`, отрицательные строки сохранены.
- R0 (НДС): платёж 100000 со ставкой 20% → комиссия 20000 **независимо** от `vatAmount`/`vatIncluded` (НДС не вычитается).
- A5: смена ставки 15-го → платежи до/после разными ставками; fallback до первой записи.
- Денежная точность (HALF_UP, Σ строк = итог при отсутствии зажима).

**Integration (`statement`, живой PG)** — самообнаружение по `new PrismaClient(` (§6):
- Выборка по `paidAt` (заявка 31 марта, оплата 2 апреля → апрель). A4.
- Разрешённый-партнёр: платёж по заказу vs платёж без заказа (org-level). A1.
- supersede/draft/race инварианты сохранены (регресс существующих тестов).
- worker: партнёр с текущей ставкой 0, но платежами в периоде по исторической ставке — попадает в расчёт.

**Регресс:** существующие commission-тесты переписываются под платёжную модель (ожидания на `totalAmount` больше не валидны).

## 8. План отгрузки (вход в writing-plans)

Порядок (TDD, subagent-driven по §8):
1. Миграция схемы (`orderId` nullable + `paymentId` + index) → `prisma:generate`.
2. `calculator.ts` (тесты A1, A2, R0/НДС, A5-math, R2 первыми).
3. `resolveRateAt` + переписанная выборка в `statement.ts` (integration A4/A1).
4. Worker `activePartners`.
5. `updatePartner` backdate `effectiveFrom`.
6. PDF/XLSX рендер.
7. A7 (доки + CHANGELOG).

## 9. Открытые вопросы

- ~~R2~~ подтверждён владельцем 2026-06-26. ~~R0 (НДС)~~ решён владельцем 2026-06-26.
- Судьба `Organization.partnerCommissionRate` и `partner/rateOverride.ts` (мёртвый код после исключения из формулы) — владелец решил: **в SP-1 не трогаем**, отдельное решение позже.
