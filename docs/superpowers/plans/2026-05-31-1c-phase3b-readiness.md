# 1С Phase 3b Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 1С sync backbone production-ready — persistent incremental cursor, runtime validation, per-record isolation, idempotent lead-push, resilience helpers, a responsibly-isolated REST adapter skeleton, and a shadow/dry-run mode — without touching the meeting-blocked wire format.

**Architecture:** Transport-independent hardening composed from small pure modules (`config`, `cursor`, `schemas`, `resilience`, `record-batch`) that the 4 pull-processors and a new `adapter-rest` both consume. All REST-specific speculation lives in two throwaway files (`rest-wire.ts`, `adapter-rest.ts`). The `OneCAdapter` interface is unchanged (`Promise<Dto[]>`); processors enforce validation as their first step via `runRecordBatch`.

**Tech Stack:** TypeScript 5 (strict) · Prisma 5 + PostgreSQL · BullMQ · zod ^3.24.4 (already a dependency) · Vitest 2 (unit + integration via `--mode`).

**Spec:** [docs/superpowers/specs/2026-05-31-1c-phase3b-readiness-design.md](../specs/2026-05-31-1c-phase3b-readiness-design.md)

---

## Prerequisites & conventions

- **Unit tests** must NOT contain the string `new PrismaClient(` — vitest classifies any file containing it as *integration* ([vitest.config.ts:19](../../../vitest.config.ts)). Unit tests use `vi.fn()` mocks. Run: `npx vitest run <path> --mode=unit`.
- **Integration tests** contain `new PrismaClient(` and need live Postgres. Run: `npx vitest run <path> --mode=integration` (start DB first, or use `npm run gate` for an ephemeral one).
- **Mock pattern** (CLAUDE.md §6): `const { x } = vi.hoisted(() => ({ x: vi.fn() }))` + `vi.mock('@/lib/...', () => ({ x }))`.
- After any `schema.prisma` edit: `npm run prisma:generate`. Migration: `npm run prisma:migrate -- --name <name>` (= `prisma migrate dev --name`).
- Commit after every green task. Hook L1 runs `eslint` (staged) + `npm run typecheck` + `npm run test:changed`.
- Colours/RU localisation per CLAUDE.md §13.

## File structure (created / modified)

| File | Action | Responsibility |
|---|---|---|
| `src/lib/services/oneCSync/config.ts` | create | env readers: `oneCMode`, `oneCHttpTimeoutMs`, `oneCCursorOverlapMinutes` |
| `src/lib/services/oneCSync/cursor.ts` | create | `getCursor` / `advanceCursor` / `markCursorError` / pure `applyOverlap` |
| `src/lib/services/oneCSync/schemas.ts` | create | zod schemas (4 pull DTOs + push result) |
| `src/lib/services/oneCSync/dto.ts` | modify | 4 pull DTOs + result become `z.infer`; payload + cursor stay plain |
| `src/lib/services/oneCSync/resilience.ts` | create | `withTimeout` / `withRetry` / `parseRecords` / `OneCHttpError` |
| `src/lib/services/oneCSync/record-batch.ts` | create | `runRecordBatch` (validation + isolation) + `batchStatus` |
| `src/worker/processors/sync-orders.ts` | modify | cursor + runRecordBatch + commit-gate |
| `src/worker/processors/sync-payments.ts` | modify | same |
| `src/worker/processors/sync-documents.ts` | modify | same |
| `src/worker/processors/sync-organizations.ts` | modify | same |
| `src/lib/services/oneCSync/push.ts` | modify | idempotency guard + `pushedToOneCAt` |
| `src/lib/services/oneCSync/adapter-fake.ts` | modify | env-gated fidelity (malformed/latency) |
| `src/lib/services/oneCSync/rest-wire.ts` | create | ALL DECISION-Q# constants (endpoints/auth/since/envelope/push) |
| `src/lib/services/oneCSync/adapter-rest.ts` | create | `RestOneCAdapter` composing resilience + wire |
| `src/lib/services/oneCSync/index.ts` | modify | factory: `case 'rest'` → `RestOneCAdapter` |
| `src/lib/services/syncSummary.ts` | modify | + cursor + lagMs per entity |
| `src/app/admin/sync/page.tsx` | modify | + "Курсор / лаг" column |
| `prisma/schema.prisma` | modify | + `model SyncState`; + `Lead.pushedToOneCAt` |
| `.env.example` | modify | uncomment 1C REST vars + add MODE/TIMEOUT/OVERLAP |
| `src/__tests__/oneCSync.*.test.ts` | create/modify | per-task tests |

---

## Task 1: `config.ts` — env readers

**Files:**
- Create: `src/lib/services/oneCSync/config.ts`
- Test: `src/__tests__/oneCSync.config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.config.test.ts
import { describe, expect, it, afterEach } from 'vitest';
import { oneCMode, oneCHttpTimeoutMs, oneCCursorOverlapMinutes } from '@/lib/services/oneCSync/config';

describe('oneCSync config', () => {
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    delete process.env.ONE_C_HTTP_TIMEOUT_MS;
    delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
  });

  it('oneCMode defaults to live and reads shadow case-insensitively', () => {
    expect(oneCMode()).toBe('live');
    process.env.ONE_C_MODE = 'SHADOW';
    expect(oneCMode()).toBe('shadow');
    process.env.ONE_C_MODE = 'anything-else';
    expect(oneCMode()).toBe('live');
  });

  it('oneCHttpTimeoutMs defaults to 15000 and rejects non-positive', () => {
    expect(oneCHttpTimeoutMs()).toBe(15000);
    process.env.ONE_C_HTTP_TIMEOUT_MS = '8000';
    expect(oneCHttpTimeoutMs()).toBe(8000);
    process.env.ONE_C_HTTP_TIMEOUT_MS = '0';
    expect(oneCHttpTimeoutMs()).toBe(15000);
  });

  it('oneCCursorOverlapMinutes defaults to 5 and allows 0', () => {
    expect(oneCCursorOverlapMinutes()).toBe(5);
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '0';
    expect(oneCCursorOverlapMinutes()).toBe(0);
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = 'bad';
    expect(oneCCursorOverlapMinutes()).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.config.test.ts --mode=unit`
Expected: FAIL — `Cannot find module '@/lib/services/oneCSync/config'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/services/oneCSync/config.ts
export type OneCMode = 'live' | 'shadow';

export function oneCMode(): OneCMode {
  return (process.env.ONE_C_MODE ?? 'live').trim().toLowerCase() === 'shadow' ? 'shadow' : 'live';
}

export function oneCHttpTimeoutMs(): number {
  const raw = Number(process.env.ONE_C_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

export function oneCCursorOverlapMinutes(): number {
  const raw = Number(process.env.ONE_C_CURSOR_OVERLAP_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oneCSync.config.test.ts --mode=unit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/config.ts src/__tests__/oneCSync.config.test.ts
git commit -m "feat(1c): oneCSync env config readers (mode/timeout/overlap)"
```

---

## Task 2: `SyncState` model + `cursor.ts`

**Files:**
- Modify: `prisma/schema.prisma` (add model after `SyncLog`, around line 284)
- Create: `src/lib/services/oneCSync/cursor.ts`
- Test (unit): `src/__tests__/oneCSync.cursor.test.ts` (pure `applyOverlap`)
- Test (integration): `src/__tests__/oneCSync.cursor.integration.test.ts`

- [ ] **Step 1: Write the failing unit test (pure overlap math)**

```ts
// src/__tests__/oneCSync.cursor.test.ts
import { describe, expect, it } from 'vitest';
import { applyOverlap } from '@/lib/services/oneCSync/cursor';

describe('applyOverlap', () => {
  it('subtracts N minutes and returns ISO string', () => {
    expect(applyOverlap(new Date('2026-05-12T10:00:00.000Z'), 5)).toBe('2026-05-12T09:55:00.000Z');
  });
  it('overlap 0 returns the same instant', () => {
    expect(applyOverlap(new Date('2026-05-12T10:00:00.000Z'), 0)).toBe('2026-05-12T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.cursor.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the Prisma model**

In `prisma/schema.prisma`, immediately after the `SyncLog` model (ends line 284), add:

```prisma
model SyncState {
  entity        String    @id
  cursor        String?
  lastRunAt     DateTime?
  lastSuccessAt DateTime?
  lastError     String?
  updatedAt     DateTime  @updatedAt
}
```

- [ ] **Step 4: Generate client + migration**

```bash
npm run prisma:migrate -- --name sync_state
npm run prisma:generate
```
Expected: new folder `prisma/migrations/<ts>_sync_state/migration.sql` creating table `SyncState`; client regenerated.

- [ ] **Step 5: Write `cursor.ts`**

```ts
// src/lib/services/oneCSync/cursor.ts
import type { PrismaClient } from '@prisma/client';
import type { SyncCursor } from './dto';
import { oneCCursorOverlapMinutes } from './config';

export type CursorEntity = 'organization' | 'order' | 'payment' | 'document';

/** High-water mark minus a safety overlap (clock-skew / boundary protection). */
export function applyOverlap(maxUpdatedAt: Date, overlapMinutes: number): string {
  return new Date(maxUpdatedAt.getTime() - overlapMinutes * 60_000).toISOString();
}

export async function getCursor(db: PrismaClient, entity: CursorEntity): Promise<SyncCursor> {
  const row = await db.syncState.findUnique({ where: { entity }, select: { cursor: true } });
  return row?.cursor ? { since: row.cursor } : {};
}

/** Advance only when there was a successful high-water mark. null = no records handled → leave cursor. */
export async function advanceCursor(db: PrismaClient, entity: CursorEntity, maxUpdatedAt: Date | null): Promise<void> {
  const now = new Date();
  const base = { lastRunAt: now, lastSuccessAt: now, lastError: null as string | null };
  const cursor = maxUpdatedAt ? applyOverlap(maxUpdatedAt, oneCCursorOverlapMinutes()) : undefined;
  await db.syncState.upsert({
    where: { entity },
    create: { entity, ...base, ...(cursor ? { cursor } : {}) },
    update: { ...base, ...(cursor ? { cursor } : {}) }
  });
}

export async function markCursorError(db: PrismaClient, entity: CursorEntity, error: string): Promise<void> {
  const now = new Date();
  const msg = error.slice(0, 1000);
  await db.syncState.upsert({
    where: { entity },
    create: { entity, lastRunAt: now, lastError: msg },
    update: { lastRunAt: now, lastError: msg }
  });
}
```

- [ ] **Step 6: Run unit test to verify it passes**

Run: `npx vitest run src/__tests__/oneCSync.cursor.test.ts --mode=unit`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the integration test (round-trip)**

```ts
// src/__tests__/oneCSync.cursor.integration.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';

let prisma: PrismaClient;

beforeAll(async () => {
  process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '5';
  prisma = new PrismaClient();
  await prisma.syncState.deleteMany({});
});
afterAll(async () => {
  await prisma.syncState.deleteMany({});
  delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
  await prisma.$disconnect();
});

describe('cursor persistence', () => {
  it('getCursor returns empty before any run', async () => {
    expect(await getCursor(prisma, 'order')).toEqual({});
  });

  it('advanceCursor stores max-updatedAt minus overlap; getCursor reads it back', async () => {
    await advanceCursor(prisma, 'order', new Date('2026-05-12T10:00:00.000Z'));
    expect(await getCursor(prisma, 'order')).toEqual({ since: '2026-05-12T09:55:00.000Z' });
  });

  it('advanceCursor with null does not move the cursor', async () => {
    await advanceCursor(prisma, 'order', null);
    expect(await getCursor(prisma, 'order')).toEqual({ since: '2026-05-12T09:55:00.000Z' });
  });

  it('markCursorError records lastError without touching cursor', async () => {
    await markCursorError(prisma, 'order', 'boom');
    const row = await prisma.syncState.findUnique({ where: { entity: 'order' } });
    expect(row?.lastError).toBe('boom');
    expect(row?.cursor).toBe('2026-05-12T09:55:00.000Z');
  });
});
```

- [ ] **Step 8: Run integration test to verify it passes** (needs live Postgres)

Run: `npx vitest run src/__tests__/oneCSync.cursor.integration.test.ts --mode=integration`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/services/oneCSync/cursor.ts src/__tests__/oneCSync.cursor.test.ts src/__tests__/oneCSync.cursor.integration.test.ts
git commit -m "feat(1c): SyncState model + persistent incremental cursor helper"
```

---

## Task 3: zod `schemas.ts` + `dto.ts` refactor

**Files:**
- Create: `src/lib/services/oneCSync/schemas.ts`
- Modify: `src/lib/services/oneCSync/dto.ts`
- Test: `src/__tests__/oneCSync.schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.schemas.test.ts
import { describe, expect, it } from 'vitest';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';

const validOrder = {
  externalId: '1c-order-1', title: 'T', organizationExternalId: '1c-org-1',
  totalAmount: 100, paidAmount: 50, vatIncluded: true,
  executionStatus: 'in_progress', financialStatus: 'partially_paid',
  productMix: ['training'], updatedAt: '2026-05-01T00:00:00Z'
};

describe('oneCSync zod schemas', () => {
  it('OneCOrderSchema accepts a valid order', () => {
    expect(OneCOrderSchema.safeParse(validOrder).success).toBe(true);
  });
  it('OneCOrderSchema rejects a bad enum', () => {
    const r = OneCOrderSchema.safeParse({ ...validOrder, executionStatus: 'nope' });
    expect(r.success).toBe(false);
  });
  it('OneCOrderSchema rejects a non-numeric amount', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, totalAmount: '100' }).success).toBe(false);
  });
  it('OneCOrderSchema rejects garbage datetime but accepts ISO', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, updatedAt: 'not-a-date' }).success).toBe(false);
  });
  it('OneCOrgSchema requires externalId and name', () => {
    expect(OneCOrgSchema.safeParse({ name: 'x', updatedAt: '2026-05-01T00:00:00Z' }).success).toBe(false);
  });
  it('OneCPaymentSchema and OneCDocumentSchema accept valid records', () => {
    expect(OneCPaymentSchema.safeParse({
      externalId: 'p1', orderExternalId: 'o1', amount: 5, paidAt: '2026-05-01T00:00:00Z',
      isRefund: false, updatedAt: '2026-05-01T00:00:00Z'
    }).success).toBe(true);
    expect(OneCDocumentSchema.safeParse({
      externalId: 'd1', orderExternalId: 'o1', type: 'act', name: 'a.pdf',
      mimeType: 'application/pdf', size: 1, downloadUrl: 'http://x/d1', updatedAt: '2026-05-01T00:00:00Z'
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.schemas.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `schemas.ts`**

```ts
// src/lib/services/oneCSync/schemas.ts
import { z } from 'zod';

// Accepts anything Date.parse understands; rejects garbage. Tightening to a strict
// format is DECISION Q7 (datetime format from 1C) — keep permissive until confirmed.
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid datetime' });

export const OneCOrgSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  legalName: z.string().optional(),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  partnerExternalId: z.string().optional(),
  updatedAt: isoDate
});

export const OneCOrderSchema = z.object({
  externalId: z.string().min(1),
  orderNumber: z.string().optional(),
  title: z.string().min(1),
  organizationExternalId: z.string().min(1),
  totalAmount: z.number(),
  paidAmount: z.number(),
  paidAt: isoDate.optional(),
  contractSignedAt: isoDate.optional(),
  completedAt: isoDate.optional(),
  closedAt: isoDate.optional(),
  vatIncluded: z.boolean(),
  vatRate: z.number().optional(),
  executionStatus: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'on_hold']),
  financialStatus: z.enum(['not_billed', 'billed', 'partially_paid', 'paid', 'refunded']),
  productMix: z.array(z.string()),
  updatedAt: isoDate
});

export const OneCPaymentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1),
  amount: z.number(),
  paidAt: isoDate,
  method: z.string().optional(),
  isRefund: z.boolean(),
  updatedAt: isoDate
});

export const OneCDocumentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1),
  type: z.enum(['contract', 'extra_agreement', 'invoice', 'act', 'waybill', 'certificate', 'report', 'other']),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number(),
  signedAt: isoDate.optional(),
  downloadUrl: z.string().min(1),
  updatedAt: isoDate
});

export const OneCLeadPushResultSchema = z.object({
  acceptedAt: isoDate,
  oneCRequestId: z.string().optional()
});
```

- [ ] **Step 4: Refactor `dto.ts` to infer from schemas**

Replace the contents of `src/lib/services/oneCSync/dto.ts` with:

```ts
// src/lib/services/oneCSync/dto.ts
import type { z } from 'zod';
import type {
  OneCOrgSchema,
  OneCOrderSchema,
  OneCPaymentSchema,
  OneCDocumentSchema,
  OneCLeadPushResultSchema
} from './schemas';

export type OneCOrgDto = z.infer<typeof OneCOrgSchema>;
export type OneCOrderDto = z.infer<typeof OneCOrderSchema>;
export type OneCPaymentDto = z.infer<typeof OneCPaymentSchema>;
export type OneCDocumentDto = z.infer<typeof OneCDocumentSchema>;
export type OneCLeadPushResult = z.infer<typeof OneCLeadPushResultSchema>;

// Outbound payload we construct — no need to runtime-validate our own output.
export type OneCLeadPushPayload = {
  partnerExternalId?: string;
  partnerSlug?: string;
  cabinetLeadId: string;
  clientCompanyName: string;
  clientInn?: string;
  clientContactName: string;
  clientContactPhone?: string;
  clientContactEmail?: string;
  subject: string;
  estimatedAmount?: number;
  productType: string[];
  notes?: string;
};

export type SyncCursor = {
  since?: string;
};
```

- [ ] **Step 5: Run schema test + full typecheck (the dto change ripples across adapter/mappers)**

Run: `npx vitest run src/__tests__/oneCSync.schemas.test.ts --mode=unit && npm run typecheck`
Expected: schema test PASS (6 tests); typecheck PASS (the inferred types are structurally identical to the old hand-written ones, so mappers/adapter/fixtures still compile).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/oneCSync/schemas.ts src/lib/services/oneCSync/dto.ts src/__tests__/oneCSync.schemas.test.ts
git commit -m "feat(1c): zod schemas as single source of truth for sync DTOs"
```

---

## Task 4: `resilience.ts`

**Files:**
- Create: `src/lib/services/oneCSync/resilience.ts`
- Test: `src/__tests__/oneCSync.resilience.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.resilience.test.ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withTimeout, withRetry, parseRecords, OneCHttpError, isTransient } from '@/lib/services/oneCSync/resilience';

describe('withTimeout', () => {
  it('resolves when fn finishes before deadline', async () => {
    await expect(withTimeout(async () => 'ok', 50)).resolves.toBe('ok');
  });
  it('aborts the signal when fn exceeds the deadline', async () => {
    const aborted = await withTimeout(
      (signal) => new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => resolve(true));
      }),
      10
    );
    expect(aborted).toBe(true);
  });
});

describe('isTransient', () => {
  it('treats 429/503 as transient and 400 as fatal', () => {
    expect(isTransient(new OneCHttpError(429, 'rate'))).toBe(true);
    expect(isTransient(new OneCHttpError(503, 'down'))).toBe(true);
    expect(isTransient(new OneCHttpError(400, 'bad'))).toBe(false);
  });
  it('treats unknown (network) errors as transient', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries transient failures then succeeds (injected sleep, no real delay)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new OneCHttpError(503, 'down');
      return 'ok';
    });
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('does not retry a fatal error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn(async () => { throw new OneCHttpError(400, 'bad'); });
    await expect(withRetry(fn, { attempts: 3, sleep })).rejects.toThrow('bad');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('honours Retry-After (seconds → ms) for the delay', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let n = 0;
    const fn = vi.fn(async () => { n += 1; if (n < 2) throw new OneCHttpError(429, 'rate', 2); return 'ok'; });
    await withRetry(fn, { attempts: 2, baseDelayMs: 1, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe('parseRecords', () => {
  const schema = z.object({ externalId: z.string(), n: z.number() });
  it('splits valid from invalid and extracts externalId best-effort', () => {
    const res = parseRecords(schema, [
      { externalId: 'a', n: 1 },
      { externalId: 'b', n: 'NOPE' },
      'totally-bad'
    ]);
    expect(res.valid).toEqual([{ externalId: 'a', n: 1 }]);
    expect(res.invalid).toHaveLength(2);
    expect(res.invalid[0].externalId).toBe('b');
    expect(res.invalid[1].externalId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.resilience.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `resilience.ts`**

```ts
// src/lib/services/oneCSync/resilience.ts
import type { ZodType } from 'zod';
import { oneCHttpTimeoutMs } from './config';

export class OneCHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'OneCHttpError';
  }
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number = oneCHttpTimeoutMs()
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function isTransient(err: unknown): boolean {
  if (err instanceof OneCHttpError) {
    return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  return true; // network / abort / unknown → transient
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? realSleep;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      const retryAfterMs = err instanceof OneCHttpError && typeof err.retryAfter === 'number'
        ? err.retryAfter * 1000
        : baseDelayMs * 2 ** i;
      await sleep(retryAfterMs);
    }
  }
  throw lastErr;
}

export type ParseResult<T> = { valid: T[]; invalid: Array<{ externalId: string | null; issue: string }> };

export function parseRecords<T>(schema: ZodType<T>, raw: unknown[]): ParseResult<T> {
  const valid: T[] = [];
  const invalid: Array<{ externalId: string | null; issue: string }> = [];
  for (const item of raw) {
    const res = schema.safeParse(item);
    if (res.success) {
      valid.push(res.data);
    } else {
      const externalId =
        item && typeof item === 'object' && 'externalId' in item
          ? String((item as { externalId: unknown }).externalId)
          : null;
      invalid.push({ externalId, issue: res.error.issues[0]?.message ?? 'invalid' });
    }
  }
  return { valid, invalid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oneCSync.resilience.test.ts --mode=unit`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/resilience.ts src/__tests__/oneCSync.resilience.test.ts
git commit -m "feat(1c): transport-agnostic resilience helpers (timeout/retry/parse)"
```

---

## Task 5: `record-batch.ts`

**Files:**
- Create: `src/lib/services/oneCSync/record-batch.ts`
- Test: `src/__tests__/oneCSync.record-batch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.record-batch.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runRecordBatch, batchStatus, emptySummary } from '@/lib/services/oneCSync/record-batch';

const schema = z.object({ externalId: z.string(), n: z.number() });

describe('runRecordBatch', () => {
  it('quarantines invalid records and runs the handler on valid ones', async () => {
    const handled: string[] = [];
    const summary = await runRecordBatch(
      [{ externalId: 'a', n: 1 }, { externalId: 'b', n: 'x' }, { externalId: 'c', n: 3 }],
      schema,
      (r) => r.externalId,
      async (r, sum) => { handled.push(r.externalId); sum.created += 1; }
    );
    expect(summary.pulled).toBe(3);
    expect(summary.invalid).toBe(1);
    expect(summary.invalids[0].externalId).toBe('b');
    expect(summary.created).toBe(2);
    expect(handled).toEqual(['a', 'c']);
  });

  it('isolates a throwing handler: one poison record does not abort the batch', async () => {
    const summary = await runRecordBatch(
      [{ externalId: 'a', n: 1 }, { externalId: 'poison', n: 2 }, { externalId: 'c', n: 3 }],
      schema,
      (r) => r.externalId,
      async (r, sum) => { if (r.externalId === 'poison') throw new Error('boom'); sum.created += 1; }
    );
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toEqual({ externalId: 'poison', error: 'boom' });
  });
});

describe('batchStatus', () => {
  it('is success only when nothing was skipped/invalid/failed', () => {
    const s = emptySummary();
    expect(batchStatus(s)).toBe('success');
    s.invalid = 1;
    expect(batchStatus(s)).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.record-batch.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `record-batch.ts`**

```ts
// src/lib/services/oneCSync/record-batch.ts
import type { ZodType } from 'zod';
import { parseRecords } from './resilience';

export type BatchSummary = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  failed: number;
  skips: Array<{ externalId: string; reason: string }>;
  invalids: Array<{ externalId: string | null; issue: string }>;
  failures: Array<{ externalId: string; error: string }>;
};

export function emptySummary(): BatchSummary {
  return { pulled: 0, created: 0, updated: 0, skipped: 0, invalid: 0, failed: 0, skips: [], invalids: [], failures: [] };
}

export async function runRecordBatch<T>(
  raw: unknown[],
  schema: ZodType<T>,
  getExternalId: (r: T) => string,
  handler: (r: T, summary: BatchSummary) => Promise<void>
): Promise<BatchSummary> {
  const summary = emptySummary();
  summary.pulled = raw.length;

  const { valid, invalid } = parseRecords(schema, raw);
  summary.invalid = invalid.length;
  summary.invalids = invalid;

  for (const record of valid) {
    try {
      await handler(record, summary);
    } catch (err) {
      summary.failed += 1;
      summary.failures.push({ externalId: getExternalId(record), error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

export function batchStatus(summary: BatchSummary): 'success' | 'warn' {
  return summary.skipped + summary.invalid + summary.failed > 0 ? 'warn' : 'success';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oneCSync.record-batch.test.ts --mode=unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/record-batch.ts src/__tests__/oneCSync.record-batch.test.ts
git commit -m "feat(1c): runRecordBatch — validation quarantine + per-record isolation"
```

---

## Task 6: Refactor `sync-orders.ts` (cursor + batch + commit-gate) and update integration tests

**Files:**
- Modify: `src/worker/processors/sync-orders.ts`
- Modify (shared cleanup + cursor assertions): `src/__tests__/worker.oneCSync.upsert.test.ts`
- Test (unit, shadow no-write): `src/__tests__/worker.sync-orders.shadow.test.ts`

> **Watermark rule:** `maxUpdatedAt` is bumped only after a successful create/update — never for skipped/failed records. A skipped order (organization not yet synced) must remain re-pullable next run.

- [ ] **Step 1: Replace `sync-orders.ts`**

```ts
// src/worker/processors/sync-orders.ts
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCOrderSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrderDto } from '@/lib/services/oneCSync/dto';
import { mapOrderDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyOrgUsers } from '@/lib/notifications';

export type SyncOrdersResult = BatchSummary;

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-orders job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'order');
    const raw = (await adapter.pullOrders(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrderDto>(
      raw,
      OneCOrderSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapOrderDto(dto);
        const org = await db.organization.findUnique({
          where: { externalId: input.organizationExternalId },
          select: { id: true, partnerId: true, companyId: true }
        });
        if (!org || !org.companyId) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
          return;
        }
        const existing = await db.order.findUnique({
          where: { externalId: input.externalId },
          select: { id: true, organizationId: true, executionStatus: true, financialStatus: true, orderNumber: true, title: true }
        });
        const ownedBy1C = {
          orderNumber: input.orderNumber,
          title: input.title,
          totalAmount: input.totalAmount,
          paidAmount: input.paidAmount,
          paidAt: input.paidAt,
          contractSignedAt: input.contractSignedAt,
          completedAt: input.completedAt,
          closedAt: input.closedAt,
          vatIncluded: input.vatIncluded,
          vatRate: input.vatRate,
          financialStatus: input.financialStatus,
          productMix: input.productMix,
          lastSyncedAt: new Date()
        };

        if (existing) {
          if (mode === 'live') {
            await db.order.update({
              where: { id: existing.id },
              data: existing.organizationId === null ? { ...ownedBy1C, organizationId: org.id } : ownedBy1C
            });
          }
          sum.updated += 1;
          bump(dto.updatedAt);

          const targetOrgId = existing.organizationId ?? org.id;
          if (mode === 'live' && targetOrgId && existing.financialStatus !== input.financialStatus) {
            await notifyOrgUsers(db, {
              organizationId: targetOrgId,
              type: 'order_status_changed',
              payload: {
                orderId: existing.id,
                orderNumber: existing.orderNumber,
                orderTitle: existing.title,
                dimension: 'financial',
                oldStatus: existing.financialStatus,
                newStatus: input.financialStatus
              }
            });
          }
        } else {
          if (mode === 'live') {
            await db.order.create({
              data: {
                ...ownedBy1C,
                externalId: input.externalId,
                executionStatus: input.executionStatus,
                companyId: org.companyId,
                partnerId: org.partnerId,
                organizationId: org.id
              }
            });
          }
          sum.created += 1;
          bump(dto.updatedAt);
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'order', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'order', message).catch(() => {});
    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: 'skip',
        status: 'error',
        errorMessage: message,
        durationMs: Date.now() - startedAt
      },
      db
    );
    throw err;
  }
}
```

- [ ] **Step 2: Write the unit shadow test (mocked db + adapter — no Postgres)**

```ts
// src/__tests__/worker.sync-orders.shadow.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-1', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

function dbMock() {
  const orderCreate = vi.fn().mockResolvedValue({});
  const orderUpdate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    organization: { findUnique: vi.fn().mockResolvedValue({ id: 'org1', partnerId: 'p1', companyId: 'c1' }) },
    order: { findUnique: vi.fn().mockResolvedValue(null), create: orderCreate, update: orderUpdate },
    syncLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as PrismaClient;
  return { db, orderCreate, orderUpdate };
}

describe('syncOrdersProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('counts wouldCreate without writing to the DB', async () => {
    const { db, orderCreate, orderUpdate } = dbMock();
    const result = await syncOrdersProcessor(job, db);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0); // fixtures resolve to the mocked org
    expect((db.syncState.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); // cursor not advanced in shadow
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('check');
  });
});
```

- [ ] **Step 3: Run the shadow unit test**

Run: `npx vitest run src/__tests__/worker.sync-orders.shadow.test.ts --mode=unit`
Expected: PASS.

- [ ] **Step 4: Update the shared integration test (`worker.oneCSync.upsert.test.ts`)**

Persistent cursors would otherwise break every existing test that expects a full pull (e.g. `writes Order.organizationId on create` would create 1 order, not 3, because the cursor filters the rest). Fix it once with a top-level `beforeEach` that clears `SyncState` before each test — so every existing assertion keeps its full-pull semantics, and only the new overlap test (which runs the processor twice *without* an interleaving clear) exercises incrementality.

(a) Add a `SyncState` cleanup line to `afterAll` (currently lines 166-173), before `deletePartnerCascade(partnerId)`:

```ts
  await prisma.syncState.deleteMany({});
```

(b) Add a top-level `beforeEach` immediately after the `afterAll(...)` block (before the first `describe`). It needs `beforeEach` in the vitest import on line 1:

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
```

```ts
beforeEach(async () => {
  // Every test starts from an empty cursor → full pull → existing assertions hold.
  // The one incremental test below clears once then runs the processor twice itself.
  await prisma.syncState.deleteMany({});
});
```

(c) Add a new incremental test at the end of the `syncOrdersProcessor` describe-block:

```ts
  it('advances the cursor so a re-run only re-pulls within the 5-min overlap window', async () => {
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '5';
    await cleanupDocs();
    await cleanupPayments();
    await cleanupOrders();
    await prisma.syncState.deleteMany({});

    const first = await syncOrdersProcessor(job(), prisma);
    expect(first.created).toBe(FAKE_ORDERS.length);

    // Second run WITHOUT clearing the cursor: only orders with updatedAt within
    // 5 min of the max watermark are re-pulled. FAKE_ORDERS have distinct, days-apart
    // updatedAt, so exactly the newest one falls inside the overlap window.
    const second = await syncOrdersProcessor(job(), prisma);
    expect(second.pulled).toBe(1);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
    await prisma.syncState.deleteMany({});
  });
```

- [ ] **Step 5: Run the full sync integration suite**

Run: `npx vitest run src/__tests__/worker.oneCSync.upsert.test.ts --mode=integration`
Expected: PASS — existing assertions hold (cursor cleared before full re-pull tests) + the new overlap test passes.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/worker/processors/sync-orders.ts src/__tests__/worker.sync-orders.shadow.test.ts src/__tests__/worker.oneCSync.upsert.test.ts
git commit -m "feat(1c): sync-orders — incremental cursor + record isolation + shadow mode"
```

---

## Task 7: Refactor `sync-payments.ts`

**Files:**
- Modify: `src/worker/processors/sync-payments.ts`
- Test (unit, shadow): `src/__tests__/worker.sync-payments.shadow.test.ts`

- [ ] **Step 1: Replace `sync-payments.ts`**

```ts
// src/worker/processors/sync-payments.ts
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import { mapPaymentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyManagers, notifyOrgUsers } from '@/lib/notifications';

export type SyncPaymentsResult = BatchSummary;

export async function syncPaymentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-payments job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'payment');
    const raw = (await adapter.pullPayments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCPaymentDto>(
      raw,
      OneCPaymentSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapPaymentDto(dto);
        const order = await db.order.findUnique({
          where: { externalId: input.orderExternalId },
          select: { id: true, organizationId: true, orderNumber: true, title: true }
        });
        if (!order) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
          return;
        }
        const existing = await db.payment.findUnique({
          where: { externalId: input.externalId },
          select: { id: true }
        });
        const updatable = { amount: input.amount, paidAt: input.paidAt, method: input.method, isRefund: input.isRefund };

        if (existing) {
          if (mode === 'live') await db.payment.update({ where: { id: existing.id }, data: updatable });
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.payment.create({ data: { ...updatable, externalId: input.externalId, orderId: order.id } });
          }
          sum.created += 1;
          bump(dto.updatedAt);

          if (mode === 'live' && order.organizationId && !input.isRefund) {
            try {
              await notifyOrgUsers(db, {
                organizationId: order.organizationId,
                type: 'payment_received',
                payload: {
                  orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title,
                  amount: input.amount.toString(), paidAt: input.paidAt
                }
              });
            } catch (err) {
              console.warn('[worker] sync-payments notifyOrgUsers failed', {
                orderId: order.id, externalId: input.externalId, error: err instanceof Error ? err.message : String(err)
              });
            }
          }
          if (mode === 'live' && !input.isRefund) {
            try {
              await notifyManagers(db, {
                orderId: order.id, type: 'order_marked_paid_by_1c',
                payload: { amount: Number(input.amount), paidAt: input.paidAt }
              });
            } catch (err) {
              console.warn('[worker] sync-payments notifyManagers failed', {
                orderId: order.id, externalId: input.externalId, error: err instanceof Error ? err.message : String(err)
              });
            }
          }
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'payment', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'payment',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'payment', message).catch(() => {});
    await writeSyncLog(
      { entity: 'payment', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
```

- [ ] **Step 2: Write the unit shadow test**

```ts
// src/__tests__/worker.sync-payments.shadow.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-pay', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

describe('syncPaymentsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not create/update payments and does not advance cursor', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      payment: { findUnique: vi.fn().mockResolvedValue(null), create, update },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncPaymentsProcessor(job, db);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run shadow unit test**

Run: `npx vitest run src/__tests__/worker.sync-payments.shadow.test.ts --mode=unit`
Expected: PASS.

- [ ] **Step 4: Run the integration suite (payments block uses the cleanup added in Task 6)**

Run: `npx vitest run src/__tests__/worker.oneCSync.upsert.test.ts --mode=integration`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/worker/processors/sync-payments.ts src/__tests__/worker.sync-payments.shadow.test.ts
git commit -m "feat(1c): sync-payments — incremental cursor + record isolation + shadow mode"
```

---

## Task 8: Refactor `sync-documents.ts`

**Files:**
- Modify: `src/worker/processors/sync-documents.ts`
- Test (unit, shadow): `src/__tests__/worker.sync-documents.shadow.test.ts`

- [ ] **Step 1: Replace `sync-documents.ts`**

```ts
// src/worker/processors/sync-documents.ts
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCDocumentDto } from '@/lib/services/oneCSync/dto';
import { mapDocumentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyOrgUsers } from '@/lib/notifications';

export type SyncDocumentsResult = BatchSummary;

export async function syncDocumentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncDocumentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-documents job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'document');
    const raw = (await adapter.pullDocuments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCDocumentDto>(
      raw,
      OneCDocumentSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapDocumentDto(dto);
        const order = await db.order.findUnique({
          where: { externalId: input.orderExternalId },
          select: { id: true, organizationId: true, orderNumber: true, title: true }
        });
        if (!order) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
          return;
        }
        const existing = await db.document.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
        const updatable = {
          name: input.name, path: input.downloadUrl, mimeType: input.mimeType,
          size: input.size, type: input.type, signedAt: input.signedAt
        };

        if (existing) {
          if (mode === 'live') await db.document.update({ where: { id: existing.id }, data: updatable });
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.document.create({
              data: { ...updatable, externalId: input.externalId, orderId: order.id, direction: 'incoming', generatedBy: 'system' }
            });
          }
          sum.created += 1;
          bump(dto.updatedAt);

          if (mode === 'live' && order.organizationId) {
            await notifyOrgUsers(db, {
              organizationId: order.organizationId,
              type: 'document_published',
              payload: {
                orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title,
                documentName: input.name, documentType: input.type
              }
            });
          }
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'document', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'document',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'document', message).catch(() => {});
    await writeSyncLog(
      { entity: 'document', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
```

- [ ] **Step 2: Write the unit shadow test**

```ts
// src/__tests__/worker.sync-documents.shadow.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-doc', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

describe('syncDocumentsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not create/update documents and does not advance cursor', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create, update },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncDocumentsProcessor(job, db);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run shadow unit test**

Run: `npx vitest run src/__tests__/worker.sync-documents.shadow.test.ts --mode=unit`
Expected: PASS.

- [ ] **Step 4: Run the integration suite**

Run: `npx vitest run src/__tests__/worker.oneCSync.upsert.test.ts --mode=integration`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/worker/processors/sync-documents.ts src/__tests__/worker.sync-documents.shadow.test.ts
git commit -m "feat(1c): sync-documents — incremental cursor + record isolation + shadow mode"
```

---

## Task 9: Refactor `sync-organizations.ts`

**Files:**
- Modify: `src/worker/processors/sync-organizations.ts`
- Test (unit, shadow): `src/__tests__/worker.sync-organizations.shadow.test.ts`

> The org create is wrapped in `$transaction` (Company + Organization atomically). In shadow mode the whole transaction is skipped.

- [ ] **Step 1: Replace `sync-organizations.ts`**

```ts
// src/worker/processors/sync-organizations.ts
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCOrgSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';
import { mapOrgDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';

export type SyncOrganizationsResult = BatchSummary;

async function resolvePartnerId(db: PrismaClient, partnerExternalId: string | null): Promise<string | null> {
  if (!partnerExternalId) return null;
  const partner = await db.partner.findUnique({ where: { slug: partnerExternalId }, select: { id: true } });
  return partner?.id ?? null;
}

export async function syncOrganizationsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrganizationsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-organizations job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'organization');
    const raw = (await adapter.pullOrganizations(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrgDto>(
      raw,
      OneCOrgSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapOrgDto(dto);
        const partnerId = await resolvePartnerId(db, input.partnerExternalId);
        if (!partnerId) {
          sum.skipped += 1;
          sum.skips.push({
            externalId: input.externalId,
            reason: input.partnerExternalId ? 'partner_not_found' : 'no_partner_external_id'
          });
          return;
        }
        const existing = await db.organization.findUnique({
          where: { externalId: input.externalId },
          select: { id: true, companyId: true }
        });

        if (existing) {
          if (mode === 'live') {
            await db.organization.update({
              where: { id: existing.id },
              data: { name: input.name, inn: input.inn, kpp: input.kpp }
            });
          }
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.$transaction(async (tx) => {
              const company = await tx.company.create({ data: { name: input.name } });
              await tx.organization.create({
                data: { externalId: input.externalId, name: input.name, inn: input.inn, kpp: input.kpp, partnerId, companyId: company.id }
              });
            });
          }
          sum.created += 1;
          bump(dto.updatedAt);
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'organization', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'organization',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'organization', message).catch(() => {});
    await writeSyncLog(
      { entity: 'organization', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
```

- [ ] **Step 2: Write the unit shadow test**

```ts
// src/__tests__/worker.sync-organizations.shadow.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-org', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

describe('syncOrganizationsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not run the create transaction or advance cursor', async () => {
    const tx = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: { findUnique: vi.fn().mockResolvedValue(null), update },
      $transaction: tx,
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);
    expect(tx).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run shadow unit test**

Run: `npx vitest run src/__tests__/worker.sync-organizations.shadow.test.ts --mode=unit`
Expected: PASS.

- [ ] **Step 4: Run the full sync integration suite (all 4 processors now refactored)**

Run: `npx vitest run src/__tests__/worker.oneCSync.upsert.test.ts --mode=integration`
Expected: PASS — all describe-blocks green.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/worker/processors/sync-organizations.ts src/__tests__/worker.sync-organizations.shadow.test.ts
git commit -m "feat(1c): sync-organizations — incremental cursor + record isolation + shadow mode"
```

---

## Task 10: `Lead.pushedToOneCAt` + idempotent push

**Files:**
- Modify: `prisma/schema.prisma` (Lead model, after line 165)
- Modify: `src/lib/services/oneCSync/push.ts`
- Modify: `src/__tests__/services.oneCSync.push.test.ts`

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, in `model Lead`, immediately after `externalIdInOneC   String?` (line 165), add:

```prisma
  pushedToOneCAt     DateTime?
```

- [ ] **Step 2: Migrate + generate**

```bash
npm run prisma:migrate -- --name lead_pushed_at
npm run prisma:generate
```
Expected: migration adds nullable `pushedToOneCAt` to `Lead`.

- [ ] **Step 3: Update the existing push unit test (mocked lead needs the new field + guard test)**

In `src/__tests__/services.oneCSync.push.test.ts`:

(a) Add `pushedToOneCAt: Date | null;` to the `lead` shape in `makePrismaMock` (after `partner: { slug: string | null };`), and add `pushedToOneCAt: null` to **both** populated `lead` fixtures (the `lead-1` and `lead-2` objects).

(b) Change the happy-path `updateSpy` assertion (currently lines 83-86) to:

```ts
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ externalIdInOneC: 'fake-req-99', pushedToOneCAt: expect.any(Date) })
    });
```

(c) Add a new test inside `describe('pushLeadToOneC', ...)`:

```ts
  it('skips the adapter when the lead was already pushed (idempotent)', async () => {
    const already = new Date('2026-05-22T10:00:00Z');
    const { prisma, updateSpy, logSpy } = makePrismaMock({
      lead: {
        id: 'lead-3', clientCompanyName: 'A', clientInn: null, clientContactName: 'B',
        clientContactPhone: null, clientContactEmail: null, subject: 'S',
        estimatedAmount: null, productType: [], notes: null, partner: { slug: 'demo' },
        pushedToOneCAt: already
      }
    });
    const pushLead = vi.fn();
    const adapter = { pullOrganizations: vi.fn(), pullOrders: vi.fn(), pullPayments: vi.fn(), pullDocuments: vi.fn(), pushLead } as unknown as import('@/lib/services/oneCSync/adapter').OneCAdapter;
    const res = await pushLeadToOneC(prisma, 'lead-3', { adapter });
    expect(res.ok).toBe(true);
    expect(pushLead).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0].data.operation).toBe('skip');
    expect(logSpy.mock.calls[0][0].data.status).toBe('success');
  });
```

- [ ] **Step 4: Run the push test to verify the new test FAILS (guard not implemented yet)**

Run: `npx vitest run src/__tests__/services.oneCSync.push.test.ts --mode=unit`
Expected: FAIL — the idempotent-skip test fails (adapter IS called) and/or the happy-path objectContaining fails (pushedToOneCAt not set).

- [ ] **Step 5: Implement the guard in `push.ts`**

In `src/lib/services/oneCSync/push.ts`, after the `if (!lead) { ... }` block (ends line 71) and before `const payload = mapLeadToPayload(lead);`, insert:

```ts
  if (lead.pushedToOneCAt) {
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'skip',
        status: 'success',
        externalId: lead.externalIdInOneC ?? undefined,
        payload: { cabinetLeadId: lead.id, reason: 'already_pushed' }
      },
      prisma
    );
    return {
      ok: true,
      result: { acceptedAt: lead.pushedToOneCAt.toISOString(), oneCRequestId: lead.externalIdInOneC ?? undefined },
      externalIdInOneC: lead.externalIdInOneC
    };
  }
```

Then change the success-path `prisma.lead.update` (currently lines 80-83) to always stamp `pushedToOneCAt`:

```ts
    await prisma.lead.update({
      where: { id: lead.id },
      data: { pushedToOneCAt: new Date(), ...(externalIdInOneC ? { externalIdInOneC } : {}) }
    });
```

- [ ] **Step 6: Run the push test to verify it passes**

Run: `npx vitest run src/__tests__/services.oneCSync.push.test.ts --mode=unit`
Expected: PASS (all tests, including the new idempotent-skip).

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add prisma/schema.prisma prisma/migrations src/lib/services/oneCSync/push.ts src/__tests__/services.oneCSync.push.test.ts
git commit -m "feat(1c): idempotent lead push (pushedToOneCAt guard)"
```

---

## Task 11: Fake-adapter fidelity + contract test

**Files:**
- Modify: `src/lib/services/oneCSync/adapter-fake.ts`
- Test: `src/__tests__/oneCSync.adapter-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
// src/__tests__/oneCSync.adapter-contract.test.ts
import { describe, expect, it, afterEach } from 'vitest';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import { parseRecords } from '@/lib/services/oneCSync/resilience';

afterEach(() => {
  delete process.env.FAKE_ONEC_MALFORMED_RATE;
});

describe('OneCAdapter contract — FakeOneCAdapter', () => {
  const adapter = new FakeOneCAdapter();

  it('pull* output validates against the schemas (clean fixtures)', async () => {
    expect(parseRecords(OneCOrgSchema, await adapter.pullOrganizations({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCOrderSchema, await adapter.pullOrders({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCPaymentSchema, await adapter.pullPayments({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCDocumentSchema, await adapter.pullDocuments({})).invalid).toHaveLength(0);
  });

  it('honours the since cursor (returns only newer records)', async () => {
    const all = await adapter.pullOrders({});
    const maxTs = all.map((o) => o.updatedAt).sort().at(-1)!;
    const after = await adapter.pullOrders({ since: maxTs });
    expect(after).toHaveLength(0);
  });

  it('pushLead returns an acceptedAt', async () => {
    const r = await adapter.pushLead({ cabinetLeadId: 'l', clientCompanyName: 'c', clientContactName: 'n', subject: 's', productType: [] });
    expect(r.acceptedAt).toBeTruthy();
  });

  it('FAKE_ONEC_MALFORMED_RATE=1 injects a record that fails validation (exercises quarantine)', async () => {
    process.env.FAKE_ONEC_MALFORMED_RATE = '1';
    const raw = await adapter.pullOrders({});
    const { invalid } = parseRecords(OneCOrderSchema, raw);
    expect(invalid.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.adapter-contract.test.ts --mode=unit`
Expected: FAIL — the malformed-injection test fails (no malformed support yet).

- [ ] **Step 3: Add fidelity to `adapter-fake.ts`**

Replace `src/lib/services/oneCSync/adapter-fake.ts` with:

```ts
// src/lib/services/oneCSync/adapter-fake.ts
import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor
} from './dto';
import { FAKE_ORGS } from './fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from './fixtures/orders';

function afterCursor<T extends { updatedAt: string }>(items: T[], cursor: SyncCursor): T[] {
  if (!cursor.since) return items;
  const sinceTs = Date.parse(cursor.since);
  return items.filter((item) => Date.parse(item.updatedAt) > sinceTs);
}

/**
 * When FAKE_ONEC_MALFORMED_RATE is set (0..1), appends a deliberately-invalid
 * record so tests can exercise the per-record validation quarantine. The output
 * is typed `unknown[]`-compatible; callers validate via schemas.
 */
function maybeInjectMalformed<T>(items: T[]): T[] {
  const rate = Number(process.env.FAKE_ONEC_MALFORMED_RATE);
  if (Number.isFinite(rate) && rate > 0) {
    const malformed = { externalId: 'fake-malformed', broken: true } as unknown as T;
    return [...items, malformed];
  }
  return items;
}

async function maybeLatency(): Promise<void> {
  const ms = Number(process.env.FAKE_ONEC_LATENCY_MS);
  if (Number.isFinite(ms) && ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export class FakeOneCAdapter implements OneCAdapter {
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_ORGS, cursor));
  }
  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_ORDERS, cursor));
  }
  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_PAYMENTS, cursor));
  }
  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    await maybeLatency();
    return maybeInjectMalformed(afterCursor(FAKE_DOCUMENTS, cursor));
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    const failureRateStr = process.env.FAKE_ONEC_FAILURE_RATE;
    const failureRate = failureRateStr ? Number(failureRateStr) : 0;
    if (Number.isFinite(failureRate) && failureRate > 0 && Math.random() < failureRate) {
      throw new Error(`FakeOneC simulated failure (rate=${failureRate}) for lead ${payload.cabinetLeadId}`);
    }
    return { acceptedAt: new Date().toISOString(), oneCRequestId: `fake-req-${Date.now()}` };
  }
}
```

> Note: the injected malformed record means a `pullOrders({})` under `FAKE_ONEC_MALFORMED_RATE=1` returns one extra item. Keep this env UNSET in `worker.oneCSync.upsert.test.ts` (it is, by default) so existing `pulled` counts stay exact.

- [ ] **Step 4: Run the contract test**

Run: `npx vitest run src/__tests__/oneCSync.adapter-contract.test.ts --mode=unit`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/services/oneCSync/adapter-fake.ts src/__tests__/oneCSync.adapter-contract.test.ts
git commit -m "feat(1c): fake-adapter fidelity (malformed/latency) + adapter contract test"
```

---

## Task 12: REST adapter skeleton + wire module + factory

**Files:**
- Create: `src/lib/services/oneCSync/rest-wire.ts`
- Create: `src/lib/services/oneCSync/adapter-rest.ts`
- Modify: `src/lib/services/oneCSync/index.ts`
- Modify: `src/__tests__/oneCSync.factory.test.ts`
- Modify: `.env.example`
- Test: `src/__tests__/oneCSync.adapter-rest.test.ts`

- [ ] **Step 1: Write the failing REST adapter test (mocked fetch)**

```ts
// src/__tests__/oneCSync.adapter-rest.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';

const config = { baseUrl: 'https://1c.example.com', token: 'tok' };
const validOrder = {
  externalId: '1c-order-1', title: 'T', organizationExternalId: '1c-org-1',
  totalAmount: 100, paidAmount: 50, vatIncluded: true,
  executionStatus: 'in_progress', financialStatus: 'partially_paid',
  productMix: ['training'], updatedAt: '2026-05-01T00:00:00Z'
};

afterEach(() => vi.unstubAllGlobals());

describe('RestOneCAdapter', () => {
  it('fetches with Bearer auth + since param and returns a bare JSON array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [validOrder] });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new RestOneCAdapter(config);
    const rows = await adapter.pullOrders({ since: '2026-04-01T00:00:00Z' });

    expect(rows).toEqual([validOrder]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/orders');
    expect(String(url)).toContain('since=2026-04-01T00%3A00%3A00Z');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('unwraps an { items: [] } envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [validOrder] }) }));
    const rows = await new RestOneCAdapter(config).pullOrders({});
    expect(rows).toHaveLength(1);
  });

  it('throws OneCHttpError on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }));
    await expect(new RestOneCAdapter(config).pullOrders({})).rejects.toThrow(/500/);
  });

  it('pushLead POSTs and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedAt: '2026-05-01T00:00:00Z', oneCRequestId: 'r1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new RestOneCAdapter(config).pushLead({ cabinetLeadId: 'l', clientCompanyName: 'c', clientContactName: 'n', subject: 's', productType: [] });
    expect(r.oneCRequestId).toBe('r1');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oneCSync.adapter-rest.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `rest-wire.ts` (ALL meeting-blocked decisions live here)**

```ts
// src/lib/services/oneCSync/rest-wire.ts
//
// EVERYTHING in this file depends on answers from the 1C integration meeting
// (docs/integrations/1c-meeting-agenda.md). Each constant is tagged with its
// DECISION Q#. If 1C answers "not REST" (Q1), this file + adapter-rest.ts are
// the only throwaway code — the rest of oneCSync is transport-agnostic.
import type { SyncCursor, OneCLeadPushPayload } from './dto';

// DECISION Q1: REST endpoint paths (or OData / file-export).
export const ENDPOINTS = {
  organizations: '/api/organizations',
  orders: '/api/orders',
  payments: '/api/payments',
  documents: '/api/documents',
  leadPush: '/api/leads'
} as const;

// DECISION Q6/Q7: incremental cursor query param + datetime format on the wire.
export const SINCE_PARAM = 'since';
export function formatSince(sinceIso: string): string {
  return sinceIso; // ISO passthrough; adjust if 1C wants МСК / no-offset (Q7).
}

// DECISION Q2: authentication. Bearer is the agenda default.
export function buildAuthHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// DECISION Q1: response envelope shape. Assume a bare array; tolerate { items: [] }.
export function unwrapEnvelope(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  throw new Error('Unexpected 1C response envelope (expected JSON array or { items: [] })');
}

export function buildUrl(baseUrl: string, path: string, cursor: SyncCursor): string {
  const url = new URL(path, baseUrl);
  if (cursor.since) url.searchParams.set(SINCE_PARAM, formatSince(cursor.since));
  return url.toString();
}

// DECISION Q8: lead push body shape. Default: send the payload as-is.
export function buildLeadBody(payload: OneCLeadPushPayload): unknown {
  return payload;
}
```

- [ ] **Step 4: Write `adapter-rest.ts`**

```ts
// src/lib/services/oneCSync/adapter-rest.ts
import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto,
  OneCLeadPushPayload, OneCLeadPushResult, SyncCursor
} from './dto';
import { OneCLeadPushResultSchema } from './schemas';
import { withTimeout, withRetry, OneCHttpError } from './resilience';
import { ENDPOINTS, buildAuthHeader, buildUrl, buildLeadBody, unwrapEnvelope } from './rest-wire';

export type RestAdapterConfig = { baseUrl: string; token: string };

async function doFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    const retryAfterHeader = Number(res.headers?.get?.('retry-after'));
    const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
    throw new OneCHttpError(res.status, `1C responded ${res.status} for ${url}`, retryAfter);
  }
  return res.json();
}

export class RestOneCAdapter implements OneCAdapter {
  constructor(private readonly config: RestAdapterConfig) {}

  private async getArray(path: string, cursor: SyncCursor): Promise<unknown[]> {
    const url = buildUrl(this.config.baseUrl, path, cursor);
    const headers = { ...buildAuthHeader(this.config.token), Accept: 'application/json' };
    const raw = await withRetry(() => withTimeout((signal) => doFetch(url, { method: 'GET', headers }, signal)));
    return unwrapEnvelope(raw);
  }

  // Returned arrays are validated per-record downstream by runRecordBatch (schemas).
  pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    return this.getArray(ENDPOINTS.organizations, cursor) as Promise<OneCOrgDto[]>;
  }
  pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    return this.getArray(ENDPOINTS.orders, cursor) as Promise<OneCOrderDto[]>;
  }
  pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    return this.getArray(ENDPOINTS.payments, cursor) as Promise<OneCPaymentDto[]>;
  }
  pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    return this.getArray(ENDPOINTS.documents, cursor) as Promise<OneCDocumentDto[]>;
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    const url = buildUrl(this.config.baseUrl, ENDPOINTS.leadPush, {});
    const headers = { ...buildAuthHeader(this.config.token), 'Content-Type': 'application/json', Accept: 'application/json' };
    const body = JSON.stringify(buildLeadBody(payload));
    const raw = await withRetry(() => withTimeout((signal) => doFetch(url, { method: 'POST', headers, body }, signal)));
    return OneCLeadPushResultSchema.parse(raw);
  }
}
```

- [ ] **Step 5: Run the REST adapter test**

Run: `npx vitest run src/__tests__/oneCSync.adapter-rest.test.ts --mode=unit`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the factory + update the factory test**

Replace `src/lib/services/oneCSync/index.ts` with:

```ts
// src/lib/services/oneCSync/index.ts
import type { OneCAdapter } from './adapter';
import { FakeOneCAdapter } from './adapter-fake';
import { RestOneCAdapter } from './adapter-rest';

let cached: OneCAdapter | null = null;

export function getOneCAdapter(): OneCAdapter {
  if (cached) return cached;
  const kind = (process.env.ONE_C_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeOneCAdapter();
      return cached;
    case 'rest': {
      const baseUrl = process.env.ONE_C_API_URL;
      const token = process.env.ONE_C_API_TOKEN;
      if (!baseUrl) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_URL');
      if (!token) throw new Error('ONE_C_ADAPTER=rest requires ONE_C_API_TOKEN');
      cached = new RestOneCAdapter({ baseUrl, token });
      return cached;
    }
    case 'file':
      throw new Error('File 1C adapter is not implemented yet (Phase 3)');
    default:
      throw new Error(`Unknown ONE_C_ADAPTER value: ${kind}`);
  }
}

export function resetOneCAdapter(): void {
  cached = null;
}

export type { OneCAdapter } from './adapter';
export * from './dto';
```

In `src/__tests__/oneCSync.factory.test.ts`, replace the third test (the one expecting `/not implemented/i` for rest, lines 20-23) with:

```ts
  it('throws a config error when ONE_C_ADAPTER=rest without ONE_C_API_URL', () => {
    process.env.ONE_C_ADAPTER = 'rest';
    delete process.env.ONE_C_API_URL;
    delete process.env.ONE_C_API_TOKEN;
    expect(() => getOneCAdapter()).toThrow(/ONE_C_API_URL/);
  });

  it('returns RestOneCAdapter when ONE_C_ADAPTER=rest with URL + token', async () => {
    process.env.ONE_C_ADAPTER = 'rest';
    process.env.ONE_C_API_URL = 'https://1c.example.com';
    process.env.ONE_C_API_TOKEN = 'tok';
    const { RestOneCAdapter } = await import('@/lib/services/oneCSync/adapter-rest');
    expect(getOneCAdapter()).toBeInstanceOf(RestOneCAdapter);
    delete process.env.ONE_C_API_URL;
    delete process.env.ONE_C_API_TOKEN;
  });
```

- [ ] **Step 7: Update `.env.example`** — replace lines 34-38 (the `# 1С интеграция` block) with:

```bash
# 1С интеграция: fake (default — данные in-memory) | rest | file
ONE_C_ADAPTER=fake
# Режим записи: live (по умолчанию — пишет в БД) | shadow (читает реальную 1С,
# валидирует и логирует намерения в SyncLog, НИЧЕГО не пишет — для безопасного cutover).
# ONE_C_MODE=live
# REST-адаптер (ONE_C_ADAPTER=rest требует обе переменные):
# ONE_C_API_URL=https://1c.example.com
# ONE_C_API_TOKEN=replace_with_token
# Таймаут одного HTTP-запроса к 1С, мс (по умолчанию 15000):
# ONE_C_HTTP_TIMEOUT_MS=15000
# Safety-overlap инкрементального курсора, мин (по умолчанию 5):
# ONE_C_CURSOR_OVERLAP_MINUTES=5
```

- [ ] **Step 8: Run factory test + full unit suite + typecheck**

Run: `npx vitest run src/__tests__/oneCSync.factory.test.ts --mode=unit && npm run typecheck && npm run test:unit`
Expected: factory test PASS; typecheck PASS; whole unit suite PASS (no regressions).

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/oneCSync/rest-wire.ts src/lib/services/oneCSync/adapter-rest.ts src/lib/services/oneCSync/index.ts src/__tests__/oneCSync.adapter-rest.test.ts src/__tests__/oneCSync.factory.test.ts .env.example
git commit -m "feat(1c): REST adapter skeleton + isolated wire module + factory wiring"
```

---

## Task 13: Cursor-lag observability + `/admin/sync` column

**Files:**
- Modify: `src/lib/services/syncSummary.ts`
- Modify: `src/app/admin/sync/page.tsx`
- Test (integration): `src/__tests__/services.syncSummary.cursor.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/services.syncSummary.cursor.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSyncSummary } from '@/lib/services/syncSummary';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.syncState.deleteMany({});
});
afterAll(async () => {
  await prisma.syncState.deleteMany({});
  await prisma.$disconnect();
});

describe('getSyncSummary cursor + lag', () => {
  it('exposes cursor and lagMs per entity (null when no SyncState row)', async () => {
    const before = await getSyncSummary(prisma);
    const orderBefore = before.find((r) => r.entity === 'order')!;
    expect(orderBefore.cursor).toBeNull();
    expect(orderBefore.lagMs).toBeNull();

    await prisma.syncState.create({ data: { entity: 'order', cursor: '2026-05-01T00:00:00.000Z' } });

    const after = await getSyncSummary(prisma);
    const orderAfter = after.find((r) => r.entity === 'order')!;
    expect(orderAfter.cursor).toBe('2026-05-01T00:00:00.000Z');
    expect(orderAfter.lagMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services.syncSummary.cursor.test.ts --mode=integration`
Expected: FAIL — `cursor`/`lagMs` are not on `SyncSummaryRow`.

- [ ] **Step 3: Extend `syncSummary.ts`**

In `src/lib/services/syncSummary.ts`, add two fields to `SyncSummaryRow` (after `lastErrorMessage: string | null;`):

```ts
  cursor: string | null;
  lagMs: number | null;
```

Then, inside the `for (const entity of TRACKED_ENTITIES)` loop, add a `syncState` lookup to the `Promise.all` and compute lag. Replace the `Promise.all([...])` destructuring and the `rows.push({...})` with:

```ts
    const [successCount24h, warnCount24h, errorCount24h, lastSuccess, lastError, state] = await Promise.all([
      prisma.syncLog.count({ where: { entity, direction: 'inbound', status: 'success', createdAt: { gte: since } } }),
      prisma.syncLog.count({ where: { entity, direction: 'inbound', status: 'warn', createdAt: { gte: since } } }),
      prisma.syncLog.count({ where: { entity, direction: 'inbound', status: 'error', createdAt: { gte: since } } }),
      prisma.syncLog.findFirst({ where: { entity, direction: 'inbound', status: 'success' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.syncLog.findFirst({ where: { entity, direction: 'inbound', status: 'error' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, errorMessage: true } }),
      prisma.syncState.findUnique({ where: { entity }, select: { cursor: true } })
    ]);

    const cursor = state?.cursor ?? null;
    const lagMs = cursor ? Date.now() - Date.parse(cursor) : null;

    rows.push({
      entity,
      successCount24h,
      warnCount24h,
      errorCount24h,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      lastErrorAt: lastError?.createdAt ?? null,
      lastErrorMessage: lastError?.errorMessage ?? null,
      cursor,
      lagMs
    });
```

- [ ] **Step 4: Run integration test to verify it passes**

Run: `npx vitest run src/__tests__/services.syncSummary.cursor.test.ts --mode=integration`
Expected: PASS.

- [ ] **Step 5: Add the column to `/admin/sync/page.tsx`**

In `src/app/admin/sync/page.tsx`, add a lag formatter near `formatDate` (after line 33):

```ts
function formatLag(lagMs: number | null): string {
  if (lagMs === null) return '—';
  const h = lagMs / (60 * 60 * 1000);
  if (h < 1) return `${Math.round(lagMs / 60000)} мин`;
  return `${h.toFixed(1)} ч`;
}
```

Add a header cell after `<th ...>Ошибок</th>` (line 56):

```tsx
              <th className='text-left px-4 py-3 font-medium'>Курсор / лаг</th>
```

Add a body cell after the "Ошибок" `<td>` (after line 70, before the "Последний успех" `<td>`):

```tsx
                <td className='px-4 py-3'>
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${freshnessClass(r.cursor ? new Date(r.cursor) : null)}`}>
                    {formatLag(r.lagMs)}
                  </span>
                </td>
```

- [ ] **Step 6: Typecheck (server component — render is covered by manual/e2e, not unit)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/syncSummary.ts src/app/admin/sync/page.tsx src/__tests__/services.syncSummary.cursor.test.ts
git commit -m "feat(1c): cursor-lag in sync summary + /admin/sync column"
```

---

## Final verification

- [ ] **Full unit suite + typecheck + lint**

```bash
npm run typecheck && npm run lint && npm run test:unit
```
Expected: all green.

- [ ] **Full integration suite (live Postgres)**

```bash
npm run test:integration
```
Expected: all green — including the refactored `worker.oneCSync.upsert.test.ts`, `oneCSync.cursor.integration.test.ts`, and `services.syncSummary.cursor.test.ts`.

- [ ] **Gate (ephemeral Docker Postgres, mirrors pre-push L2.5)**

```bash
npm run gate
```
Expected: migrate + seed + integration all pass against the ephemeral DB. (`npm run gate:down` to stop.)

- [ ] **Manual shadow-mode smoke (optional, documents the cutover path)**

With a worker running and `ONE_C_ADAPTER=fake ONE_C_MODE=shadow`, trigger a sync and confirm `/admin/sync` shows `operation: 'check'` SyncLog rows and **no** new DB rows. This rehearses the real cutover: `rest` + `shadow` on staging → watch `/admin/sync` → flip to `live`.

---

## Spec coverage check

| Spec §| Covered by |
|---|---|
| §4.1 SyncState cursor (overlap 5) | Task 1 (config), Task 2 (model+helper), Tasks 6-9 (wired) |
| §4.2 zod validation, 2-level | Task 3 (schemas), Task 5 (runRecordBatch quarantine), processors (envelope→error) |
| §4.3 per-record isolation | Task 5 + Tasks 6-9 |
| §4.4 idempotent push + pushedToOneCAt | Task 10 |
| §4.5 resilience helpers | Task 4 |
| §4.6 REST skeleton + isolated wire | Task 12 |
| §4.7 shadow mode + cutover runbook | Tasks 6-9 (commit-gate) + Final verification |
| §4.8 fake fidelity + contract test | Task 11 |
| §4.9 cursor-lag + /admin/sync UI | Task 13 |
| §6 error handling table | Tasks 4, 5, 6-9 (markCursorError, batchStatus) |
| §7 tests | per-task unit + integration |
