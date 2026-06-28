# Health / Readiness Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portable machine-readable probes — public `/api/health/live` (liveness) and token-gated `/api/health` (readiness: DB + Redis with per-check timeouts) — so the app can sit behind an orchestrator/uptime monitor.

**Architecture:** Check logic lives in `src/lib/health/checks.ts` (timeout-raced `checkDb`/`checkRedis`), keeping the App Router route handlers thin (CLAUDE.md §3). No middleware change — its matcher already excludes `/api`. Readiness auth is a static bearer token validated in-handler (machine token, not session).

**Tech Stack:** Next.js 15 App Router route handlers (`Response.json`), Prisma (`$queryRaw`), ioredis (`ping`), `node:crypto` (`timingSafeEqual`), Vitest (all unit-tier — deps mocked, no Docker).

**Spec:** [docs/superpowers/specs/2026-05-31-health-readiness-probe-design.md](../specs/2026-05-31-health-readiness-probe-design.md)
**Branch:** `claude/health-readiness-probe` (off `main`; spec committed `2cd950d`).

---

### Task 1: Check helpers (`src/lib/health/checks.ts`)

**Files:**
- Create: `src/lib/health/checks.ts`
- Test: `src/__tests__/health.checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';

const { pingMock } = vi.hoisted(() => ({ pingMock: vi.fn() }));
vi.mock('@/lib/jobs/connection', () => ({
  getRedisConnection: () => ({ ping: pingMock })
}));

import { withTimeout, checkDb, checkRedis } from '@/lib/health/checks';

describe('withTimeout', () => {
  it('resolves ok when fn resolves in time', async () => {
    const r = await withTimeout(() => Promise.resolve('PONG'), 1000);
    expect(r.ok).toBe(true);
    expect(typeof r.ms).toBe('number');
  });

  it('returns ok:false error="timeout" when fn is too slow', async () => {
    const r = await withTimeout(() => new Promise((res) => setTimeout(res, 100)), 10);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('timeout');
  });

  it('returns ok:false with the error message when fn rejects', async () => {
    const r = await withTimeout(() => Promise.reject(new Error('boom')), 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });
});

describe('checkDb', () => {
  it('ok when $queryRaw resolves', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } as never;
    const r = await checkDb(prisma, 1000);
    expect(r.ok).toBe(true);
  });

  it('not ok when $queryRaw throws', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('db down')) } as never;
    const r = await checkDb(prisma, 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('db down');
  });
});

describe('checkRedis', () => {
  it('ok when ping resolves', async () => {
    pingMock.mockResolvedValue('PONG');
    const r = await checkRedis(1000);
    expect(r.ok).toBe(true);
  });

  it('not ok when ping rejects', async () => {
    pingMock.mockRejectedValue(new Error('redis down'));
    const r = await checkRedis(1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('redis down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- health.checks`
Expected: FAIL — `Failed to resolve import "@/lib/health/checks"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/checks.ts
import type { PrismaClient } from '@prisma/client';
import { getRedisConnection } from '@/lib/jobs/connection';

export type CheckResult = { ok: boolean; ms: number; error?: string };

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Runs `fn` against a timeout and never rejects — returns a CheckResult.
 * The timeout is essential: ioredis is configured with
 * `maxRetriesPerRequest: null`, so a command to a down Redis hangs forever
 * otherwise (the probe would freeze exactly when the dependency is down).
 */
export async function withTimeout(
  fn: () => Promise<unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CheckResult> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      })
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function checkDb(prisma: PrismaClient, timeoutMs?: number): Promise<CheckResult> {
  return withTimeout(() => prisma.$queryRaw`SELECT 1`, timeoutMs);
}

export function checkRedis(timeoutMs?: number): Promise<CheckResult> {
  return withTimeout(() => getRedisConnection().ping(), timeoutMs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- health.checks`
Expected: PASS (9 assertions across 3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/checks.ts src/__tests__/health.checks.test.ts
git commit -m "feat(health): timeout-raced db/redis check helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Liveness route (`/api/health/live`)

**Files:**
- Create: `src/app/api/health/live/route.ts`
- Test: `src/__tests__/api.health.live.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/live/route';

describe('GET /api/health/live', () => {
  it('returns 200 { status: ok } with no dependencies', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- api.health.live`
Expected: FAIL — `Failed to resolve import "@/app/api/health/live/route"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/api/health/live/route.ts
// Liveness: process is up and serving. No dependencies, public.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok' }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- api.health.live`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/health/live/route.ts src/__tests__/api.health.live.test.ts
git commit -m "feat(health): public liveness probe /api/health/live

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Readiness route (`/api/health`, token-gated)

**Files:**
- Create: `src/app/api/health/route.ts`
- Test: `src/__tests__/api.health.readiness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { checkDbMock, checkRedisMock } = vi.hoisted(() => ({
  checkDbMock: vi.fn(),
  checkRedisMock: vi.fn()
}));
vi.mock('@/lib/health/checks', () => ({
  checkDb: checkDbMock,
  checkRedis: checkRedisMock
}));
// don't instantiate the real Prisma singleton — the route imports it but
// checkDb (mocked) never uses it
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { GET } from '@/app/api/health/route';

const TOKEN = 'test-health-token-0123456789-abcdefghij';

function req(authHeader?: string): Request {
  return new Request('http://localhost/api/health', {
    headers: authHeader ? { authorization: authHeader } : {}
  });
}

beforeEach(() => {
  process.env.HEALTH_TOKEN = TOKEN;
  checkDbMock.mockResolvedValue({ ok: true, ms: 1 });
  checkRedisMock.mockResolvedValue({ ok: true, ms: 1 });
});

describe('GET /api/health (readiness)', () => {
  it('200 with checks when token valid and deps ok', async () => {
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
  });

  it('503 down when the db check fails', async () => {
    checkDbMock.mockResolvedValue({ ok: false, ms: 2001, error: 'timeout' });
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('down');
  });

  it('503 when the redis check fails', async () => {
    checkRedisMock.mockResolvedValue({ ok: false, ms: 2001, error: 'timeout' });
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
  });

  it('401 when the token is missing (and does not run checks)', async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
    expect(checkDbMock).not.toHaveBeenCalled();
  });

  it('401 when the token is wrong', async () => {
    const res = await GET(req('Bearer wrong-token') as never);
    expect(res.status).toBe(401);
  });

  it('503 health_token_unconfigured when HEALTH_TOKEN is unset', async () => {
    delete process.env.HEALTH_TOKEN;
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe('health_token_unconfigured');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- api.health.readiness`
Expected: FAIL — `Failed to resolve import "@/app/api/health/route"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/api/health/route.ts
// Readiness: can the app serve traffic? Checks DB + Redis. Token-gated.
import type { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { checkDb, checkRedis } from '@/lib/health/checks';

export const dynamic = 'force-dynamic';

function bearerMatches(req: NextRequest, expected: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  // sha256 both to a fixed 32-byte length so timingSafeEqual never throws on
  // a length mismatch (it requires equal-length buffers).
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const expected = process.env.HEALTH_TOKEN?.trim();
  if (!expected) {
    // Fail closed: a misconfigured probe reads as "not ready", surfaced loudly
    // on the first readiness check after deploy rather than silently public.
    return Response.json(
      { status: 'down', reason: 'health_token_unconfigured' },
      { status: 503 }
    );
  }
  if (!bearerMatches(req, expected)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  const [db, redis] = await Promise.all([checkDb(prisma), checkRedis()]);
  const ok = db.ok && redis.ok;
  return Response.json(
    { status: ok ? 'ok' : 'down', checks: { db, redis } },
    { status: ok ? 200 : 503 }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- api.health.readiness`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/health/route.ts src/__tests__/api.health.readiness.test.ts
git commit -m "feat(health): token-gated readiness probe /api/health (db + redis)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Config — `.env.example` + Docker `HEALTHCHECK`

**Files:**
- Modify: `.env.example`
- Modify: `Dockerfile`

- [ ] **Step 1: Add `HEALTH_TOKEN` to `.env.example`**

Append after the `LOGIN_RATE_LIMIT_*` block (anywhere in the file is fine):

```bash
# Readiness probe (/api/health) bearer token. 32+ chars recommended.
# When unset, /api/health returns 503 (fail-closed). /api/health/live is always public.
# HEALTH_TOKEN=replace_with_at_least_32_chars
```

- [ ] **Step 2: Add `HEALTHCHECK` to the Dockerfile runtime stage**

In `Dockerfile`, insert between `EXPOSE 3000` (line 26) and `CMD [...]` (line 27). Uses the **public liveness** endpoint (no token needed) and Node 20's global `fetch` (no curl/wget in the alpine image):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

- [ ] **Step 3: Verify nothing else broke**

Run: `npm run typecheck && npm run lint`
Expected: both clean (config-only changes; no TS/lint impact).

- [ ] **Step 4: Commit**

```bash
git add .env.example Dockerfile
git commit -m "chore(health): document HEALTH_TOKEN + Docker HEALTHCHECK -> liveness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — green.
- [ ] `npm run lint` — green.
- [ ] `npm run test:unit` — green (includes the 3 new health test files; no Docker needed).
- [ ] Manual smoke (optional, needs `npm run dev` + Redis/Postgres up):
  - `curl -i localhost:3000/api/health/live` → `200 {"status":"ok"}`
  - `curl -i localhost:3000/api/health` → `503 health_token_unconfigured` (no token set) — or `401` without bearer once `HEALTH_TOKEN` is set, `200`/`503` with a valid bearer.
- [ ] Per §8: write `docs/superpowers/plans/2026-05-31-health-readiness-probe-DONE.md` and open a PR linking the spec.
