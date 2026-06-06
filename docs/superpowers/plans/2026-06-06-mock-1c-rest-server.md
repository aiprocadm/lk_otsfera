# Mock-REST 1С — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, runnable mock 1С REST server that speaks the exact `rest-wire.ts` dialect and can deliberately trigger the 3 meeting landmines (Q10 Russian stages, Q6 pagination, Q7 no-TZ datetime) plus transport anomalies, so `RestOneCAdapter` + the full shadow pipeline can be exercised and rehearsed locally before the 1С meeting.

**Architecture:** New top-level `mock-1c/` directory (outside `src/`, outside the Next build). A pure `core/` (dataset + scenario shaping + lead store) seeded from the SAME `src/lib/services/oneCSync/fixtures/*`, wrapped by a thin Node `http` server. Dependency direction is one-way: `mock-1c → src` (never the reverse), enforced by an ESLint guardrail. The worker points at it via env only (`ONE_C_ADAPTER=rest`, `ONE_C_API_URL`, `ONE_C_MODE=shadow`).

**Tech Stack:** TypeScript 5 (strict) · Node built-in `http` · `tsx` (run) · `zod` (reuse our DTO schemas) · Vitest (unit + server-backed contract test). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-06-06-mock-1c-rest-server-design.md](../specs/2026-06-06-mock-1c-rest-server-design.md)

**Conventions (CLAUDE.md):** strict TS; `@/...` alias; Russian user-facing strings, English identifiers/error codes (§13); TDD RED→GREEN→REFACTOR (§6); frequent commits. **All commits end with the repo's `Co-Authored-By` trailer** (omitted from the snippets below for brevity).

---

## File Structure

| File | Responsibility |
|---|---|
| `mock-1c/core/scenario.ts` | `ScenarioConfig` type, `DEFAULT_SCENARIO`, enum value lists. Pure, no I/O. |
| `mock-1c/core/serialize.ts` | Pure response shaping: dialect (Q10), datetime (Q7), malformed, duplicates, pagination (Q6), envelope (Q1). The heart. |
| `mock-1c/core/dataset.ts` | In-memory store seeded from `fixtures/*`; `since`-filter + `touch`. |
| `mock-1c/core/leads.ts` | Lead store: dedup by `cabinetLeadId`, partner-key observation (Q5), push-fail injection. |
| `mock-1c/config.ts` | `loadScenario(env)` (fail-fast) + `loadServerConfig(env)` (port, token). |
| `mock-1c/server.ts` | `createMock1cServer(opts)` → `http.Server`: routes 5 ENDPOINTS + `/__control` + `/__state` + `/__health`; Bearer check; HTTP anomalies. No business logic. |
| `mock-1c/main.ts` | Entry: load env → build dataset/leadStore/server → listen. `npm run mock:1c`. |
| `mock-1c/adapter-rest.contract.test.ts` | Server-backed: real `RestOneCAdapter` against a booted server on an ephemeral port. |
| `mock-1c/README.md` | How to run + scenario table + shadow-rehearsal runbook. |
| `vitest.config.ts` (modify) | Discover tests under `mock-1c/` too (existence-guarded). |
| `eslint.config.mjs` (modify) | Guardrail: `src/**` must not import `mock-1c`. |
| `package.json` (modify) | `"mock:1c": "tsx mock-1c/main.ts"`. |
| `.env.example` (modify) | `MOCK1C_*` block + shadow-rehearsal example. |

---

## Task 0: Extend test discovery to `mock-1c/` (do this FIRST)

**Files:**
- Modify: `vitest.config.ts`

Vitest builds its `include` list from a fixed scan of test roots. Until `mock-1c/` is a scanned root, `vitest run mock-1c/...` matches nothing — so this must land before any mock test is written. The change is safe before `mock-1c/` exists (a missing dir yields no files).

- [ ] **Step 1: Scan both roots**

In `vitest.config.ts`, replace:
```ts
const TEST_ROOT = path.resolve(__dirname, 'src/__tests__');
```
with:
```ts
const TEST_ROOTS = [path.resolve(__dirname, 'src/__tests__'), path.resolve(__dirname, 'mock-1c')];
```

And replace:
```ts
const allTestFiles = listTestFiles(TEST_ROOT);
```
with:
```ts
const allTestFiles = TEST_ROOTS.flatMap((root) => {
  try { return listTestFiles(root); } catch { return []; } // mock-1c may not exist yet
});
```

- [ ] **Step 2: Verify no regression (src tests still discovered)**

Run: `npx vitest run src/__tests__/featureFlags.test.ts`
Expected: PASS (mock-1c is absent → `try/catch` yields `[]` → existing behaviour unchanged).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore(mock1c): vitest discovers the mock-1c/ test root"
```

---

## Task 1: Scenario types + response shaping (`serialize.ts`)

**Files:**
- Create: `mock-1c/core/scenario.ts`
- Create: `mock-1c/core/serialize.ts`
- Test: `mock-1c/core/serialize.test.ts`

- [ ] **Step 1: Create the scenario types/constants module**

Create `mock-1c/core/scenario.ts`:

```ts
// Mock 1С scenario configuration. Pure data — no env, no I/O.
// Mirrors the // DECISION Q# surface of src/lib/services/oneCSync/rest-wire.ts:
// every knob here flips a behavior the real adapter must cope with.

export type EnvelopeShape = 'array' | 'items' | 'other'; // Q1
export type StatusDialect = 'app' | 'russian';           // Q10
export type DatetimeFormat = 'utc-z' | 'no-offset';      // Q7
export type FailMode = 'none' | 'transient' | 'permanent';

export type ScenarioConfig = {
  envelope: EnvelopeShape;
  statusDialect: StatusDialect;
  datetime: DatetimeFormat;
  pageSize: number;     // Q6: 0 = no pagination; >0 = serve only the first page
  malformedRate: number; // >0 appends one schema-breaking record
  duplicates: boolean;   // repeat the first record (same externalId)
  failMode: FailMode;
  latencyMs: number;     // artificial delay before responding
  pushFailRate: number;  // 0..1 chance POST /api/leads returns 500
};

export const DEFAULT_SCENARIO: ScenarioConfig = {
  envelope: 'array',
  statusDialect: 'app',
  datetime: 'utc-z',
  pageSize: 0,
  malformedRate: 0,
  duplicates: false,
  failMode: 'none',
  latencyMs: 0,
  pushFailRate: 0
};

export const ENVELOPE_VALUES: EnvelopeShape[] = ['array', 'items', 'other'];
export const DIALECT_VALUES: StatusDialect[] = ['app', 'russian'];
export const DATETIME_VALUES: DatetimeFormat[] = ['utc-z', 'no-offset'];
export const FAIL_MODE_VALUES: FailMode[] = ['none', 'transient', 'permanent'];
```

- [ ] **Step 2: Write the failing test for `serialize.ts`**

Create `mock-1c/core/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OneCOrderSchema } from '@/lib/services/oneCSync/schemas';
import { DEFAULT_SCENARIO } from './scenario';
import {
  applyDialect, applyDatetime, injectMalformed, injectDuplicates, paginate, wrapEnvelope, shapeResponse
} from './serialize';

const order = {
  externalId: '1c-order-1001', title: 'T', organizationExternalId: '1c-org-001',
  totalAmount: 1, paidAmount: 1, vatIncluded: true,
  executionStatus: 'completed', financialStatus: 'paid',
  productMix: ['training'], updatedAt: '2026-05-12T10:00:00Z', paidAt: '2026-04-20T14:00:00Z'
};

describe('applyDialect (Q10)', () => {
  it('rewrites order statuses to Russian (breaks z.enum on purpose)', () => {
    const out = applyDialect(order, 'russian') as Record<string, unknown>;
    expect(out.executionStatus).toBe('Выполнен');
    expect(out.financialStatus).toBe('Оплачен');
    expect(OneCOrderSchema.safeParse(out).success).toBe(false);
  });
  it('leaves records untouched in app dialect', () => {
    expect(applyDialect(order, 'app')).toEqual(order);
  });
});

describe('applyDatetime (Q7)', () => {
  it('strips the offset (still passes the permissive zod, but is server-local)', () => {
    const out = applyDatetime(order, 'no-offset') as Record<string, unknown>;
    expect(out.updatedAt).toBe('2026-05-12T10:00:00');
    expect(out.paidAt).toBe('2026-04-20T14:00:00');
    expect(OneCOrderSchema.safeParse(out).success).toBe(true); // silent hazard, not quarantine
  });
});

describe('injectMalformed / injectDuplicates', () => {
  it('appends one schema-breaking record when rate > 0', () => {
    const out = injectMalformed([order], 0.5);
    expect(out).toHaveLength(2);
    expect(OneCOrderSchema.safeParse(out[1]).success).toBe(false);
  });
  it('repeats the first record when duplicates on', () => {
    const out = injectDuplicates([order]);
    expect(out).toHaveLength(2);
    expect((out[1] as Record<string, unknown>).externalId).toBe('1c-order-1001');
  });
});

describe('paginate (Q6) + wrapEnvelope (Q1)', () => {
  it('serves only the first page and reports the rest in meta', () => {
    const { page, meta } = paginate([order, { ...order, externalId: 'b' }, { ...order, externalId: 'c' }], 2);
    expect(page).toHaveLength(2);
    expect(meta).toEqual({ total: 3, pages: 2, served: 2 });
  });
  it('wraps per envelope flag', () => {
    expect(wrapEnvelope([order], 'array')).toEqual([order]);
    expect(wrapEnvelope([order], 'items')).toEqual({ items: [order] });
    expect(wrapEnvelope([order], 'other')).toEqual({ data: [order] });
  });
});

describe('shapeResponse (composition)', () => {
  it('paginating forces an { items, nextCursor } body regardless of envelope flag', () => {
    const records = [order, { ...order, externalId: 'b' }, { ...order, externalId: 'c' }];
    const { body, meta } = shapeResponse(records, { ...DEFAULT_SCENARIO, pageSize: 2, envelope: 'array' });
    expect(Array.isArray((body as { items: unknown[] }).items)).toBe(true);
    expect((body as { items: unknown[] }).items).toHaveLength(2);
    expect((body as { nextCursor?: string }).nextCursor).toBeTruthy();
    expect(meta.pages).toBe(2);
  });
  it('default scenario returns a bare array unchanged', () => {
    const { body } = shapeResponse([order], DEFAULT_SCENARIO);
    expect(body).toEqual([order]);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run mock-1c/core/serialize.test.ts`
Expected: FAIL — `serialize.ts` does not exist / exports undefined.

- [ ] **Step 4: Implement `serialize.ts`**

Create `mock-1c/core/serialize.ts`:

```ts
import type { ScenarioConfig, StatusDialect, DatetimeFormat, EnvelopeShape } from './scenario';

type Rec = Record<string, unknown>;

// Q10: map our enum codes to plausible native-1С Russian stage names. These are
// deliberately NOT members of our z.enum — emitting them must trigger quarantine.
const EXECUTION_RU: Record<string, string> = {
  pending: 'Новый', in_progress: 'В работе', completed: 'Выполнен',
  cancelled: 'Отменён', on_hold: 'Приостановлен'
};
const FINANCIAL_RU: Record<string, string> = {
  not_billed: 'Не выставлен', billed: 'Выставлен', partially_paid: 'Частично оплачен',
  paid: 'Оплачен', refunded: 'Возврат'
};

export function applyDialect(record: Rec, dialect: StatusDialect): Rec {
  if (dialect !== 'russian') return record;
  const out: Rec = { ...record };
  if (typeof out.executionStatus === 'string' && out.executionStatus in EXECUTION_RU) {
    out.executionStatus = EXECUTION_RU[out.executionStatus];
  }
  if (typeof out.financialStatus === 'string' && out.financialStatus in FINANCIAL_RU) {
    out.financialStatus = FINANCIAL_RU[out.financialStatus];
  }
  return out;
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;
const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

export function applyDatetime(record: Rec, fmt: DatetimeFormat): Rec {
  if (fmt !== 'no-offset') return record;
  const out: Rec = { ...record };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && ISO_PREFIX.test(v)) out[k] = v.replace(OFFSET_SUFFIX, '');
  }
  return out;
}

export function injectMalformed(records: Rec[], rate: number): Rec[] {
  if (!(rate > 0)) return records;
  return [...records, { externalId: 'mock-malformed', broken: true }];
}

export function injectDuplicates(records: Rec[]): Rec[] {
  if (records.length === 0) return records;
  return [...records, { ...records[0] }];
}

export type ResponseMeta = { total: number; pages: number; served: number };

export function paginate(records: Rec[], pageSize: number): { page: Rec[]; meta: ResponseMeta } {
  if (!(pageSize > 0) || records.length <= pageSize) {
    return { page: records, meta: { total: records.length, pages: records.length === 0 ? 0 : 1, served: records.length } };
  }
  const page = records.slice(0, pageSize);
  return { page, meta: { total: records.length, pages: Math.ceil(records.length / pageSize), served: page.length } };
}

export function wrapEnvelope(records: Rec[], envelope: EnvelopeShape): unknown {
  if (envelope === 'items') return { items: records };
  if (envelope === 'other') return { data: records };
  return records;
}

// Compose all shaping in order. Pagination overrides the envelope flag with an
// { items, nextCursor } body so the (non-paginating) adapter visibly drops pages.
export function shapeResponse(records: Rec[], scenario: ScenarioConfig): { body: unknown; meta: ResponseMeta } {
  let shaped = records
    .map((r) => applyDialect(r, scenario.statusDialect))
    .map((r) => applyDatetime(r, scenario.datetime));
  shaped = injectMalformed(shaped, scenario.malformedRate);
  if (scenario.duplicates) shaped = injectDuplicates(shaped);

  if (scenario.pageSize > 0 && shaped.length > scenario.pageSize) {
    const { page, meta } = paginate(shaped, scenario.pageSize);
    const last = page[page.length - 1] as Rec;
    return { body: { items: page, nextCursor: String(last.updatedAt ?? last.externalId ?? '') }, meta };
  }
  const { page, meta } = paginate(shaped, scenario.pageSize);
  return { body: wrapEnvelope(page, scenario.envelope), meta };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run mock-1c/core/serialize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add mock-1c/core/scenario.ts mock-1c/core/serialize.ts mock-1c/core/serialize.test.ts
git commit -m "feat(mock1c): scenario config + pure response shaping (Q1/Q6/Q7/Q10)"
```

---

## Task 2: In-memory dataset (`dataset.ts`)

**Files:**
- Create: `mock-1c/core/dataset.ts`
- Test: `mock-1c/core/dataset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mock-1c/core/dataset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDataset } from './dataset';

describe('createDataset', () => {
  it('seeds from fixtures and returns all records with an empty cursor', () => {
    const ds = createDataset();
    expect(ds.list('order', {}).map((r) => r.externalId).sort())
      .toEqual(['1c-order-1001', '1c-order-1002', '1c-order-1003']);
    expect(ds.list('organization', {})).toHaveLength(3);
  });

  it('filters by since (updatedAt > since)', () => {
    const ds = createDataset();
    const ids = ds.list('order', { since: '2026-05-10T00:00:00Z' }).map((r) => r.externalId).sort();
    expect(ids).toEqual(['1c-order-1001', '1c-order-1002']); // 1003 is 2026-05-05
    expect(ds.list('organization', { since: '2026-04-16T00:00:00Z' }).map((r) => r.externalId))
      .toEqual(['1c-org-003']);
  });

  it('touch() bumps updatedAt so the record reappears after a later cursor', () => {
    const ds = createDataset();
    const future = '2027-01-01T00:00:00Z';
    expect(ds.list('order', { since: future })).toHaveLength(0);
    ds.touch('order', '1c-order-1001', () => new Date('2027-06-06T00:00:00Z'));
    const ids = ds.list('order', { since: future }).map((r) => r.externalId);
    expect(ids).toEqual(['1c-order-1001']);
  });

  it('returns copies — mutating a result does not corrupt the store', () => {
    const ds = createDataset();
    (ds.list('order', {})[0] as Record<string, unknown>).title = 'MUTATED';
    expect(ds.list('order', {})[0].title).not.toBe('MUTATED');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run mock-1c/core/dataset.test.ts`
Expected: FAIL — `dataset.ts` does not exist.

- [ ] **Step 3: Implement `dataset.ts`**

Create `mock-1c/core/dataset.ts`:

```ts
import { FAKE_ORGS } from '@/lib/services/oneCSync/fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from '@/lib/services/oneCSync/fixtures/orders';
import type { SyncCursor } from '@/lib/services/oneCSync/dto';

export type Entity = 'organization' | 'order' | 'payment' | 'document';
type Rec = Record<string, unknown> & { externalId: string; updatedAt: string };

function seed(): Record<Entity, Rec[]> {
  // Deep copy so the store is mutable (touch) without corrupting the imported fixtures.
  const clone = <T>(rows: T[]): Rec[] => rows.map((r) => ({ ...(r as object) })) as Rec[];
  return {
    organization: clone(FAKE_ORGS),
    order: clone(FAKE_ORDERS),
    payment: clone(FAKE_PAYMENTS),
    document: clone(FAKE_DOCUMENTS)
  };
}

export type Dataset = {
  list(entity: Entity, cursor: SyncCursor): Rec[];
  touch(entity: Entity, externalId: string, now?: () => Date): void;
};

export function createDataset(initial: Record<Entity, Rec[]> = seed()): Dataset {
  const store = initial;
  return {
    list(entity, cursor) {
      const rows = store[entity];
      const filtered = cursor.since
        ? rows.filter((r) => Date.parse(r.updatedAt) > Date.parse(cursor.since as string))
        : rows;
      return filtered.map((r) => ({ ...r })); // hand out copies
    },
    touch(entity, externalId, now = () => new Date()) {
      const row = store[entity].find((r) => r.externalId === externalId);
      if (row) row.updatedAt = now().toISOString();
    }
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run mock-1c/core/dataset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mock-1c/core/dataset.ts mock-1c/core/dataset.test.ts
git commit -m "feat(mock1c): in-memory dataset seeded from fixtures (since-filter + touch)"
```

---

## Task 3: Lead store (`leads.ts`)

**Files:**
- Create: `mock-1c/core/leads.ts`
- Test: `mock-1c/core/leads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mock-1c/core/leads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createLeadStore } from './leads';

const body = { partnerSlug: 'acme', cabinetLeadId: 'L1', clientCompanyName: 'c', subject: 's', productType: ['training'] };
const now = () => new Date('2026-06-06T00:00:00Z');

describe('createLeadStore', () => {
  it('accepts a lead and returns acceptedAt + a request id', () => {
    const store = createLeadStore();
    const res = store.accept(body, 0, now);
    expect(res.status).toBe(200);
    expect(res.result?.acceptedAt).toBe('2026-06-06T00:00:00.000Z');
    expect(res.result?.oneCRequestId).toBeTruthy();
  });

  it('dedups by cabinetLeadId — second push returns the SAME request id', () => {
    const store = createLeadStore();
    const first = store.accept(body, 0, now);
    const second = store.accept({ ...body, clientCompanyName: 'changed' }, 0, now);
    expect(second.result?.oneCRequestId).toBe(first.result?.oneCRequestId);
    expect(store.state().uniqueLeads).toBe(1);
  });

  it('records which partner key field arrived (Q5 observation)', () => {
    const store = createLeadStore();
    store.accept(body, 0, now);
    expect(store.state().partnerKeyFieldsSeen).toEqual(['partnerSlug']);
  });

  it('returns 500 when pushFailRate is 1 and does not record the lead', () => {
    const store = createLeadStore();
    const res = store.accept(body, 1, now);
    expect(res.status).toBe(500);
    expect(store.state().uniqueLeads).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run mock-1c/core/leads.test.ts`
Expected: FAIL — `leads.ts` does not exist.

- [ ] **Step 3: Implement `leads.ts`**

Create `mock-1c/core/leads.ts`:

```ts
type LeadBody = Record<string, unknown> & { cabinetLeadId?: unknown };

export type LeadAcceptResult =
  | { status: 200; result: { acceptedAt: string; oneCRequestId: string } }
  | { status: 400 | 500; result?: undefined };

export type LeadStoreState = {
  uniqueLeads: number;
  partnerKeyFieldsSeen: string[];
  lastBody: LeadBody | null;
};

const PARTNER_KEY_CANDIDATES = ['partnerSlug', 'partnerExternalId'];

export function createLeadStore() {
  const byLeadId = new Map<string, { acceptedAt: string; oneCRequestId: string }>();
  const partnerKeyFieldsSeen = new Set<string>();
  let lastBody: LeadBody | null = null;
  let counter = 0;

  return {
    accept(body: LeadBody, pushFailRate: number, now: () => Date = () => new Date()): LeadAcceptResult {
      // Deterministic failure when rate >= 1; probabilistic otherwise (mock runtime only).
      if (pushFailRate >= 1 || (pushFailRate > 0 && Math.random() < pushFailRate)) {
        return { status: 500 };
      }
      const leadId = typeof body.cabinetLeadId === 'string' ? body.cabinetLeadId : '';
      if (!leadId) return { status: 400 };

      lastBody = body;
      for (const field of PARTNER_KEY_CANDIDATES) {
        if (field in body) partnerKeyFieldsSeen.add(field);
      }

      const existing = byLeadId.get(leadId);
      if (existing) return { status: 200, result: existing }; // idempotent dedup

      counter += 1;
      const result = { acceptedAt: now().toISOString(), oneCRequestId: `mock-req-${counter}` };
      byLeadId.set(leadId, result);
      return { status: 200, result };
    },
    state(): LeadStoreState {
      return { uniqueLeads: byLeadId.size, partnerKeyFieldsSeen: [...partnerKeyFieldsSeen], lastBody };
    }
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run mock-1c/core/leads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mock-1c/core/leads.ts mock-1c/core/leads.test.ts
git commit -m "feat(mock1c): lead store — dedup by cabinetLeadId + Q5 key observation"
```

---

## Task 4: Env config with fail-fast (`config.ts`)

**Files:**
- Create: `mock-1c/config.ts`
- Test: `mock-1c/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mock-1c/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadScenario, loadServerConfig } from './config';
import { DEFAULT_SCENARIO } from './core/scenario';

describe('loadScenario', () => {
  it('returns defaults for an empty env', () => {
    expect(loadScenario({})).toEqual(DEFAULT_SCENARIO);
  });

  it('parses known values', () => {
    const s = loadScenario({
      MOCK1C_ENVELOPE: 'items', MOCK1C_STATUS_DIALECT: 'russian',
      MOCK1C_DATETIME: 'no-offset', MOCK1C_PAGE_SIZE: '2',
      MOCK1C_MALFORMED_RATE: '0.5', MOCK1C_DUPLICATES: '1',
      MOCK1C_FAIL_MODE: 'transient', MOCK1C_LATENCY_MS: '300', MOCK1C_PUSH_FAIL_RATE: '0.1'
    });
    expect(s).toEqual({
      envelope: 'items', statusDialect: 'russian', datetime: 'no-offset',
      pageSize: 2, malformedRate: 0.5, duplicates: true,
      failMode: 'transient', latencyMs: 300, pushFailRate: 0.1
    });
  });

  it('fail-fast on an unknown enum value (never silently defaults)', () => {
    expect(() => loadScenario({ MOCK1C_ENVELOPE: 'xml' })).toThrow(/MOCK1C_ENVELOPE/);
    expect(() => loadScenario({ MOCK1C_FAIL_MODE: 'boom' })).toThrow(/MOCK1C_FAIL_MODE/);
  });

  it('fail-fast on a non-numeric numeric field', () => {
    expect(() => loadScenario({ MOCK1C_PAGE_SIZE: 'lots' })).toThrow(/MOCK1C_PAGE_SIZE/);
  });
});

describe('loadServerConfig', () => {
  it('defaults port 4010 / token mock-token', () => {
    expect(loadServerConfig({})).toEqual({ port: 4010, token: 'mock-token' });
  });
  it('reads overrides', () => {
    expect(loadServerConfig({ MOCK1C_PORT: '5000', MOCK1C_TOKEN: 'secret' }))
      .toEqual({ port: 5000, token: 'secret' });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run mock-1c/config.test.ts`
Expected: FAIL — `config.ts` does not exist.

- [ ] **Step 3: Implement `config.ts`**

Create `mock-1c/config.ts`:

```ts
import {
  DEFAULT_SCENARIO, ENVELOPE_VALUES, DIALECT_VALUES, DATETIME_VALUES, FAIL_MODE_VALUES,
  type ScenarioConfig
} from './core/scenario';

type Env = Record<string, string | undefined>;

function pickEnum<T extends string>(env: Env, key: string, allowed: T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (!allowed.includes(raw as T)) {
    throw new Error(`${key}: unknown value "${raw}" (allowed: ${allowed.join(', ')})`);
  }
  return raw as T;
}

function pickNumber(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key}: expected a non-negative number, got "${raw}"`);
  return n;
}

function pickBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'on', 'yes'].includes(raw.trim().toLowerCase());
}

export function loadScenario(env: Env): ScenarioConfig {
  return {
    envelope: pickEnum(env, 'MOCK1C_ENVELOPE', ENVELOPE_VALUES, DEFAULT_SCENARIO.envelope),
    statusDialect: pickEnum(env, 'MOCK1C_STATUS_DIALECT', DIALECT_VALUES, DEFAULT_SCENARIO.statusDialect),
    datetime: pickEnum(env, 'MOCK1C_DATETIME', DATETIME_VALUES, DEFAULT_SCENARIO.datetime),
    pageSize: pickNumber(env, 'MOCK1C_PAGE_SIZE', DEFAULT_SCENARIO.pageSize),
    malformedRate: pickNumber(env, 'MOCK1C_MALFORMED_RATE', DEFAULT_SCENARIO.malformedRate),
    duplicates: pickBool(env, 'MOCK1C_DUPLICATES', DEFAULT_SCENARIO.duplicates),
    failMode: pickEnum(env, 'MOCK1C_FAIL_MODE', FAIL_MODE_VALUES, DEFAULT_SCENARIO.failMode),
    latencyMs: pickNumber(env, 'MOCK1C_LATENCY_MS', DEFAULT_SCENARIO.latencyMs),
    pushFailRate: pickNumber(env, 'MOCK1C_PUSH_FAIL_RATE', DEFAULT_SCENARIO.pushFailRate)
  };
}

export type ServerConfig = { port: number; token: string };

export function loadServerConfig(env: Env): ServerConfig {
  return {
    port: pickNumber(env, 'MOCK1C_PORT', 4010),
    token: env.MOCK1C_TOKEN && env.MOCK1C_TOKEN !== '' ? env.MOCK1C_TOKEN : 'mock-token'
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run mock-1c/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mock-1c/config.ts mock-1c/config.test.ts
git commit -m "feat(mock1c): env -> ScenarioConfig parser with fail-fast"
```

---

## Task 5: HTTP server + entry point (`server.ts`, `main.ts`)

**Files:**
- Create: `mock-1c/server.ts`
- Create: `mock-1c/main.ts`
- Modify: `package.json` (add `mock:1c` script)

- [ ] **Step 1: Implement `server.ts`**

The server is verified end-to-end by the contract test in Task 7 (a server-backed test is more faithful than asserting on a hand-rolled request object). Create `mock-1c/server.ts`:

```ts
import http from 'node:http';
import { ENDPOINTS, SINCE_PARAM } from '@/lib/services/oneCSync/rest-wire';
import type { SyncCursor } from '@/lib/services/oneCSync/dto';
import type { ScenarioConfig } from './core/scenario';
import type { Dataset, Entity } from './core/dataset';
import { shapeResponse } from './core/serialize';
import { createLeadStore } from './core/leads';

export type ScenarioRef = { current: ScenarioConfig };

export type Mock1cDeps = {
  scenarioRef: ScenarioRef;
  token: string;
  dataset: Dataset;
  leadStore: ReturnType<typeof createLeadStore>;
  log?: (msg: string) => void;
};

const PATH_TO_ENTITY: Record<string, Entity> = {
  [ENDPOINTS.organizations]: 'organization',
  [ENDPOINTS.orders]: 'order',
  [ENDPOINTS.payments]: 'payment',
  [ENDPOINTS.documents]: 'document'
};

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createMock1cServer(deps: Mock1cDeps): http.Server {
  const log = deps.log ?? (() => {});

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // --- introspection / control (no auth, dev-only) ---
    if (path === '/__health') return send(res, 200, { ok: true });
    if (path === '/__state' && method === 'GET') {
      return send(res, 200, { scenario: deps.scenarioRef.current, leads: deps.leadStore.state() });
    }
    if (path === '/__control' && method === 'POST') {
      const raw = await readBody(req);
      try {
        const patch = JSON.parse(raw) as Partial<ScenarioConfig>;
        deps.scenarioRef.current = { ...deps.scenarioRef.current, ...patch };
        return send(res, 200, { scenario: deps.scenarioRef.current });
      } catch {
        return send(res, 400, { error: 'invalid JSON patch' });
      }
    }

    const scenario = deps.scenarioRef.current;

    // --- artificial latency (drives ONE_C_HTTP_TIMEOUT_MS) ---
    if (scenario.latencyMs > 0) await delay(scenario.latencyMs);

    // --- auth (Q2 Bearer) ---
    if (req.headers.authorization !== `Bearer ${deps.token}`) {
      return send(res, 401, { error: 'unauthorized' });
    }

    // --- failure injection on reads ---
    if (method === 'GET' && scenario.failMode !== 'none') {
      if (scenario.failMode === 'transient') return send(res, 503, { error: 'temporarily unavailable' }, { 'Retry-After': '1' });
      return send(res, 500, { error: 'permanent failure' });
    }

    // --- pull endpoints ---
    const entity = PATH_TO_ENTITY[path];
    if (entity && method === 'GET') {
      const since = url.searchParams.get(SINCE_PARAM) ?? undefined;
      const cursor: SyncCursor = since ? { since } : {};
      const records = deps.dataset.list(entity, cursor) as Array<Record<string, unknown>>;
      const { body, meta } = shapeResponse(records, scenario);
      if (meta.pages > 1) log(`[mock1c] ${entity}: served page 1 of ${meta.pages} (${meta.served}/${meta.total}); client never requested the rest`);
      return send(res, 200, body);
    }

    // --- push lead ---
    if (path === ENDPOINTS.leadPush && method === 'POST') {
      const raw = await readBody(req);
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      const outcome = deps.leadStore.accept(parsed, scenario.pushFailRate);
      if (outcome.status !== 200) return send(res, outcome.status, { error: 'push failed' });
      return send(res, 200, outcome.result);
    }

    return send(res, 404, { error: `no mock route for ${method} ${path}` });
  });
}
```

- [ ] **Step 2: Implement `main.ts`**

Create `mock-1c/main.ts`:

```ts
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { loadScenario, loadServerConfig } from './config';

const { port, token } = loadServerConfig(process.env);
const scenarioRef: ScenarioRef = { current: loadScenario(process.env) };

const server = createMock1cServer({
  scenarioRef,
  token,
  dataset: createDataset(),
  leadStore: createLeadStore(),
  log: (msg) => console.log(msg)
});

server.listen(port, () => {
  console.log(`[mock1c] listening on http://localhost:${port}`);
  console.log(`[mock1c] scenario:`, scenarioRef.current);
  console.log(`[mock1c] point the worker at it: ONE_C_ADAPTER=rest ONE_C_API_URL=http://localhost:${port} ONE_C_API_TOKEN=${token} ONE_C_MODE=shadow`);
});
```

- [ ] **Step 3: Add the npm script**

Modify `package.json` — add to `"scripts"` (after the `worker:dev` line):

```json
    "mock:1c": "tsx mock-1c/main.ts",
```

- [ ] **Step 4: Smoke-test the running server manually**

Run (terminal A): `npm run mock:1c`
Run (terminal B):
```bash
curl -s http://localhost:4010/__health
curl -s -H "Authorization: Bearer mock-token" "http://localhost:4010/api/orders?since=2026-05-10T00:00:00Z"
curl -s http://localhost:4010/api/orders   # no auth
```
Expected: `{"ok":true}`; then an array with `1c-order-1001` and `1c-order-1002`; then `{"error":"unauthorized"}` (401). Stop the server (Ctrl+C).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean (mock-1c is covered by tsconfig `**/*.ts`).

```bash
git add mock-1c/server.ts mock-1c/main.ts package.json
git commit -m "feat(mock1c): http server (5 endpoints + control/state/health) + entry"
```

---

## Task 6: Wiring — ESLint guardrail + .env.example

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `.env.example`

(Test discovery was already extended in Task 0.)

- [ ] **Step 1: Add the dependency-direction guardrail to ESLint**

In `eslint.config.mjs`, add a shared restricted-import pattern and wire it into BOTH the general `src/**` block and the services block (flat-config "last match wins" per rule key — without re-adding it to the services block, the services-only `no-restricted-imports` would clobber the mock-1c restriction for service files).

Add near the other consts (after `NO_UPWARD_IMPORTS_IN_SERVICES`):
```js
// mock-1c/ is the dev/test-only 1С counterparty. Dependency direction is one-way:
// mock-1c may import src, but src must NEVER import mock-1c (it would pull throwaway
// test infra into the app runtime). Mirrors the C3 services↛app guardrail.
const NO_MOCK1C_FROM_SRC = {
  group: ['**/mock-1c', '**/mock-1c/**'],
  message: 'src/ must not import mock-1c (it is dev/test-only, outside the app runtime). Direction is one-way: mock-1c → src.'
};
```

Change the general `src/**` block to add `no-restricted-imports`:
```js
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': NO_HANDROLLED_MODAL,
      'no-restricted-imports': ['error', { patterns: [NO_MOCK1C_FROM_SRC] }]
    }
  },
```

Change the services block to re-include the mock-1c pattern alongside the upward-import patterns:
```js
  {
    files: ['src/lib/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...NO_UPWARD_IMPORTS_IN_SERVICES[1].patterns, NO_MOCK1C_FROM_SRC]
      }]
    }
  },
```

- [ ] **Step 2: Verify the guardrail is non-vacuous**

Temporarily add this line to the top of `src/lib/services/oneCSync/index.ts`:
```ts
import '../../../../mock-1c/core/scenario';
```
Run: `npx eslint src/lib/services/oneCSync/index.ts`
Expected: an `no-restricted-imports` error citing the mock-1c message.
Then **revert** the temporary import (delete the line). Re-run `npx eslint src/lib/services/oneCSync/index.ts` → clean.

- [ ] **Step 3: Add the `.env.example` block**

Append to `.env.example`:
```bash

# --- Mock 1С REST server (dev/test only — `npm run mock:1c`) ---
# Point the worker at the mock for a local shadow rehearsal:
#   ONE_C_ADAPTER=rest
#   ONE_C_API_URL=http://localhost:4010
#   ONE_C_API_TOKEN=mock-token
#   ONE_C_MODE=shadow
MOCK1C_PORT=4010
MOCK1C_TOKEN=mock-token
# Scenario knobs (default = happy path):
MOCK1C_ENVELOPE=array            # array | items | other (Q1)
MOCK1C_STATUS_DIALECT=app        # app | russian       (Q10 → quarantine)
MOCK1C_DATETIME=utc-z            # utc-z | no-offset   (Q7 → silent skew)
MOCK1C_PAGE_SIZE=0               # >0 serves only page 1 (Q6 → first-page-only)
MOCK1C_MALFORMED_RATE=0          # >0 appends a schema-breaking record
MOCK1C_DUPLICATES=0              # 1 repeats the first record
MOCK1C_FAIL_MODE=none            # none | transient (503+Retry-After) | permanent (500)
MOCK1C_LATENCY_MS=0              # >ONE_C_HTTP_TIMEOUT_MS triggers a client timeout
MOCK1C_PUSH_FAIL_RATE=0          # 0..1 chance POST /api/leads returns 500
```

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs .env.example
git commit -m "chore(mock1c): src↛mock-1c eslint guardrail + .env example block"
```

---

## Task 7: Server-backed contract test

**Files:**
- Create: `mock-1c/adapter-rest.contract.test.ts`

This boots the real `server.ts` on an ephemeral port and drives the real `RestOneCAdapter` over a real socket — complementing (not replacing) the in-process fetch-stub test at `src/__tests__/oneCSync.adapter-rest.test.ts`. (Retry/timeout timing stays unit-tested in `oneCSync.resilience.test.ts`; here we keep cases fast + deterministic.)

- [ ] **Step 1: Write the test**

Create `mock-1c/adapter-rest.contract.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { DEFAULT_SCENARIO } from './core/scenario';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';

let server: Server;
let baseUrl: string;
const scenarioRef: ScenarioRef = { current: { ...DEFAULT_SCENARIO } };
const leadStore = createLeadStore();

beforeAll(async () => {
  server = createMock1cServer({ scenarioRef, token: 'tok', dataset: createDataset(), leadStore });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { scenarioRef.current = { ...DEFAULT_SCENARIO }; });

const adapter = () => new RestOneCAdapter({ baseUrl, token: 'tok' });

describe('RestOneCAdapter against the live mock server', () => {
  it('pulls orders over HTTP with Bearer + since (bare array default)', async () => {
    const rows = await adapter().pullOrders({ since: '2026-05-10T00:00:00Z' });
    expect(rows.map((r) => r.externalId).sort()).toEqual(['1c-order-1001', '1c-order-1002']);
  });

  it('unwraps an { items: [] } envelope when the mock emits one', async () => {
    scenarioRef.current.envelope = 'items';
    const rows = await adapter().pullOrganizations({});
    expect(rows).toHaveLength(3);
  });

  it('rejects on a wrong token (401, not retried into success)', async () => {
    const wrong = new RestOneCAdapter({ baseUrl, token: 'nope' });
    await expect(wrong.pullOrders({})).rejects.toThrow(/401/);
  });

  it('pushes a lead and dedups a retry by cabinetLeadId', async () => {
    const a = adapter();
    const lead = { cabinetLeadId: 'L-contract', clientCompanyName: 'c', clientContactName: 'n', subject: 's', productType: ['training'], partnerSlug: 'acme' };
    const first = await a.pushLead(lead);
    const second = await a.pushLead(lead);
    expect(first.acceptedAt).toBeTruthy();
    expect(second.oneCRequestId).toBe(first.oneCRequestId);
    expect(leadStore.state().partnerKeyFieldsSeen).toContain('partnerSlug'); // Q5
  });
});
```

- [ ] **Step 2: Run the test, verify it passes**

Run: `npx vitest run mock-1c/adapter-rest.contract.test.ts`
Expected: PASS (4 cases). If it fails on the `since` case, confirm Task 2 filter semantics; if on auth, confirm Task 5 Bearer check.

- [ ] **Step 3: Commit**

```bash
git add mock-1c/adapter-rest.contract.test.ts
git commit -m "test(mock1c): server-backed contract test for RestOneCAdapter (real socket)"
```

---

## Task 8: README + shadow-rehearsal runbook

**Files:**
- Create: `mock-1c/README.md`

- [ ] **Step 1: Write `mock-1c/README.md`**

Create `mock-1c/README.md`:

```markdown
# Mock 1С REST server

Dev/test-only stand-in for the real 1С REST API. Speaks the exact dialect that
[`src/lib/services/oneCSync/rest-wire.ts`](../src/lib/services/oneCSync/rest-wire.ts)
expects, and can deliberately trigger the 3 meeting landmines + transport anomalies
so `RestOneCAdapter` and the full shadow pipeline can be exercised before the 1С meeting.

**Not** part of the app: outside `src/`, outside the Next build, never imported by `src/`
(ESLint-enforced). Seeded from the same `src/lib/services/oneCSync/fixtures/*` as the fake adapter.

## Run

    npm run mock:1c            # http://localhost:4010

## Scenarios (env or POST /__control)

| Flag | Values | Demonstrates |
|---|---|---|
| MOCK1C_STATUS_DIALECT | app \| russian | Q10: russian → 100% zod quarantine |
| MOCK1C_DATETIME | utc-z \| no-offset | Q7: no-offset → silent server-local skew |
| MOCK1C_PAGE_SIZE | 0 \| N | Q6: N>0 → adapter silently reads page 1 only |
| MOCK1C_ENVELOPE | array \| items \| other | Q1: `other` → envelope-failure |
| MOCK1C_MALFORMED_RATE | 0..1 | per-record quarantine over HTTP |
| MOCK1C_FAIL_MODE | none \| transient \| permanent | 503+Retry-After (retried) / 500 (job retry) |
| MOCK1C_LATENCY_MS | ms | > ONE_C_HTTP_TIMEOUT_MS → client timeout |
| MOCK1C_PUSH_FAIL_RATE | 0..1 | POST /api/leads → 500 (BullMQ retry + C6 claim) |

Introspection: `GET /__health`, `GET /__state` (active scenario, lead dedup count, partner key seen).
Runtime flip without restart: `POST /__control` with a JSON patch, e.g. `{"statusDialect":"russian"}`.

## Shadow rehearsal (local)

    1. npm run prisma:seed        # Partner/Org slugs must match fixtures (1c-partner-001 etc.)
    2. npm run mock:1c
    3. ONE_C_ADAPTER=rest ONE_C_API_URL=http://localhost:4010 \
       ONE_C_API_TOKEN=mock-token ONE_C_MODE=shadow  npm run worker:dev
    4. trigger syncs; watch /admin/sync (watermark, cursor-lag, invalid/failed)
       shadow → 0 DB writes, SyncLog operation:'check'
    5. flip a scenario (POST /__control) → re-run → confirm the expected SyncLog outcome:
       russian → all invalid; PAGE_SIZE → undercount; no-offset → time skew
    6. cutover: ONE_C_MODE=shadow (clean) → live → rows are written
```

- [ ] **Step 2: Commit**

```bash
git add mock-1c/README.md
git commit -m "docs(mock1c): README + scenario table + shadow-rehearsal runbook"
```

---

## Task 9 (🟡 optional): Integration shadow-sync test

Automates runbook step 4–5 in the gate (L2.5) tier. Skip if the manual runbook is deemed sufficient; include for CI-grade proof that a shadow sync against the mock writes zero rows and logs a `check` entry.

**Lives in `mock-1c/`** (not `src/__tests__/`) so it does not trip the `src↛mock-1c` guardrail; it still auto-classifies as **integration** via the `new PrismaClient(` marker.

**Files:**
- Create: `mock-1c/mock-shadow.integration.test.ts`

- [ ] **Step 1: Write the integration test**

It boots the mock, runs the real order processor against it in shadow mode, and asserts no `Order` rows were written but a `SyncLog` `check` entry exists. Create `mock-1c/mock-shadow.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { DEFAULT_SCENARIO } from './core/scenario';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';

const prisma = new PrismaClient();
let server: Server;
const scenarioRef: ScenarioRef = { current: { ...DEFAULT_SCENARIO } };

beforeAll(async () => {
  server = createMock1cServer({ scenarioRef, token: 'tok', dataset: createDataset(), leadStore: createLeadStore() });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  process.env.ONE_C_ADAPTER = 'rest';
  process.env.ONE_C_API_URL = `http://127.0.0.1:${port}`;
  process.env.ONE_C_API_TOKEN = 'tok';
  process.env.ONE_C_MODE = 'shadow';
  resetOneCAdapter();
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  delete process.env.ONE_C_ADAPTER; delete process.env.ONE_C_API_URL;
  delete process.env.ONE_C_API_TOKEN; delete process.env.ONE_C_MODE;
  resetOneCAdapter();
});

beforeEach(async () => {
  await prisma.syncLog.deleteMany({ where: { entity: 'order' } });
});

describe('shadow sync against the mock writes nothing but logs a check', () => {
  it('runs the order processor in shadow mode', async () => {
    const fakeJob = { id: 'mock-shadow' } as unknown as Parameters<typeof syncOrdersProcessor>[0];
    const before = await prisma.order.count();
    await syncOrdersProcessor(fakeJob, prisma);
    expect(await prisma.order.count()).toBe(before); // shadow = no writes

    const checks = await prisma.syncLog.findMany({ where: { entity: 'order', operation: 'check' } });
    expect(checks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run against the gate Postgres**

Run: `npm run gate`
Expected: the integration suite (including this file) passes against the ephemeral Docker Postgres. If Docker port `:5432` is held locally (known issue on this machine), run `npm run test:integration` against a live Postgres instead. (In shadow mode `syncOrdersProcessor` skips all `db.*.create/update`, so this holds even if the seed has no matching orgs — unmatched records are counted/skipped, never written.)

- [ ] **Step 3: Commit**

```bash
git add mock-1c/mock-shadow.integration.test.ts
git commit -m "test(mock1c): integration — shadow sync against mock writes nothing, logs check"
```

---

## Final verification (before opening a PR)

- [ ] `npm run typecheck` — clean.
- [ ] `npm run lint` — clean (guardrail active, no violations).
- [ ] `npm run test:unit` — all green (includes the new `mock-1c/**` unit + contract tests).
- [ ] Manual: `npm run mock:1c`, then run the shadow rehearsal (README) for one cycle; flip `MOCK1C_STATUS_DIALECT=russian` and confirm `/admin/sync` shows all orders as `invalid`.
- [ ] (🟡) `npm run gate` if Task 9 was implemented.

---

## Self-Review notes (author)

- **Spec coverage:** §3 files → Tasks 1–8; §5 scenario catalog → Task 1 (shaping) + Task 5 (HTTP anomalies) + `.env`/README; §6 runbook → Task 8; §8 tests (unit / server-backed contract / 🟡 integration) → Tasks 1–4, 7, 9; §7 error-handling = exercising existing paths (no new src code) — covered by scenarios, plus mock-internal fail-fast in Task 4.
- **Refinements vs spec (intentional, behavior-preserving):** (1) malformed + duplicates live in `serialize.ts` not `dataset.ts` — cleaner pure-shaping boundary; (2) both the contract test AND the optional integration test live in `mock-1c/` (not `src/__tests__/`) — keeps the src↛mock-1c guardrail trivially true; the integration one still auto-classifies via its `new PrismaClient(`; (3) no `tsconfig` change — `**/*.ts` already covers `mock-1c/`; (4) test-discovery extension is its own Task 0 (must precede any `vitest run mock-1c/...`).
- **Type consistency:** `ScenarioConfig`/`ScenarioRef`/`Dataset`/`Entity`/`createLeadStore` names match across Tasks 1–7. `loadScenario`/`loadServerConfig` (Task 4) consumed by `main.ts` (Task 5). `createMock1cServer(deps)` shape identical in Tasks 5 and 7.
- **Task 9 processor call** uses the verified real signature `syncOrdersProcessor(job, db = prisma)` from `src/worker/processors/sync-orders.ts` (confirmed: shadow mode skips all `db.*.create/update` and writes a `check` SyncLog) — no guesswork left.
