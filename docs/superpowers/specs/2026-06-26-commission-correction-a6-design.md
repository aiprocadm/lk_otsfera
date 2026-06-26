# Корректировка возврат-после-выплаты — ТЗ §9.5 (SP-2: A6)

**Дата:** 2026-06-26
**Статус:** дизайн на ревью
**Трек:** Track A — корректность расчёта комиссии (P0). Продолжение SP-1.
**Scope:** SP-2 = A6 (§9.5). Зависит от SP-1 ([PR #157](https://github.com/aiprocadm/lk_otsfera/pull/157)) — платёжная модель, строка ведомости = позиция.

## 1. Проблема

После SP-1 возвраты учитываются как отрицательные строки **только внутри ещё открытого периода**. Если возврат приходит позже, когда ведомость за его период уже `approved`/`paid`:
- месячный крон считает только платежи с `paidAt` в текущем периоде → поздний возврат **никогда не попадёт** ни в одну ведомость (потеря удержания);
- «тихо» пересчитать закрытый период нельзя (§9.5): для `paid` это запрещено, `supersededBy` нельзя использовать для правки выплаченного.

**Канон §9.5:** поздний возврат не пересчитывает закрытый период вживую, а формирует **корректировку, переносимую в следующий период** (отрицательная позиция), с причиной и сохранением в истории. Решение по каждой корректировке — **ручное** (admin/leader).

## 2. Решения владельца (зафиксированы 2026-06-26)

1. **«Закрытый» период = статус `approved` ИЛИ `paid`** (живая, не superseded ведомость). Для `draft` возврат втягивается обычной отрицательной строкой (SP-1, пересчёт разрешён).
2. **Авто-детект → очередь `needs_review` → ручной resolve** admin/leader (паттерн card-51 `PaymentImportRow`).
3. **Решения по корректировке: Применить / Списать (waive)**, причина обязательна; оба — в audit/историю.
4. **Остаток переносится** (цепочка): если удержание увело payout в минус и сработал зажим в 0 — непокрытый остаток авто-переносится в следующий период (не теряется).
5. **Очередь видят admin + leader** (leader — в рамках своей компании).

## 3. Архитектура

Переиспользуем «строка ведомости = одна позиция» из SP-1: корректировка попадает в будущую ведомость как **строка с `correctionId`** (отрицательная комиссия). Рендер PDF/XLSX/итоги работают без изменений.

«Применено/перенесено» определяется **не флагом**, а наличием строки корректировки в живой `approved`/`paid` ведомости — это естественно обрабатывает пересчёт draft'а и supersede (корректировка «следует» за новой ведомостью).

Направление зависимостей (§2 CLAUDE.md): UI → server-actions → `commission/corrections.ts` + `commission/statement.ts` → `commission/calculator.ts` (чистый). Детект — в воркере + ручной триггер.

## 4. Модель данных

### 4.1 `CommissionCorrection` (новая)

```prisma
model CommissionCorrection {
  id                  String   @id @default(cuid())
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  partnerId           String
  partner             Partner  @relation(fields: [partnerId], references: [id])
  // Поздний возврат-триггер. @unique → идемпотентность детекта.
  // null допустим для синтетического остатка-цепочки (Postgres: несколько null ок).
  paymentId           String?  @unique
  payment             Payment? @relation(fields: [paymentId], references: [id])
  originalStatementId String?  // закрытая ведомость периода возврата (трассировка)
  originalPeriodFrom  DateTime
  originalPeriodTo    DateTime
  amount              Decimal  @db.Decimal(14, 2) // сумма возврата (положительная)
  rate                Decimal  @db.Decimal(6, 4)  // ставка на paidAt возврата (resolveRateAt)
  commissionAmount    Decimal  @db.Decimal(14, 2) // удержание = amount × rate (положит. величина)
  status              String   @default("needs_review") // needs_review | applied | waived
  reason              String?
  resolvedByUserId    String?
  resolvedAt          DateTime?
  parentCorrectionId  String?  // звено цепочки-остатка (§2.4)
  carriedReason       String?  // «перенос остатка из <id>» для синтетических
  appliedInStatementId String? // снимок: куда финально перенесена (set при approve, §6)

  @@index([partnerId, status])
  @@index([status, createdAt])
}
```

### 4.2 `CommissionStatementItem.correctionId`

Добавить `correctionId String?` + relation `correction CommissionCorrection?` + `@@index([correctionId])` (миграция — как `paymentId` в SP-1). Строка-корректировка: `paymentId=null`, `orderId=null`, `correctionId` set, `baseAmount<0`, `commissionAmount<0`.

Back-relations на `Partner`, `Payment`, `CommissionCorrection`.

## 5. Детект (`commission/corrections.ts` → `detectLateRefundCorrections`)

Запускается: (а) шаг в месячном кроне `calculate-monthly-commissions` перед расчётом; (б) ручной admin-триггер «Сканировать корректировки».

Алгоритм (идемпотентный):
1. Найти `Payment{isRefund=true}`, у которых ещё нет `CommissionCorrection` (по `paymentId @unique`).
2. Для каждого: найти **живую** (`supersededBy=null`) ведомость партнёра со `status ∈ {approved, paid}`, чей `[periodFrom, periodTo]` покрывает `paidAt` возврата. Партнёр возврата = `order?.partnerId ?? organization.partnerId`.
3. Если такая ведомость есть → создать `CommissionCorrection{status: needs_review, amount, rate=resolveRateAt(paidAt), commissionAmount=round(amount×rate), originalStatementId, originalPeriod*}`.
4. Если возврат попадает в `draft`-период или период без ведомости → **не** создаём (это обычная строка SP-1).

## 6. Resolve + перенос

### 6.1 Resolve (`resolveCorrection`, server-action, RBAC admin/leader)
- **Применить:** `status: needs_review → applied`, `resolvedBy/At`. Требует, чтобы запись была `needs_review`.
- **Списать:** `status: needs_review → waived`, `reason` обязателен, `resolvedBy/At`. В выплату не идёт.
- Leader-scope: только корректировки партнёров, чьи организации принадлежат компании leader-а (consistent с C1). Admin — все. RBAC defense-in-depth (§4 CLAUDE.md): middleware-префикс + server-action guard + сервис-фильтр по scope.

### 6.2 Перенос в ведомость (`statement.ts`)
При формировании **draft**: после строк-платежей добавить строки-корректировки — `applied`-корректировки партнёра, ещё **не представленные** строкой в живой `approved`/`paid` ведомости (`NOT EXISTS item.correctionId in {approved,paid, supersededBy=null}`). Строка: `baseAmount = -amount`, `rate`, `commissionAmount = -commissionAmount`, `correctionId`.

Калькулятор расширяется: `calculateCommission(payments, corrections?)`. `CorrectionForCalc` несёт **уже посчитанные** величины (не пересчитываются из amount×rate — иначе синтетический остаток-цепочка с rate=0 дал бы 0): `{ correctionId, organizationName('Корректировка §9.5'), baseAmount (отрицательный), rate (для отображения), commissionAmount (отрицательный) }`. Калькулятор складывает их в `items` (с `correctionId`, `paymentId=null`, `orderId=null`) и в итоги — централизованно зажим R2/averageRate. `CalculatorItem` получает `correctionId: string | null`. statement.ts формирует эти величины из записи: `baseAmount = -correction.amount`, `commissionAmount = -correction.commissionAmount`.

Draft пересчитывается свободно (чистое чтение, без записи корректировок).

### 6.3 Цепочка остатка — при **approve** (`lifecycle.approveStatement`)
Запись остатка делается в момент финализации (approve), не на каждом пересчёте draft'а (идемпотентность):
- При approve ведомости, содержащей строки-корректировки: если payout был зажат (Σ платежей < Σ удержаний), вычислить непокрытый остаток `R = Σудержаний − Σплатежей`.
- Создать синтетическую `CommissionCorrection{ paymentId:null, status:applied, commissionAmount:R, amount:R, rate: (n/a, 0), parentCorrectionId, carriedReason }` → она попадёт строкой в следующий draft. Так удержание не теряется.
- `appliedInStatementId` проставляется перенесённым корректировкам (снимок «куда село»).

(`waived` и не-перенесённые — не трогаются.)

## 7. UI (Фаза 2)

Очередь корректировок: `/admin/commission-corrections` (admin) и в `/leader` (leader, company-scoped). Список `needs_review` с суммой/периодом/партнёром/возвратом; действия **Применить** / **Списать** через `Dialog` (причина) — переиспользуем resolve-паттерн card-51 ([resolve-picker]). Партнёр видит строки-корректировки в своей ведомости (организация-метка «Корректировка §9.5» + причина). Гейтинг flag — переиспользуем существующий (комиссия видна партнёр/руководитель/админ).

## 8. Обработка ошибок

- Result/throw-контракт как в commission (`NOT_FOUND`, `LIFECYCLE_VIOLATION`, `forbidden`).
- Детект best-effort в кроне (graceful degrade, §3): падение детекта не валит месячный батч — лог + syncLog.
- Идемпотентность детекта по `paymentId @unique` (повторный скан не плодит дубли; гонка → P2002 проглатывается).

## 9. Тестовая стратегия

**Unit (calculator):** correction-строки складываются в отрицательную комиссию; зажим R2 при удержании > платежей; averageRate guard.
**Unit (corrections.ts, mocked prisma):** детект — возврат в paid-период → needs_review; возврат в draft-период → НЕ создаёт; идемпотентность (повторный скан 0 новых); resolve apply/waive переходы + reason-обязателен; leader-scope фильтр.
**Integration (live PG):** полный сценарий — платёж в апреле → ведомость paid → возврат с `paidAt` в апреле приходит в мае → детект создаёт needs_review → admin Применить → майская ведомость получает отрицательную строку; зажим+цепочка (остаток → новая applied → июньская ведомость); waive не удерживает.
**RBAC:** admin видит все, leader — только свою компанию, partner — нет доступа к очереди.

## 10. Декомпозиция плана

- **Фаза 1 (backend):** схема (`CommissionCorrection` + `item.correctionId` + миграция) → calculator (correction-строки) → `corrections.ts` (detect/resolve) → `statement.ts` (перенос) → `lifecycle.approveStatement` (цепочка) → worker (детект-шаг). TDD.
- **Фаза 2 (UI):** очередь admin + leader, resolve-Dialog, партнёрский рендер строки.

## 11. Открытые вопросы

- Точная привязка leader→партнёры (через `Organization.companyId` партнёрских оргов) — уточнить на этапе плана; не блокер дизайна.
- `appliedInStatementId` как снимок vs чистая item-линковка — оставить оба (item-линковка ведёт перенос, снимок — для отчётности); не дублирование, а разные цели.
