# C6 — решения + security-хвост — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть три развилки C6 — зафиксировать продуктовое решение `completed→pending`, сделать 1С push лида идемпотентным под конкуренцией, перевести student-bridge rate-limit на Redis с graceful-degradation.

**Architecture:** Три независимых правки за общей дисциплиной §3/§4/§12. #1 — только тест+комментарий (поведение неизменно). #2 — атомарный claim в сервисном слое. #3 — выделенный модуль `lib/rateLimit` + тонкий роут.

**Tech Stack:** Prisma 5 (`updateMany` атомарный claim), ioredis (`INCR`/`PEXPIRE` + таймаут), Vitest (unit + integration).

**Spec:** [c6-decisions-security-tail-design](../specs/2026-06-06-c6-decisions-security-tail-design.md)

---

### Task 1: Замок решения #1 — `completed → pending` разрешён

**Files:**
- Test: `src/__tests__/server-actions.manager.status.test.ts` (добавить в блок `completedAt management`)
- Modify: `src/lib/services/manager/status.ts` (комментарий-маркер)

- [ ] **Step 1: Добавить failing-тест на разрешённый откат**

```ts
it('ALLOWS reopening: completed → pending clears completedAt (product decision 2026-06-06)', async () => {
  orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'completed' }));
  const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'pending' });
  expect(res).toEqual({ ok: true, changed: true });
  const data = orderUpdate.mock.calls[0]![0]!.data;
  expect(data.executionStatus).toBe('pending');
  expect(data.completedAt).toBeNull();
});
```

- [ ] **Step 2: Прогнать — тест проходит сразу** (поведение уже есть; тест — регресс-замок). Если упал — значит где-то гард, разбираться.

Run: `npx vitest run src/__tests__/server-actions.manager.status.test.ts`
Expected: PASS (зелёный замок).

- [ ] **Step 3: Добавить комментарий-маркер в `status.ts`** над `MANAGER_SETTABLE_STATUSES`:

```ts
// PRODUCT DECISION (2026-06-06): any transition between these statuses is
// intentionally allowed, INCLUDING reopening a completed order
// (completed → pending / in_progress). This is a flat allow-list by design,
// NOT a transition matrix — do not add a guard blocking reopen without a
// product sign-off (regression-locked in server-actions.manager.status.test.ts).
const MANAGER_SETTABLE_STATUSES = ['pending', 'in_progress', 'completed'] as const;
```

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/server-actions.manager.status.test.ts src/lib/services/manager/status.ts
git commit -m "test(c6): lock 'manager may reopen completed order' product decision + intent comment"
```

---

### Task 2: Решение #2 — атомарный claim для 1С push (unit)

**Files:**
- Modify: `src/lib/services/oneCSync/push.ts`
- Test: `src/__tests__/services.oneCSync.push.test.ts`

- [ ] **Step 1: Расширить prisma-мок `lead.updateMany`** в `makePrismaMock` и вернуть spy:

```ts
const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
const prisma = {
  lead: { findUnique: vi.fn().mockResolvedValue(opts.lead ?? null), update: updateSpy, updateMany: updateManySpy },
  syncLog: { create: logSpy }
} as unknown as PrismaClient;
return { prisma, updateSpy, updateManySpy, logSpy };
```

- [ ] **Step 2: Добавить failing-тесты на claim-lost и rollback**

```ts
it('claim lost (concurrent): updateMany count 0 ⇒ skip adapter, idempotent', async () => {
  const { prisma, updateManySpy, logSpy } = makePrismaMock({ lead: { /* …pushedToOneCAt: null… */ } as any });
  updateManySpy.mockResolvedValueOnce({ count: 0 });
  const pushLead = vi.fn();
  const adapter = { pullOrganizations: vi.fn(), pullOrders: vi.fn(), pullPayments: vi.fn(), pullDocuments: vi.fn(), pushLead } as unknown as OneCAdapter;
  const res = await pushLeadToOneC(prisma, 'lead-x', { adapter });
  expect(res.ok).toBe(true);
  expect(pushLead).not.toHaveBeenCalled();
  expect(logSpy.mock.calls[0][0].data.operation).toBe('skip');
});

it('claim won then adapter fails ⇒ rolls back pushedToOneCAt to null', async () => {
  const { prisma, updateManySpy } = makePrismaMock({ lead: { /* …pushedToOneCAt: null… */ } as any });
  updateManySpy.mockResolvedValueOnce({ count: 1 }); // claim
  const adapter = makeFakeAdapter({ shouldThrow: true });
  const res = await pushLeadToOneC(prisma, 'lead-y', { adapter });
  expect(res.ok).toBe(false);
  // rollback call: second updateMany with pushedToOneCAt: null
  const rollback = updateManySpy.mock.calls.find(c => c[0]?.data?.pushedToOneCAt === null);
  expect(rollback).toBeTruthy();
});
```

Run: `npx vitest run src/__tests__/services.oneCSync.push.test.ts`
Expected: FAIL (claim ещё не реализован).

- [ ] **Step 3: Реализовать атомарный claim в `push.ts`** — после раннего fast-path/маппинга, заменить «adapter→update» на «claim→adapter→(update | rollback)»:

```ts
// Atomic first-writer-wins claim: only one concurrent caller flips
// pushedToOneCAt from NULL, the rest see count:0 and skip (idempotent).
const claim = await prisma.lead.updateMany({
  where: { id: lead.id, pushedToOneCAt: null },
  data: { pushedToOneCAt: new Date() }
});
if (claim.count === 0) {
  await writeSyncLog({ entity: 'lead', direction: 'outbound', operation: 'skip', status: 'success',
    externalId: lead.externalIdInOneC ?? undefined,
    payload: { cabinetLeadId: lead.id, reason: 'claim_lost_or_already_pushed' } }, prisma);
  return { ok: true, result: { acceptedAt: new Date().toISOString() }, externalIdInOneC: lead.externalIdInOneC };
}

const payload = mapLeadToPayload(lead);
const startedAt = Date.now();
try {
  const result = await adapter.pushLead(payload);
  const externalIdInOneC = result.oneCRequestId ?? null;
  if (externalIdInOneC) {
    await prisma.lead.update({ where: { id: lead.id }, data: { externalIdInOneC } });
  }
  await writeSyncLog({ /* success, как раньше */ }, prisma);
  return { ok: true, result, externalIdInOneC };
} catch (err) {
  // Release the claim so BullMQ retry can re-attempt (preserve retry semantics).
  await prisma.lead.updateMany({ where: { id: lead.id }, data: { pushedToOneCAt: null } });
  const message = err instanceof Error ? err.message : String(err);
  await writeSyncLog({ /* error, как раньше */ }, prisma);
  return { ok: false, error: message };
}
```

- [ ] **Step 4: Поправить существующий happy-path assert** — финальный `update` теперь ставит только `externalIdInOneC` (без `pushedToOneCAt`); claim ставит `pushedToOneCAt`. Обновить ожидание в тесте «happy path».

- [ ] **Step 5: Прогнать unit**

Run: `npx vitest run src/__tests__/services.oneCSync.push.test.ts`
Expected: PASS (все, включая старые skip/failure).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/oneCSync/push.ts src/__tests__/services.oneCSync.push.test.ts
git commit -m "fix(c6): atomic first-writer-wins claim for 1C lead push (no duplicate push under concurrency)"
```

---

### Task 3: Решение #2 — интеграционный тест конкуренции

**Files:**
- Create: `src/__tests__/services.oneCSync.push.idempotent.integration.test.ts`

- [ ] **Step 1: Написать integration-тест** (мирроринг сидинга `worker.push-lead.test.ts`): seed partner/user/lead с `pushedToOneCAt: null`, считающий адаптер, два параллельных вызова.

```ts
const adapter = { pullOrganizations: vi.fn(), pullOrders: vi.fn(), pullPayments: vi.fn(), pullDocuments: vi.fn(),
  pushLead: vi.fn(async () => { calls++; return { acceptedAt: new Date().toISOString(), oneCRequestId: `req-${calls}` }; }) } as unknown as OneCAdapter;
const [a, b] = await Promise.all([
  pushLeadToOneC(prisma, leadId, { adapter }),
  pushLeadToOneC(prisma, leadId, { adapter })
]);
expect(calls).toBe(1);                       // adapter hit once
expect([a.ok, b.ok]).toEqual([true, true]);  // both succeed (one push, one idempotent skip)
const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { pushedToOneCAt: true } });
expect(lead?.pushedToOneCAt).not.toBeNull();
```

- [ ] **Step 2: Прогнать integration** (живой Postgres :5432)

Run: `npx vitest run src/__tests__/services.oneCSync.push.idempotent.integration.test.ts --mode=integration`
Expected: PASS, `calls === 1`.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.oneCSync.push.idempotent.integration.test.ts
git commit -m "test(c6): integration — concurrent 1C push is idempotent (single adapter call)"
```

---

### Task 4: Решение #3 — модуль `lib/rateLimit` (Redis + fallback)

**Files:**
- Create: `src/lib/rateLimit/index.ts`
- Test: `src/__tests__/lib.rateLimit.test.ts`

- [ ] **Step 1: Failing-тесты** (in-memory, redis, fallback) — см. spec тест-таблицу. Ключевые кейсы: memory `max` ok / `max+1` limited; redis `pexpire` на первом и `n>max` лимитится; падающий `incr` ⇒ деградация (возвращает false на первом).

- [ ] **Step 2: Реализовать модуль** по сигнатуре из spec (in-memory fixed-window + cleanup; redis `incr`/`pexpire` под `Promise.race` таймаут; fallback+warn). `defaultClient()` = `getRedisConnection()` при `REDIS_URL`, иначе `null`.

- [ ] **Step 3: Прогнать unit** → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rateLimit/index.ts src/__tests__/lib.rateLimit.test.ts
git commit -m "feat(c6): Redis-backed rate limiter with in-memory graceful degradation"
```

---

### Task 5: Решение #3 — подключить лимитер в роут

**Files:**
- Modify: `src/app/api/student/bridge/token/route.ts`
- Test: `src/__tests__/student-bridge-token-route.test.ts` (проверить, что мок не сломан)

- [ ] **Step 1: Заменить in-route `Map`/`isRateLimited`** на `import { isRateLimited } from '@/lib/rateLimit'` и `if (await isRateLimited(rateLimitKey, { windowMs: WINDOW_MS, max: LIMIT_PER_WINDOW })) { …429… }`. Удалить локальные `rateLimitStore`/`cleanupRateLimitStore`/`isRateLimited`/`MAX_RATE_LIMIT_ENTRIES`.

- [ ] **Step 2: Прогнать route-тест** (без `REDIS_URL` лимитер идёт in-memory, `max=50` в тесте — не лимитит).

Run: `npx vitest run src/__tests__/student-bridge-token-route.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/student/bridge/token/route.ts
git commit -m "refactor(c6): wire student-bridge to shared Redis-backed rate limiter"
```

---

### Task 6: Верификация + close-out

- [ ] `npm run typecheck` — чисто
- [ ] `npm run lint` — чисто
- [ ] `npm run test:unit` — зелёный
- [ ] затронутый integration (push idempotent) — зелёный
- [ ] `npm run build` — собирается
- [ ] close-out `2026-06-06-c6-decisions-security-tail-DONE.md` + обновить роадмап (C6 ✅)
- [ ] финальное холистическое ревью (subagent)

## Self-Review

- **Spec coverage:** #1→Task1, #2→Task2+3, #3→Task4+5, верификация→Task6. ✓
- **Placeholders:** код-блоки реальные; integration сид мирроринг `worker.push-lead.test.ts`. ✓
- **Type consistency:** `isRateLimited(key, {windowMs,max}, deps?)` — единая сигнатура в spec/plan/route. `updateMany` claim/rollback — `{ where:{ id[,pushedToOneCAt:null] }, data:{ pushedToOneCAt } }`. ✓
