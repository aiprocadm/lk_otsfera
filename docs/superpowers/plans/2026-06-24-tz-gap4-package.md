# Пакет мелких пробелов ТЗ (gap #4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 4 мелких пробела ТЗ одним PR: лимит файла 200 МБ из единого источника (§11), формат `.doc` (§13), история ставок комиссии с датами (§9.1), поля оплаты НДС/назначение/№ поручения/кто внёс (§7.1).

**Architecture:** Аддитивно, без переделок. Единый client-safe модуль `config/upload.ts` заменяет 7 хардкодов лимита. Новая таблица `CommissionRateChange` (append-only в существующих транзакциях `admin/partners`). 4 nullable-поля в `Payment`, пишутся в единственном write-сайте `oneCSync/writers.ts`. Контракты §3/§10/commission-calc не меняются.

**Tech Stack:** Next.js 15 / Prisma 5 / Vitest. Spec: [docs/superpowers/specs/2026-06-24-tz-gap4-package-design.md](docs/superpowers/specs/2026-06-24-tz-gap4-package-design.md).

**Branch:** `claude/tz-gap4-package` (от свежего main).

---

## Под-пакет A+B — лимит файла + форматы (§11, §13)

### Task 1: Единый модуль конфигурации загрузки

**Files:**
- Create: `src/lib/config/upload.ts`
- Test: `src/__tests__/config.upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveMaxFileSizeMb, maxFileSizeBytes, DEFAULT_MAX_FILE_SIZE_MB, ALLOWED_MIME_TYPES } from '@/lib/config/upload';

const ORIG = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
afterEach(() => { if (ORIG === undefined) delete process.env.DOCUMENT_MAX_FILE_SIZE_MB; else process.env.DOCUMENT_MAX_FILE_SIZE_MB = ORIG; });

describe('config/upload', () => {
  it('defaults to 200 MB (§11)', () => {
    delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
    expect(DEFAULT_MAX_FILE_SIZE_MB).toBe(200);
    expect(resolveMaxFileSizeMb()).toBe(200);
    expect(maxFileSizeBytes()).toBe(200 * 1024 * 1024);
  });
  it('honors a valid env override', () => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = '50';
    expect(resolveMaxFileSizeMb()).toBe(50);
  });
  it.each(['0', '-5', 'abc', ''])('falls back to default on invalid env %s', (v) => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = v;
    expect(resolveMaxFileSizeMb()).toBe(DEFAULT_MAX_FILE_SIZE_MB);
  });
  it('allow-list includes .doc and .docx (§13)', () => {
    expect(ALLOWED_MIME_TYPES.has('application/msword')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- config.upload` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/config/upload.ts — client-safe (no 'server-only', no secrets)
/** §11 ТЗ: максимальный размер пользовательского документа. */
export const DEFAULT_MAX_FILE_SIZE_MB = 200;

/** Server-side: env-override с валидацией; невалид/0/NaN → дефолт. */
export function resolveMaxFileSizeMb(): number {
  const raw = Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_SIZE_MB;
}

export function maxFileSizeBytes(): number {
  return resolveMaxFileSizeMb() * 1024 * 1024;
}

/** §13 ТЗ: единый allow-list MIME для загрузки документов. */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword', // .doc (legacy, §13)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);
```

- [ ] **Step 4: Run to verify it passes** — `npm run test:unit -- config.upload` → PASS.

- [ ] **Step 5: Commit** — `feat(config): single source for upload size limit (200MB §11) + formats (§13)`

---

### Task 2: Подключить config в upload-core + route, удалить хардкоды

**Files:**
- Modify: `src/lib/services/documents/upload-core.ts:17-26` (удалить локальные `MAX_FILE_SIZE_BYTES`, `ALLOWED_MIME_TYPES`)
- Modify: `src/app/api/documents/upload/route.ts:24-34` (использовать `resolveMaxFileSizeMb`/`maxFileSizeBytes`)
- Test: `src/__tests__/services.documents.upload-core.unit.test.ts` (новый или дополнить существующий)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateUploadFile } from '@/lib/services/documents/upload-core';

const buf = (sig: number[], pad = 8) => Buffer.from([...sig, ...Array(Math.max(0, pad - sig.length)).fill(0)]);

describe('validateUploadFile — config-driven (§11/§13)', () => {
  it('accepts a .doc (msword) within limit', () => {
    // .doc has no magic-byte entry → skipped; allow-list governs
    const r = validateUploadFile({ size: 1024, mimeType: 'application/msword', buffer: buf([0xd0, 0xcf]) });
    expect(r.ok).toBe(true);
  });
  it('rejects file above 200MB', () => {
    const r = validateUploadFile({ size: 201 * 1024 * 1024, mimeType: 'application/pdf', buffer: buf([0x25,0x50,0x44,0x46]) });
    expect(r).toEqual({ ok: false, error: 'too_large' });
  });
  it('rejects disallowed mime', () => {
    const r = validateUploadFile({ size: 10, mimeType: 'application/x-msdownload', buffer: buf([0x4d,0x5a]) });
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — current limit is 20MB so the 201MB test fails differently / msword rejected. Confirm FAIL.

- [ ] **Step 3: Implement**

In `upload-core.ts`: delete lines 17-26 (local `MAX_FILE_SIZE_BYTES` + `ALLOWED_MIME_TYPES`), add import:
```ts
import { maxFileSizeBytes, ALLOWED_MIME_TYPES } from '@/lib/config/upload';
```
Update `validateUploadFile`:
```ts
  if (file.size > maxFileSizeBytes()) return { ok: false, error: 'too_large' };
  if (!ALLOWED_MIME_TYPES.has(file.mimeType)) return { ok: false, error: 'invalid_mime' };
```
In `route.ts`: replace local `DEFAULT_MAX_FILE_SIZE_MB`/parse block (lines 24-34) with:
```ts
import { resolveMaxFileSizeMb, maxFileSizeBytes } from '@/lib/config/upload';
const MAX_FILE_SIZE_MB = resolveMaxFileSizeMb();
const MAX_FILE_SIZE_BYTES = maxFileSizeBytes();
```
(Keep the `FILE_TOO_LARGE` response message referencing `MAX_FILE_SIZE_MB`.)

- [ ] **Step 4: Run to verify** — `npm run test:unit -- upload-core` → PASS. Also `npm run typecheck`.

- [ ] **Step 5: Commit** — `refactor(documents): drive size/mime from config/upload (drop hardcodes)`

---

### Task 3: Клиентские лейблы + сообщение об ошибке

**Files:**
- Modify: `src/components/partner/lead-attachment-dropzone.tsx:20` (default `maxSizeMb`)
- Modify: `src/components/organization/organization-document-upload-form.tsx:83`, `organization-order-less-upload-form.tsx:86` (лейбл)
- Modify: `src/lib/errors/messages.ts:14` (too_large)

- [ ] **Step 1: Implement** (UI-строки; покрываются typecheck/lint, отдельный unit не нужен)

`lead-attachment-dropzone.tsx`:
```tsx
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
// ...
export function LeadAttachmentDropzone({ leadId, maxSizeMb = DEFAULT_MAX_FILE_SIZE_MB }: Props) {
```
org upload forms — заменить `Максимум 20 МБ.` на `Максимум ${DEFAULT_MAX_FILE_SIZE_MB} МБ.` (импортировать константу; компоненты уже client).
`messages.ts:14`:
```ts
  too_large: 'Файл превышает допустимый размер.',
```

- [ ] **Step 2: Run** — `npm run typecheck && npm run lint`.

- [ ] **Step 3: Commit** — `feat(ui): file-size labels from config; drop hardcoded 20MB`

---

### Task 4: Документация и env

**Files:**
- Modify: `.env.example:32` (комментарий/значение), `README.md:44`, `CLAUDE.md:173`, `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Implement**
  - `README.md:44` — диапазон `1..200`, дефолт `200`.
  - `CLAUDE.md:173` — «size check (200 МБ)».
  - `CHANGELOG.md` — в `[Unreleased]`: «Лимит загрузки документов поднят до 200 МБ (§11), единый источник; добавлен формат .doc (§13)».
  - `.env.example:32` — комментарий «по умолчанию 200».

- [ ] **Step 2: Commit** — `docs: bump document size limit to 200MB across docs`

---

## Под-пакет C — история ставок комиссии (§9.1)

### Task 5: Модель CommissionRateChange + миграция

**Files:**
- Modify: `prisma/schema.prisma` (новая модель + relation в `Partner`)
- Migration: `prisma/migrations/<ts>_commission_rate_history/migration.sql`

- [ ] **Step 1: Add model to schema.prisma** (рядом с `Partner`)

```prisma
model CommissionRateChange {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())
  partnerId     String
  partner       Partner  @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  oldRate       Decimal? @db.Decimal(6, 4)
  newRate       Decimal  @db.Decimal(6, 4)
  effectiveFrom DateTime @default(now())
  changedById   String?

  @@index([partnerId, effectiveFrom])
}
```
В `Partner` добавить: `commissionRateChanges CommissionRateChange[]`.

- [ ] **Step 2: Generate migration (НЕ `migrate dev`)**

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/diff.sql
# Корректный путь проекта: создать каталог миграции и положить сгенерированный ALTER/CREATE,
# затем `npx prisma migrate deploy`. Реюз паттерна из sub-project #1 (см. -DONE.md gotcha).
npm run prisma:generate
```
Ожидаемый SQL: `CREATE TABLE "CommissionRateChange" (...)` + индекс. Аддитивно.

- [ ] **Step 3: Run** — `npm run typecheck` (Prisma-клиент знает новую модель).

- [ ] **Step 4: Commit** — `feat(commission): CommissionRateChange model + migration (§9.1)`

---

### Task 6: Запись истории при смене ставки

**Files:**
- Modify: `src/lib/services/admin/partners.ts` (`updatePartner`, `createPartnerWithAdmin`)
- Test: `src/__tests__/services.admin.partners.test.ts` (дополнить)

- [ ] **Step 1: Write failing test** (integration — файл уже использует PrismaClient)

```ts
it('records a CommissionRateChange row only when the rate actually changes', async () => {
  const partner = await prisma.partner.create({ data: { name: 'P', slug: 'p-hist', commissionRate: new Prisma.Decimal('0.1') } });
  // смена только имени → истории нет
  await updatePartner(prisma, actorId, partner.id, { name: 'P2' });
  expect(await prisma.commissionRateChange.count({ where: { partnerId: partner.id } })).toBe(0);
  // смена ставки → одна строка с old=0.1,new=0.2
  await updatePartner(prisma, actorId, partner.id, { commissionRate: 0.2 });
  const rows = await prisma.commissionRateChange.findMany({ where: { partnerId: partner.id } });
  expect(rows).toHaveLength(1);
  expect(Number(rows[0].oldRate)).toBe(0.1);
  expect(Number(rows[0].newRate)).toBe(0.2);
  expect(rows[0].changedById).toBe(actorId);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — в `updatePartner` внутри `$transaction`, после `tx.partner.update`, если `args.commissionRate !== undefined` и нормализованное новое значение `!=` `before.commissionRate`:
```ts
const newDec = args.commissionRate === null ? new Prisma.Decimal(0) : new Prisma.Decimal(args.commissionRate);
if (!newDec.equals(before.commissionRate ?? new Prisma.Decimal(0))) {
  await tx.commissionRateChange.create({
    data: { partnerId: id, oldRate: before.commissionRate ?? null, newRate: newDec, changedById: actorUserId },
  });
}
```
В `createPartnerWithAdmin` — если стартовая ставка `!= 0`, создать строку с `oldRate: null, newRate: <rate>, changedById: actorUserId` тем же `tx`.

- [ ] **Step 4: Run** — integration-тест зелёный (нужен живой PG; иначе отметить как L3-долг).

- [ ] **Step 5: Commit** — `feat(commission): append rate history on partner rate change (§9.1)`

---

### Task 7: Сервис чтения истории + admin UI

**Files:**
- Create: `src/lib/services/commission/rateHistory.ts`
- Modify: барель `src/lib/services/commission/` если есть; иначе прямой импорт
- Modify: `src/app/admin/partners/[id]/page.tsx` (+ компонент таблицы)
- Test: `src/__tests__/services.commission.rateHistory.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('returns rate history newest-first for admin; denies non-admin', async () => {
  const adminS = { role: 'admin' } as SessionPayload;
  const userS = { role: 'partner' } as SessionPayload;
  const denied = await listRateHistory(prisma, userS, partnerId);
  expect(denied).toEqual({ ok: false, error: 'forbidden' });
  const ok = await listRateHistory(prisma, adminS, partnerId);
  expect(ok.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
// rateHistory.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/session';
export type RateHistoryRow = { id: string; oldRate: number | null; newRate: number; effectiveFrom: Date; changedByName: string | null };
export async function listRateHistory(prisma: PrismaClient, session: SessionPayload, partnerId: string):
  Promise<{ ok: true; rows: RateHistoryRow[] } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const changes = await prisma.commissionRateChange.findMany({ where: { partnerId }, orderBy: { effectiveFrom: 'desc' } });
  // resolve changedBy names in one query
  const ids = [...new Set(changes.map((c) => c.changedById).filter(Boolean) as string[])];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return { ok: true, rows: changes.map((c) => ({ id: c.id, oldRate: c.oldRate ? Number(c.oldRate) : null, newRate: Number(c.newRate), effectiveFrom: c.effectiveFrom, changedByName: c.changedById ? nameById.get(c.changedById) ?? null : null })) };
}
```
UI: на `/admin/partners/[id]` — секция «История ставок комиссии», таблица (Дата · Было · Стало · Кто). Только `ui/`-примитивы; ставка как процент. Page-гард admin уже есть.

- [ ] **Step 4: Run** — unit/integration зелёные, typecheck/lint.

- [ ] **Step 5: Commit** — `feat(admin): commission rate history table on partner page (§9.1)`

---

## Под-пакет D — поля оплаты (§7.1)

### Task 8: Поля Payment + миграция

**Files:**
- Modify: `prisma/schema.prisma` (`Payment` + back-relation в `User`)
- Migration: `prisma/migrations/<ts>_payment_fields/migration.sql`

- [ ] **Step 1: Add fields** в `Payment`:
```prisma
  vatAmount          Decimal?  @db.Decimal(14, 2)
  purpose            String?
  paymentOrderNumber String?
  enteredById        String?
  enteredBy          User?     @relation("PaymentEnteredBy", fields: [enteredById], references: [id])
```
В `User` добавить: `paymentsEntered Payment[] @relation("PaymentEnteredBy")`.

- [ ] **Step 2: Migration** (тот же `migrate diff`→`deploy` путь, что Task 5) + `npm run prisma:generate`. Все колонки nullable → backward-safe.

- [ ] **Step 3: Run** — `npm run typecheck`.

- [ ] **Step 4: Commit** — `feat(payments): add VAT/purpose/order-number/enteredBy fields (§7.1)`

---

### Task 9: Запись новых полей через writers + DTO/mappers/column-map

**Files:**
- Modify: `src/lib/services/oneCSync/schemas.ts` (payment schema — опц. поля)
- Modify: `src/lib/services/oneCSync/mappers.ts`, `src/lib/services/import/column-map.ts`
- Modify: `src/lib/services/oneCSync/writers.ts:93`
- Test: `src/__tests__/oneCSync.writers.test.ts` (дополнить)

- [ ] **Step 1: Write failing test** — writers пишет новые поля:
```ts
it('persists vatAmount/purpose/paymentOrderNumber on payment.create', async () => {
  // arrange DTO с новыми полями, act writePayment, assert payment.create called with objectContaining({ vatAmount, purpose, paymentOrderNumber })
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**
  - `schemas.ts`: в payment-схему добавить `vatAmount: z.number().nullish()`, `purpose: z.string().nullish()`, `paymentOrderNumber: z.string().nullish()`.
  - `column-map.ts` `PAYMENT_COLS`: добавить опц. `vat: 'НДС'`, `paymentOrderNumber: '№ платёжного поручения'` (purpose уже = `note: 'Назначение платежа'`).
  - `mappers.ts`: прокинуть новые поля; `purpose` = значение колонки «Назначение платежа» (то же, что note).
  - `writers.ts:93` `payment.create`: в `data` добавить `vatAmount`, `purpose`, `paymentOrderNumber`, `enteredById` (из `ctx.actorUserId` для file-import, иначе null).

- [ ] **Step 4: Run** — `npm run test:unit -- oneCSync.writers` + guardrail `import.no-second-writer` зелёные; typecheck.

- [ ] **Step 5: Commit** — `feat(payments): map new fields through DTO→writers (§7.1)`

---

### Task 10: Леджер платежей — DTO + UI

**Files:**
- Modify: `src/lib/services/organization/finance.ts` (payment DTO + select)
- Modify: `src/lib/services/manager/finance*` (sibling DTO)
- Modify: соответствующие компоненты таблицы платежей (org + manager)
- Test: `src/__tests__/services.organization.finance.test.ts` (дополнить)

- [ ] **Step 1: Write failing test** — DTO леджера отдаёт новые поля:
```ts
it('payment ledger row exposes vatAmount/purpose/paymentOrderNumber/enteredBy', async () => {
  // seed payment с полями → listOrgPayments → assert row has fields (Decimal → string)
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — расширить `select` и row-DTO (Decimal `vatAmount` → строка `.toFixed(2)` на границе RSC; `enteredBy` → имя через relation). Добавить колонки в таблицы (org + manager sibling). Scope не меняется.

- [ ] **Step 4: Run** — integration + typecheck/lint.

- [ ] **Step 5: Commit** — `feat(finance): show new payment fields in ledger (§7.1)`

---

## Финал

- [ ] **Гейты:** `npm run typecheck && npm run lint && npm run test:unit`; integration где есть PG (иначе L3-долг отметить в close-out).
- [ ] **Close-out:** `docs/superpowers/plans/2026-06-24-tz-gap4-package-DONE.md`.
- [ ] **PR** в main.

## Self-review (покрытие spec)

- §11 лимит 200МБ единый источник → Task 1,2,3,4 ✓
- §13 формат .doc → Task 1 (allow-list), Task 2 (accept-тест) ✓ (полный список — ASSUMPTION, помечено)
- §9.1 история ставок → Task 5 (модель), 6 (запись), 7 (чтение+UI) ✓
- §7.1 поля оплаты → Task 8 (модель), 9 (запись), 10 (леджер UI) ✓
- Контракты не меняются; payment write остаётся single-writer (guardrail) ✓
