# 1C File-Import Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins/leaders/managers import organizations, orders and payments from a 1C Excel export so partner/organization finance views show real payment data — without the live 1C REST adapter.

**Architecture:** New `src/lib/services/import/` pipeline: parse `.xlsx` (exceljs) → zod-validate → dry-run plan with per-row RBAC scope decisions → transactional upsert (org→order→payment, reusing `oneCSync` mappers). Payments become org-level (`Payment.organizationId`, `orderId` nullable). Entry pages `/manager/import` (scoped to own orgs) + `/admin/import` (mirror).

**Tech Stack:** Next.js 15 server components + server actions, Prisma 5, zod, exceljs, Vitest.

**Spec:** [2026-06-09-1c-file-import-design.md](../specs/2026-06-09-1c-file-import-design.md)

**Branch:** `claude/1c-file-import` (already created from `origin/main`).

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `prisma/schema.prisma` | M1–M5 schema changes | Modify |
| `prisma/migrations/*` | Generated migrations + backfill SQL | New |
| `src/lib/services/import/types.ts` | File-DTO types, `ImportPlan`, `RowDecision`, counts | New |
| `src/lib/services/import/column-map.ts` | Russian sheet headers → DTO fields + upsert keys (**sample-locked**) | New |
| `src/lib/services/import/validate.ts` | zod schemas for org/order/payment file rows + quarantine | New |
| `src/lib/services/import/parse-workbook.ts` | exceljs workbook → raw rows per sheet | New |
| `src/lib/services/import/plan-import.ts` | dry-run: key resolution + actor scope filter → `ImportPlan` | New |
| `src/lib/services/import/commit-import.ts` | transactional upsert + audit | New |
| `src/lib/services/import/index.ts` | `previewImport()` / `commitImport()` Result-contract | New |
| `src/lib/services/import/payment-mapper.ts` | org-level payment row → upsert input | New |
| `src/lib/auth/audit.ts` | add `'payment'`, `'one_c_import'` to `AuditEntity` | Modify |
| `src/lib/services/organization/finance.ts:45` | payment read → `where: { organizationId }` | Modify |
| `src/lib/services/organization/dashboard.ts:169` | payment read → org-level | Modify |
| `src/lib/services/partner/dashboard.ts:205` | payment read → `where: { organization: { partnerId } }` | Modify |
| `src/lib/services/manager/dashboard/events.ts:42` | payment read → org-scope | Modify |
| `src/lib/navigation/cabinet.ts` | nav item «Загрузка из 1С» (manager + admin) | Modify |
| `src/app/manager/import/page.tsx` | manager entry (server, `requireManager`) | New |
| `src/app/admin/import/page.tsx` | admin mirror (`requireAdmin`) | New |
| `src/components/import/import-form.tsx` | client upload + preview + confirm UI | New |
| `src/server-actions/import.ts` | `previewImportAction` / `commitImportAction` | New |

---

## Phase 0 — Migrations

### Task 0.1: Schema changes M1–M3, M5

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `src/__tests__/schema.payment.test.ts` (extend existing)

- [ ] **Step 1: Write the failing schema test**

Add to `src/__tests__/schema.payment.test.ts`:

```ts
import { PrismaClient } from '@prisma/client';

it('Payment is org-level: organizationId required, orderId optional', async () => {
  const prisma = new PrismaClient();
  // dmmf reflects schema; orderId must be nullable, organizationId present & required
  const payment = prisma._runtimeDataModel.models.Payment;
  const fields = Object.fromEntries(payment.fields.map((f: any) => [f.name, f]));
  expect(fields.organizationId).toBeDefined();
  expect(fields.organizationId.isRequired).toBe(true);
  expect(fields.orderId.isRequired).toBe(false);
  await prisma.$disconnect();
});
```

> This file contains `new PrismaClient(` → it auto-classifies as an **integration** test (§6 mode-partitioning). It runs under `npm run test:integration` / gate, not pre-push unit.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run prisma:generate && npx vitest run src/__tests__/schema.payment.test.ts --mode=integration`
Expected: FAIL — `organizationId` undefined.

- [ ] **Step 3: Apply schema changes**

In `prisma/schema.prisma`:

```prisma
model Partner {
  // ...existing...
  inn            String?        @unique   // M1
}

model Organization {
  // ...existing...
  inn                            String?            @unique   // M5 (was non-unique)
  partnerId                      String?                        // M2 (was required)
  partner                        Partner?           @relation(fields: [partnerId], references: [id])  // now optional
}

model Payment {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organizationId String                                         // M3 (new, required)
  organization   Organization @relation(fields: [organizationId], references: [id])
  orderId        String?                                        // M3 (now nullable)
  order          Order?   @relation(fields: [orderId], references: [id])
  externalId     String?  @unique
  amount         Decimal  @db.Decimal(14, 2)
  paidAt         DateTime
  method         String?
  isRefund       Boolean  @default(false)
  note           String?

  @@index([orderId])
  @@index([organizationId])
  @@index([paidAt])
  @@index([externalId])
}
```

Add the reverse relation on `Organization`: `payments Payment[]` (mirror the existing `orders` relation style).

- [ ] **Step 4: Create migration with backfill (M4)**

Run: `npm run prisma:migrate -- --name org_level_payments_and_inn_keys --create-only`

Then edit the generated migration SQL so `organizationId` is added **nullable first**, backfilled, then set NOT NULL — never drop data:

```sql
-- M3a: add columns nullable
ALTER TABLE "Payment" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;

-- M4: backfill organizationId from the payment's order
UPDATE "Payment" p
SET "organizationId" = o."organizationId"
FROM "Order" o
WHERE p."orderId" = o."id" AND p."organizationId" IS NULL;

-- M3b: enforce NOT NULL after backfill
ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- M1: Partner.inn unique
ALTER TABLE "Partner" ADD COLUMN "inn" TEXT;
CREATE UNIQUE INDEX "Partner_inn_key" ON "Partner"("inn");

-- M2: Organization.partnerId nullable
ALTER TABLE "Organization" ALTER COLUMN "partnerId" DROP NOT NULL;

-- M5: Organization.inn unique (guard: fails loudly if duplicate INNs exist — resolve before deploy)
CREATE UNIQUE INDEX "Organization_inn_key" ON "Organization"("inn");
```

- [ ] **Step 5: Apply + run test to verify pass**

Run: `npm run prisma:migrate && npm run prisma:generate && npx vitest run src/__tests__/schema.payment.test.ts --mode=integration`
Expected: PASS.

- [ ] **Step 6: Verify seed still works (backfill safety)**

Run: `npm run prisma:seed`
Expected: seed completes; existing demo payments get `organizationId` from their order.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/__tests__/schema.payment.test.ts
git commit -m "feat(schema): org-level payments + INN keys (M1-M5)"
```

---

## Phase 1 — Types & column map

### Task 1.1: Import types

**Files:**
- Create: `src/lib/services/import/types.ts`
- Test: none (pure types)

- [ ] **Step 1: Write the types**

```ts
// File-row DTOs (post-validation, pre-upsert)
export type OrgFileRow = { name: string; inn: string; partnerInn: string | null };
export type OrderFileRow = {
  externalId: string; orderNumber: string | null; orgInn: string;
  totalAmount: number; paidAmount: number;
};
export type PaymentFileRow = {
  externalId: string; orgInn: string; amount: number; paidAt: string;
  method: string | null; isRefund: boolean; note: string | null;
};

export type Sheet = 'orgs' | 'orders' | 'payments';
export type Quarantine = { sheet: Sheet; rowIndex: number; reason: string };

export type RowDecision =
  | { action: 'create' | 'update' }
  | { action: 'skip'; reason: string };

export type ImportCounts = {
  orgsCreated: number; orgsUpdated: number; orgsStandalone: number;
  ordersUpserted: number; paymentsUpserted: number;
};
export type SkipReport = {
  orgs: Quarantine[]; orders: Quarantine[]; payments: Quarantine[];
};
export type ImportPlan = {
  counts: ImportCounts;
  skipped: SkipReport;
  quarantine: Quarantine[];
};
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/services/import/types.ts
git commit -m "feat(import): file-DTO and plan types"
```

### Task 1.2: Column map (sample-locked placeholder)

**Files:**
- Create: `src/lib/services/import/column-map.ts`
- Test: `src/__tests__/import.column-map.test.ts`

> **Sample dependency:** header strings below are the spec defaults. When the real export sample arrives, edit ONLY this file. The test asserts the map shape, not specific Russian strings, so it survives header changes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from '@/lib/services/import/column-map';

describe('column-map', () => {
  it('declares the three sheet names', () => {
    expect(SHEET_NAMES.orgs).toBeTruthy();
    expect(SHEET_NAMES.orders).toBeTruthy();
    expect(SHEET_NAMES.payments).toBeTruthy();
  });
  it('maps every DTO field to a header for each sheet', () => {
    expect(ORG_COLS.inn).toBeTruthy();
    expect(ORDER_COLS.externalId).toBeTruthy();
    expect(PAYMENT_COLS.externalId).toBeTruthy();
    expect(PAYMENT_COLS.amount).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fails** — Run: `npm run test:unit -- import.column-map` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// Russian 1C export headers → DTO field names. SAMPLE-LOCKED: confirm against
// the real export before go-live; this is the only file that changes (blast radius = 1).
export const SHEET_NAMES = {
  orgs: 'Контрагенты',
  orders: 'Реализации',
  payments: 'Поступления',
} as const;

export const ORG_COLS = {
  name: 'Наименование',
  inn: 'ИНН',
  partnerInn: 'ИНН партнёра',
} as const;

export const ORDER_COLS = {
  externalId: 'Номер',
  orderNumber: 'Номер',
  orgInn: 'ИНН организации',
  totalAmount: 'Сумма',
  paidAmount: 'Оплачено',
} as const;

export const PAYMENT_COLS = {
  externalId: 'Номер документа',
  orgInn: 'ИНН',
  amount: 'Сумма',
  paidAt: 'Дата',
  method: 'Вид операции',
  note: 'Назначение платежа',
} as const;
```

- [ ] **Step 4: Run to verify pass** — Run: `npm run test:unit -- import.column-map` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/import/column-map.ts src/__tests__/import.column-map.test.ts
git commit -m "feat(import): column map (sample-locked headers)"
```

---

## Phase 2 — Validation

### Task 2.1: Row validation schemas

**Files:**
- Create: `src/lib/services/import/validate.ts`
- Test: `src/__tests__/import.validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateRows } from '@/lib/services/import/validate';

describe('validateRows', () => {
  it('separates valid payment rows from quarantine', () => {
    const raw = [
      { externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: null, isRefund: false, note: 'аванс' },
      { externalId: '', orgInn: '7700', amount: 1000, paidAt: 'garbage', method: null, isRefund: false, note: null },
    ];
    const { valid, quarantine } = validateRows('payments', raw);
    expect(valid).toHaveLength(1);
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0].rowIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fails** → FAIL (module missing).

- [ ] **Step 3: Implement** (reuse the permissive `isoDate` idea from `oneCSync/schemas.ts`)

```ts
import { z } from 'zod';
import type { Sheet, Quarantine } from './types';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime');
const num = z.coerce.number();

const orgSchema = z.object({
  name: z.string().min(1),
  inn: z.string().min(1),
  partnerInn: z.string().nullable().default(null),
});
const orderSchema = z.object({
  externalId: z.string().min(1),
  orderNumber: z.string().nullable().default(null),
  orgInn: z.string().min(1),
  totalAmount: num,
  paidAmount: num,
});
const paymentSchema = z.object({
  externalId: z.string().min(1),
  orgInn: z.string().min(1),
  amount: num,
  paidAt: isoDate,
  method: z.string().nullable().default(null),
  isRefund: z.boolean().default(false),
  note: z.string().nullable().default(null),
});

const SCHEMAS = { orgs: orgSchema, orders: orderSchema, payments: paymentSchema } as const;

export function validateRows(sheet: Sheet, raw: unknown[]) {
  const schema = SCHEMAS[sheet];
  const valid: any[] = [];
  const quarantine: Quarantine[] = [];
  raw.forEach((row, rowIndex) => {
    const r = schema.safeParse(row);
    if (r.success) valid.push(r.data);
    else quarantine.push({ sheet, rowIndex, reason: r.error.issues[0]?.message ?? 'invalid' });
  });
  return { valid, quarantine };
}
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/import/validate.ts src/__tests__/import.validate.test.ts
git commit -m "feat(import): zod row validation + quarantine"
```

---

## Phase 3 — Parsing

### Task 3.1: Workbook parser

**Files:**
- Create: `src/lib/services/import/parse-workbook.ts`
- Test: `src/__tests__/import.parse-workbook.test.ts`

- [ ] **Step 1: Write the failing test** (build a workbook in-memory with exceljs, round-trip parse)

```ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { SHEET_NAMES, PAYMENT_COLS } from '@/lib/services/import/column-map';

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAMES.payments);
  ws.addRow([PAYMENT_COLS.externalId, PAYMENT_COLS.orgInn, PAYMENT_COLS.amount, PAYMENT_COLS.paidAt, PAYMENT_COLS.note]);
  ws.addRow(['PP-1', '7700', 1000, '2026-04-20', 'аванс']);
  return (await wb.xlsx.writeBuffer()) as Buffer;
}

describe('parseWorkbook', () => {
  it('maps headers to DTO fields by column-map', async () => {
    const { payments } = await parseWorkbook(await buildBook());
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ externalId: 'PP-1', orgInn: '7700', amount: 1000, note: 'аванс' });
  });
  it('returns empty arrays for missing sheets without throwing', async () => {
    const { orgs, orders } = await parseWorkbook(await buildBook());
    expect(orgs).toEqual([]);
    expect(orders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fails** → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import ExcelJS from 'exceljs';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from './column-map';

const COLS = { orgs: ORG_COLS, orders: ORDER_COLS, payments: PAYMENT_COLS } as const;

function readSheet(wb: ExcelJS.Workbook, sheetName: string, cols: Record<string, string>): unknown[] {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];
  const header = ws.getRow(1);
  // header label → column number
  const colIndex = new Map<string, number>();
  header.eachCell((cell, col) => colIndex.set(String(cell.value ?? '').trim(), col));
  const fieldToCol = Object.entries(cols).map(([field, label]) => [field, colIndex.get(label)] as const);

  const rows: unknown[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: Record<string, unknown> = {};
    for (const [field, col] of fieldToCol) {
      if (col === undefined) continue;
      const v = row.getCell(col).value;
      obj[field] = v === null || v === undefined ? null : v;
    }
    rows.push(obj);
  }
  return rows;
}

export async function parseWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return {
    orgs: readSheet(wb, SHEET_NAMES.orgs, ORG_COLS),
    orders: readSheet(wb, SHEET_NAMES.orders, ORDER_COLS),
    payments: readSheet(wb, SHEET_NAMES.payments, PAYMENT_COLS),
  };
}
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/import/parse-workbook.ts src/__tests__/import.parse-workbook.test.ts
git commit -m "feat(import): exceljs workbook parser"
```

---

## Phase 4 — Planning with RBAC scope (the heart)

### Task 4.1: Scope helper

**Files:**
- Create: `src/lib/services/import/scope.ts`
- Test: `src/__tests__/import.scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { importScope } from '@/lib/services/import/scope';
import type { SessionPayload } from '@/lib/auth/jwt';

const base = (over: Partial<SessionPayload>): SessionPayload => ({ sub: 'u1', role: 'manager', ...over } as any);

describe('importScope', () => {
  it('admin → unscoped, may create', () => {
    expect(importScope(base({ role: 'admin' }))).toEqual({ unscoped: true, mayCreateOrgs: true });
  });
  it('manager-leader → unscoped, may create', () => {
    expect(importScope(base({ role: 'manager', managerRole: 'leader' }))).toEqual({ unscoped: true, mayCreateOrgs: true });
  });
  it('plain manager → scoped to managedOrgIds, may NOT create', () => {
    const s = importScope(base({ role: 'manager', managedOrgIds: ['o1', 'o2'] }));
    expect(s).toEqual({ unscoped: false, mayCreateOrgs: false, allowedOrgIds: ['o1', 'o2'] });
  });
});
```

- [ ] **Step 2: Run to verify fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, isManagerLeader } from '@/lib/auth/managerPolicy';

export type ImportScope =
  | { unscoped: true; mayCreateOrgs: true }
  | { unscoped: false; mayCreateOrgs: false; allowedOrgIds: string[] };

/** admin & manager-leader = unscoped (all orgs, may create). Plain manager =
 *  scoped to assigned orgs (managedOrgIds), update-only. Write-scope uses
 *  assignment, NOT the C8 company-wide READ flag (see spec). */
export function importScope(session: SessionPayload): ImportScope {
  if (session.role === 'admin' || isManagerLeader(session)) {
    return { unscoped: true, mayCreateOrgs: true };
  }
  return { unscoped: false, mayCreateOrgs: false, allowedOrgIds: managedOrgIds(session) };
}
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/import/scope.ts src/__tests__/import.scope.test.ts
git commit -m "feat(import): actor write-scope resolver"
```

### Task 4.2: Dry-run planner

**Files:**
- Create: `src/lib/services/import/plan-import.ts`
- Test: `src/__tests__/import.plan.test.ts`

Resolves keys against the DB (read-only), applies scope, produces `ImportPlan`. Uses a small lookup interface so unit tests can stub the DB.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { planImport } from '@/lib/services/import/plan-import';

const lookups = {
  orgIdByInn: new Map([['7700', 'org-1']]),       // existing org
  partnerIdByInn: new Map([['5500', 'partner-1']]),
};

describe('planImport', () => {
  it('manager: existing in-scope org updates, out-of-scope org skipped', () => {
    const plan = planImport(
      { orgs: [{ name: 'A', inn: '7700', partnerInn: null }, { name: 'B', inn: '9900', partnerInn: null }], orders: [], payments: [] },
      lookups,
      { unscoped: false, mayCreateOrgs: false, allowedOrgIds: ['org-1'] }
    );
    expect(plan.counts.orgsUpdated).toBe(1);
    expect(plan.skipped.orgs).toHaveLength(1); // '9900' new → manager may not create
    expect(plan.skipped.orgs[0].reason).toMatch(/руководител|зоны/i);
  });

  it('payment for unknown org is skipped', () => {
    const plan = planImport(
      { orgs: [], orders: [], payments: [{ externalId: 'PP-1', orgInn: '0000', amount: 1, paidAt: '2026-01-01', method: null, isRefund: false, note: null }] },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.paymentsUpserted).toBe(0);
    expect(plan.skipped.payments).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify fails** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ImportPlan, OrgFileRow, OrderFileRow, PaymentFileRow } from './types';
import type { ImportScope as Scope } from './scope';

type Lookups = { orgIdByInn: Map<string, string>; partnerIdByInn: Map<string, string> };
type Rows = { orgs: OrgFileRow[]; orders: OrderFileRow[]; payments: PaymentFileRow[] };

const OUT_OF_SCOPE = 'вне вашей зоны видимости';
const NEEDS_LEADER = 'новая организация — требуется руководитель/админ';
const ORG_NOT_FOUND = 'организация не найдена (ИНН не сматчен)';

export function planImport(rows: Rows, lookups: Lookups, scope: Scope): ImportPlan {
  const counts = { orgsCreated: 0, orgsUpdated: 0, orgsStandalone: 0, ordersUpserted: 0, paymentsUpserted: 0 };
  const skipped = { orgs: [] as any[], orders: [] as any[], payments: [] as any[] };

  // Orgs that this import will make writable (existing-in-scope ∪ newly-created)
  const writableInn = new Set<string>();

  rows.orgs.forEach((o, i) => {
    const existingId = lookups.orgIdByInn.get(o.inn);
    const inScope = scope.unscoped || (existingId !== undefined && scope.allowedOrgIds.includes(existingId));
    if (!existingId && !scope.mayCreateOrgs) { skipped.orgs.push({ sheet: 'orgs', rowIndex: i, reason: NEEDS_LEADER }); return; }
    if (existingId && !inScope) { skipped.orgs.push({ sheet: 'orgs', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    if (existingId) counts.orgsUpdated++; else counts.orgsCreated++;
    if (!o.partnerInn || !lookups.partnerIdByInn.get(o.partnerInn)) counts.orgsStandalone++;
    writableInn.add(o.inn);
  });

  // Orders/payments attach by org INN; writable if their org is writable OR already in-scope existing
  const orgWritable = (inn: string) => {
    if (writableInn.has(inn)) return true;
    const id = lookups.orgIdByInn.get(inn);
    return id !== undefined && (scope.unscoped || scope.allowedOrgIds.includes(id));
  };

  rows.orders.forEach((o, i) => {
    if (!lookups.orgIdByInn.get(o.orgInn) && !writableInn.has(o.orgInn)) { skipped.orders.push({ sheet: 'orders', rowIndex: i, reason: ORG_NOT_FOUND }); return; }
    if (!orgWritable(o.orgInn)) { skipped.orders.push({ sheet: 'orders', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    counts.ordersUpserted++;
  });

  rows.payments.forEach((p, i) => {
    if (!lookups.orgIdByInn.get(p.orgInn) && !writableInn.has(p.orgInn)) { skipped.payments.push({ sheet: 'payments', rowIndex: i, reason: ORG_NOT_FOUND }); return; }
    if (!orgWritable(p.orgInn)) { skipped.payments.push({ sheet: 'payments', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    counts.paymentsUpserted++;
  });

  return { counts, skipped, quarantine: [] };
}
```

> Note: `planImport` is a pure function over `Lookups`; the DB read that builds `Lookups` lives in `index.ts` (Task 6). This keeps the scope/decision logic unit-testable without Postgres.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/import/plan-import.ts src/__tests__/import.plan.test.ts
git commit -m "feat(import): dry-run planner with per-row scope decisions"
```

---

## Phase 5 — Commit

### Task 5.1: Payment mapper

**Files:**
- Create: `src/lib/services/import/payment-mapper.ts`
- Test: `src/__tests__/import.payment-mapper.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mapPaymentRow } from '@/lib/services/import/payment-mapper';

it('maps a payment file row to an org-level upsert input', () => {
  const out = mapPaymentRow({ externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: 'wire', isRefund: false, note: 'аванс' }, 'org-1');
  expect(out).toMatchObject({ externalId: 'PP-1', organizationId: 'org-1', orderId: null, amount: 1000, method: 'wire', isRefund: false, note: 'аванс' });
  expect(out.paidAt instanceof Date).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { PaymentFileRow } from './types';

export function mapPaymentRow(row: PaymentFileRow, organizationId: string) {
  return {
    externalId: row.externalId,
    organizationId,
    orderId: null as string | null,
    amount: row.amount,
    paidAt: new Date(row.paidAt),
    method: row.method,
    isRefund: row.isRefund,
    note: row.note,
  };
}
```

- [ ] **Step 4: Run → PASS. Commit**

```bash
git add src/lib/services/import/payment-mapper.ts src/__tests__/import.payment-mapper.test.ts
git commit -m "feat(import): org-level payment mapper"
```

### Task 5.2: Transactional commit + audit

**Files:**
- Create: `src/lib/services/import/commit-import.ts`
- Modify: `src/lib/auth/audit.ts` (add `'payment'`, `'one_c_import'` to `AuditEntity`)
- Test: integration `src/__tests__/services.import.commit.test.ts` (contains `new PrismaClient(` → integration mode)

- [ ] **Step 1: Extend AuditEntity**

In `src/lib/auth/audit.ts` add to the union: `| 'payment'` and `| 'one_c_import'`.

- [ ] **Step 2: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { commitImport } from '@/lib/services/import/commit-import';

const prisma = new PrismaClient();
// ... seed a Company + leader User + a Partner(inn '5500') in beforeAll ...

describe('commitImport (integration)', () => {
  it('creates org→payment and is idempotent on re-run', async () => {
    const session: any = { sub: leaderId, role: 'manager', managerRole: 'leader', companyId };
    const rows = {
      orgs: [{ name: 'Завод', inn: '7700', partnerInn: '5500' }],
      orders: [],
      payments: [{ externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: 'wire', isRefund: false, note: 'аванс' }],
    };
    const r1 = await commitImport(prisma, session, rows);
    expect(r1.applied.paymentsUpserted).toBe(1);

    const r2 = await commitImport(prisma, session, rows);   // re-run
    const count = await prisma.payment.count({ where: { externalId: 'PP-1' } });
    expect(count).toBe(1); // no duplicate
  });
});
```

- [ ] **Step 3: Run → FAIL** (module missing). Run: `npm run test:integration -- services.import.commit` (needs live PG; or `npm run gate`).

- [ ] **Step 4: Implement** (transaction; upsert org→order→payment; only writable rows; audit)

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { importScope } from './scope';
import { planImport } from './plan-import';
import { mapPaymentRow } from './payment-mapper';
import type { ImportCounts, OrgFileRow, OrderFileRow, PaymentFileRow } from './types';

type Rows = { orgs: OrgFileRow[]; orders: OrderFileRow[]; payments: PaymentFileRow[] };

export async function commitImport(prisma: PrismaClient, session: SessionPayload, rows: Rows) {
  const scope = importScope(session);

  // Build lookups (read-only)
  const [orgs, partners] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, inn: true } }),
    prisma.partner.findMany({ select: { id: true, inn: true } }),
  ]);
  const orgIdByInn = new Map(orgs.filter((o) => o.inn).map((o) => [o.inn as string, o.id]));
  const partnerIdByInn = new Map(partners.filter((p) => p.inn).map((p) => [p.inn as string, p.id]));

  const plan = planImport(rows, { orgIdByInn, partnerIdByInn }, scope);
  const applied: ImportCounts = { orgsCreated: 0, orgsUpdated: 0, orgsStandalone: 0, ordersUpserted: 0, paymentsUpserted: 0 };

  const skippedOrgInn = new Set(plan.skipped.orgs.map((s) => rows.orgs[s.rowIndex].inn));

  await prisma.$transaction(async (tx) => {
    // Orgs
    for (const o of rows.orgs) {
      if (skippedOrgInn.has(o.inn)) continue;
      const partnerId = o.partnerInn ? partnerIdByInn.get(o.partnerInn) ?? null : null;
      const existing = orgIdByInn.get(o.inn);
      const up = await tx.organization.upsert({
        where: { inn: o.inn },
        create: { name: o.name, inn: o.inn, partnerId, companyId: session.companyId ?? null },
        update: { name: o.name, partnerId },
        select: { id: true, inn: true },
      });
      orgIdByInn.set(o.inn, up.id);
      existing ? applied.orgsUpdated++ : applied.orgsCreated++;
      if (!partnerId) applied.orgsStandalone++;
    }
    // Orders
    for (const ord of rows.orders) {
      const orgId = orgIdByInn.get(ord.orgInn);
      if (!orgId || plan.skipped.orders.some((s) => rows.orders[s.rowIndex] === ord)) continue;
      await tx.order.upsert({
        where: { externalId: ord.externalId },
        create: { externalId: ord.externalId, orderNumber: ord.orderNumber, title: ord.orderNumber ?? ord.externalId, organizationId: orgId, companyId: session.companyId ?? orgId, totalAmount: ord.totalAmount, paidAmount: ord.paidAmount, vatIncluded: true },
        update: { totalAmount: ord.totalAmount, paidAmount: ord.paidAmount, organizationId: orgId },
        select: { id: true },
      });
      applied.ordersUpserted++;
    }
    // Payments (org-level)
    for (const pay of rows.payments) {
      const orgId = orgIdByInn.get(pay.orgInn);
      if (!orgId || plan.skipped.payments.some((s) => rows.payments[s.rowIndex] === pay)) continue;
      const data = mapPaymentRow(pay, orgId);
      await tx.payment.upsert({ where: { externalId: pay.externalId }, create: data, update: data });
      applied.paymentsUpserted++;
    }
  });

  await recordAudit(prisma, {
    userId: session.sub, action: 'one_c_import.commit', entity: 'one_c_import', entityId: session.companyId ?? session.sub,
    after: { applied, skipped: { orgs: plan.skipped.orgs.length, orders: plan.skipped.orders.length, payments: plan.skipped.payments.length } },
  });

  return { applied, skipped: plan.skipped };
}
```

> `Order.companyId` is required; when the importer has no `companyId` we fall back to the org id only to satisfy NOT NULL — confirm the real tenancy rule against the sample (admin imports may need an explicit company selector). Flag in review.

- [ ] **Step 5: Run → PASS** via `npm run gate` (or live PG). Expected: idempotent (count === 1).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/import/commit-import.ts src/lib/auth/audit.ts src/__tests__/services.import.commit.test.ts
git commit -m "feat(import): transactional commit + audit"
```

---

## Phase 6 — Service contract (Result-type)

### Task 6.1: index barrel with previewImport/commitImport

**Files:**
- Create: `src/lib/services/import/index.ts`
- Test: `src/__tests__/import.contract.test.ts` (unit; mock parse + db)

- [ ] **Step 1: Failing test** — assert `previewImport` returns `{ ok:false, error:'forbidden' }` for a non-manager/non-admin role, and `{ ok:true, plan }` for a leader with a stubbed workbook.

```ts
import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));

import { previewImport } from '@/lib/services/import';

it('rejects non-staff roles', async () => {
  const res = await previewImport({} as any, { role: 'partner' } as any, { fileBuffer: Buffer.from('') });
  expect(res).toEqual({ ok: false, error: 'forbidden' });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `previewImport` (parse → validate → build lookups → planImport) and `commitImport` (delegates to commit-import). Role gate first:

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { parseWorkbook } from './parse-workbook';
import { validateRows } from './validate';
import { planImport } from './plan-import';
import { importScope } from './scope';
import { commitImport as commitTx } from './commit-import';
import type { ImportPlan } from './types';

type Args = { fileBuffer: Buffer };
type Err = 'invalid_file' | 'forbidden' | 'empty' | 'parse_failed';

function isStaff(s: SessionPayload) { return s.role === 'admin' || s.role === 'manager'; }

export async function previewImport(prisma: PrismaClient, session: SessionPayload, args: Args):
  Promise<{ ok: true; plan: ImportPlan } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let parsed;
  try { parsed = await parseWorkbook(args.fileBuffer); }
  catch { return { ok: false, error: 'parse_failed' }; }

  const orgs = validateRows('orgs', parsed.orgs);
  const orders = validateRows('orders', parsed.orders);
  const payments = validateRows('payments', parsed.payments);
  const quarantine = [...orgs.quarantine, ...orders.quarantine, ...payments.quarantine];
  if (!orgs.valid.length && !orders.valid.length && !payments.valid.length) return { ok: false, error: 'empty' };

  const [dbOrgs, dbPartners] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, inn: true } }),
    prisma.partner.findMany({ select: { id: true, inn: true } }),
  ]);
  const lookups = {
    orgIdByInn: new Map(dbOrgs.filter((o) => o.inn).map((o) => [o.inn as string, o.id])),
    partnerIdByInn: new Map(dbPartners.filter((p) => p.inn).map((p) => [p.inn as string, p.id])),
  };
  const plan = planImport({ orgs: orgs.valid, orders: orders.valid, payments: payments.valid }, lookups, importScope(session));
  return { ok: true, plan: { ...plan, quarantine } };
}

export async function commitImport(prisma: PrismaClient, session: SessionPayload, args: Args):
  Promise<{ ok: true; applied: any; skipped: any } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let parsed;
  try { parsed = await parseWorkbook(args.fileBuffer); }
  catch { return { ok: false, error: 'parse_failed' }; }
  const orgs = validateRows('orgs', parsed.orgs).valid;
  const orders = validateRows('orders', parsed.orders).valid;
  const payments = validateRows('payments', parsed.payments).valid;
  const { applied, skipped } = await commitTx(prisma, session, { orgs, orders, payments });
  return { ok: true, applied, skipped };
}
```

- [ ] **Step 4: Run → PASS. Typecheck. Commit**

```bash
git add src/lib/services/import/index.ts src/__tests__/import.contract.test.ts
git commit -m "feat(import): previewImport/commitImport Result-contract"
```

---

## Phase 7 — Read-path migration (org-level payments must surface)

### Task 7.1: Update all four payment read sites

**Files (each Modify + verify):**
- `src/lib/services/organization/finance.ts:45` — `where: { order: { organizationId } }` → `where: { organizationId }`; `select` no longer requires `order` (make `order` select optional, render `orderNumber: p.order?.orderNumber ?? null`).
- `src/lib/services/organization/dashboard.ts:169` — same org-direct switch.
- `src/lib/services/partner/dashboard.ts:205` — `where: { order: { organization: { partnerId } } }` → `where: { organization: { partnerId } }`.
- `src/lib/services/manager/dashboard/events.ts:42` — switch the order-based filter to `organization: managerOrgScope(session, teamMode)` (or keep order-join but add org branch — confirm scope semantics with the file).
- Test: extend each owning service's existing unit/integration test to assert an `orderId: null` payment is returned.

- [ ] **Step 1: For each site, write/extend a failing test** asserting a payment with `orderId = null` (org-linked) appears in the result. Example for finance:

```ts
it('lists org-level payments with null order', async () => {
  // seed a Payment { organizationId: org.id, orderId: null }
  const rows = await listOrgPayments(prisma, { organizationId: org.id });
  expect(rows.some((r) => r.orderNumber === null)).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL** (current `where: { order: {...} }` excludes null-order payments).

- [ ] **Step 3: Apply the read-path change** at each site. For `listOrgPayments`:

```ts
const rows = await prisma.payment.findMany({
  where: { organizationId: opts.organizationId },
  orderBy: { paidAt: 'desc' },
  take: opts.take ?? 50,
  select: { id: true, amount: true, paidAt: true, method: true, isRefund: true, note: true,
            order: { select: { id: true, orderNumber: true } } },
});
return rows.map((p) => ({
  id: p.id, amount: p.amount.toFixed(2), paidAt: p.paidAt, method: p.method,
  isRefund: p.isRefund, note: p.note,
  orderId: p.order?.id ?? null, orderNumber: p.order?.orderNumber ?? null,
}));
```

Update `OrgPaymentRow.orderId` type to `string | null`.

- [ ] **Step 4: Run → PASS** for each site. Then `npm run typecheck` (catches every `p.order.x` that must become `p.order?.x`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/organization/finance.ts src/lib/services/organization/dashboard.ts src/lib/services/partner/dashboard.ts src/lib/services/manager/dashboard/events.ts src/__tests__
git commit -m "fix(finance): read payments org-level so imported rows surface (4 sites)"
```

---

## Phase 8 — UI & wiring

### Task 8.1: Server actions

**Files:**
- Create: `src/server-actions/import.ts`
- Test: `src/__tests__/server-actions.import.test.ts`

- [ ] **Step 1: Failing test** — `previewImportAction` calls `requireManager`/`requireAdmin` path and returns the service plan; non-staff → forbidden. Mock the service + session.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** thin adapter over the service (read session, call `previewImport`/`commitImport`, map errors). Follows §3 (route/action only maps).

```ts
'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { previewImport, commitImport } from '@/lib/services/import';

export async function previewImportAction(form: FormData) {
  const session = await requireSession();
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'invalid_file' as const };
  const buf = Buffer.from(await file.arrayBuffer());
  return previewImport(prisma, session, { fileBuffer: buf });
}

export async function commitImportAction(form: FormData) {
  const session = await requireSession();
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'invalid_file' as const };
  const buf = Buffer.from(await file.arrayBuffer());
  return commitImport(prisma, session, { fileBuffer: buf });
}
```

- [ ] **Step 4: Run → PASS. Commit**

```bash
git add src/server-actions/import.ts src/__tests__/server-actions.import.test.ts
git commit -m "feat(import): server actions (preview/commit)"
```

### Task 8.2: Upload + preview client component

**Files:**
- Create: `src/components/import/import-form.tsx`
- Test: `src/__tests__/components.import-form.test.tsx` (render; `import React`)

> Per [project-vitest-classic-jsx]: unit-tested components MUST `import React` (vitest has no JSX-transform plugin).

- [ ] **Step 1: Failing render test** — renders a file input + disabled «Загрузить» until a file is chosen; shows preview counts after a stubbed preview result.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a `'use client'` form: choose file → call `previewImportAction` → render the `ImportPlan` summary table (created/updated/standalone/skipped + quarantine) → «Подтвердить импорт» calls `commitImportAction`. Russian UI strings, orange palette (§13). Show skip reasons explicitly (no silent truncation).

- [ ] **Step 4: Run → PASS. Commit**

```bash
git add src/components/import/import-form.tsx src/__tests__/components.import-form.test.tsx
git commit -m "feat(import): upload + dry-run preview UI"
```

### Task 8.3: Pages + nav

**Files:**
- Create: `src/app/manager/import/page.tsx`, `src/app/admin/import/page.tsx`
- Modify: `src/lib/navigation/cabinet.ts`
- Test: `src/__tests__/navigation.cabinet.manager.test.ts` (extend) + page guard assertion

- [ ] **Step 1: Failing nav test** — manager nav includes `{ href: '/manager/import', label: 'Загрузка из 1С', flag: 'manager_cabinet' }`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
  - `manager/import/page.tsx`: `const session = await requireManager();` then render `<ImportForm />`. (Any manager may open; scope enforced in service.)
  - `admin/import/page.tsx`: `await requireAdmin();` then `<ImportForm />`.
  - Nav: add the manager item (above) and the admin mirror item in `navByRole`.
  - No middleware change needed: `/manager/*` and `/admin/*` prefixes already gated by `protectedPrefixes`.

- [ ] **Step 4: Run → PASS.** Manual: `npm run dev`, visit `/manager/import` as a manager; confirm upload→preview→commit round-trips against seed data.

- [ ] **Step 5: Commit**

```bash
git add src/app/manager/import src/app/admin/import src/lib/navigation/cabinet.ts src/__tests__/navigation.cabinet.manager.test.ts
git commit -m "feat(import): manager + admin import pages and nav"
```

---

## Phase 9 — Verification

### Task 9.1: Full gate + integration

- [ ] **Step 1:** `npm run typecheck` → clean.
- [ ] **Step 2:** `npm run lint` → clean.
- [ ] **Step 3:** `npm run test:unit` → all green (new unit specs included).
- [ ] **Step 4:** `npm run gate` (or `npm run test:integration` with live PG) → schema migration, commit idempotency, backfill, cross-scope invariant green.
- [ ] **Step 5:** `npm run build` → succeeds (catches slug/route conflicts — see [project-phase8-dev-server-broken]).
- [ ] **Step 6 (cross-scope invariant):** integration test — a plain manager (no `managedOrgIds` overlap) committing a workbook with another team's org writes **nothing** for that org, even with `Company.managerTeamVisibility=ON` (write-scope ≠ read-visibility).

### Task 9.2: Sample-file lock (the one hard external input)

- [ ] **Step 1:** Obtain the real 1C export sample.
- [ ] **Step 2:** Update `src/lib/services/import/column-map.ts` header strings + resolve open items (org/order externalId presence, datetime format, refund/method representation).
- [ ] **Step 3:** Re-run `npm run test:unit -- import` + a manual preview against a real file on staging.
- [ ] **Step 4:** Commit `chore(import): lock column map to real 1C export`.

---

## Self-Review notes (filled during writing)

- **Spec coverage:** migrations (M1–M5) ✓ Task 0.1; parse ✓ 3.1; validate ✓ 2.1; dry-run preview ✓ 4.2; scope RBAC ✓ 4.1/4.2/9.1; commit+audit ✓ 5.2; Result-contract ✓ 6.1; read-path (4 sites) ✓ 7.1; UI/nav ✓ 8.x; column-map sample-lock ✓ 1.2/9.2. Sub-project 2 (manager finance view) intentionally excluded.
- **Type consistency:** `ImportScope` shape identical in scope.ts/plan-import.ts/index.ts; `OrgPaymentRow.orderId` widened to `string | null` consistently; `mapPaymentRow` output matches `Payment` create input.
- **Open items surfaced for review** (not placeholders — real decisions deferred to sample): `Order.companyId` tenancy fallback; exact headers; `Organization.inn` duplicate check before M5.
