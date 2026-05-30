# Automated Test Safety Net — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ungated integration layer run reliably before code leaves the machine, close the 3 untested worker processors, and structurally prevent the coverage gap from reopening — all within the local Husky architecture (no CI, per CLAUDE.md §11).

**Architecture:** A cross-platform `tsx` orchestrator (`npm run gate`) spins up the existing Dockerized Postgres, migrates+seeds, and runs `vitest --mode=integration`. A conditional `pre-push` step ("L2.5") invokes the gate only when the push touches integration-relevant paths. Three new integration tests cover `push-lead`, `generate-commission-pdf`, `generate-commission-xlsx`. A unit-tier guardrail test fails if any worker processor lacks a test.

**Tech Stack:** TypeScript, `tsx`, Vitest 2, Prisma 5 + PostgreSQL, Docker Compose, Husky, BullMQ (processors invoked as plain functions in tests).

**Spec:** [docs/superpowers/specs/2026-05-31-test-safety-net-design.md](../specs/2026-05-31-test-safety-net-design.md)
**Branch:** `claude/test-safety-net` (already created off `main`; spec committed `e7d2396`).

---

### Task 1: The runnable gate (`scripts/gate.ts` + npm scripts)

**Files:**
- Create: `scripts/gate.ts`
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Write `scripts/gate.ts`**

```ts
/**
 * Local integration gate (CLAUDE.md §6 "L2.5"; spec 2026-05-31-test-safety-net).
 *
 * Spins up the Dockerized Postgres from docker-compose.yml, applies migrations +
 * seed against a HOST-FACING DATABASE_URL (localhost, not the compose-internal
 * `db` host), then runs the integration tier. Cross-platform (tsx, not bash) so
 * it behaves the same on Windows/PowerShell and sh.
 *
 *   npm run gate         # up → migrate → seed → integration tests (leaves DB up)
 *   npm run gate:down    # stop the db/redis containers
 */
import { spawn, spawnSync } from 'node:child_process';

// The compose .env points DATABASE_URL at host `db` (resolvable only inside the
// compose network). A host-side runner must use localhost. dotenv (loaded by the
// Prisma CLI) never overrides an already-set env var, so this wins over .env.
const DB_URL =
  process.env.GATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/cabinet';
const childEnv = { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL };
const useShell = process.platform === 'win32'; // resolve npm.cmd / docker.exe

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: childEnv, shell: useShell });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with ${code}`))
    );
  });
}

function pgReady(): boolean {
  const r = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', 'postgres', '-d', 'cabinet'],
    { stdio: 'ignore', env: childEnv, shell: useShell }
  );
  return r.status === 0;
}

async function waitForPostgres(maxAttempts = 30): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    if (pgReady()) {
      console.log(`[gate] Postgres healthy (attempt ${i}).`);
      return;
    }
    console.log(`[gate] waiting for Postgres… (${i}/${maxAttempts})`);
    await sleep(2000);
  }
  throw new Error('[gate] Postgres did not become healthy within ~60s.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--down')) {
    await run('docker', ['compose', 'stop', 'db', 'redis']);
    console.log('[gate] containers stopped.');
    return;
  }

  console.log('[gate] starting Dockerized Postgres…');
  await run('docker', ['compose', 'up', '-d', 'db']);
  await waitForPostgres();

  console.log('[gate] applying migrations…');
  await run('npm', ['run', 'prisma:migrate:deploy']);

  console.log('[gate] seeding…');
  await run('npm', ['run', 'prisma:seed']);

  console.log('[gate] running integration tests…');
  await run('npm', ['run', 'test:integration']);

  console.log('[gate] ✓ integration suite green.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, inside `"scripts"`, add these two entries (next to the other `test:*` scripts):

```json
    "gate": "tsx scripts/gate.ts",
    "gate:down": "tsx scripts/gate.ts --down",
```

- [ ] **Step 3: Verify the gate runs the existing integration suite green**

Run (requires Docker Desktop running):
```bash
npm run gate
```
Expected: Postgres container starts → `prisma migrate deploy` reports migrations applied (or "No pending migrations") → seed runs → vitest runs `--mode=integration` and all ~33 existing integration files pass → `[gate] ✓ integration suite green.`

- [ ] **Step 4: Verify idempotent re-run**

Run `npm run gate` a second time. Expected: container already up (no error), migrate is a no-op, seed upserts cleanly, integration tests green again.

- [ ] **Step 5: Commit**

```bash
git add scripts/gate.ts package.json
git commit -m "feat(test): npm run gate — Dockerized Postgres integration gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Structural guardrail (red → tracked via ALLOWLIST)

**Files:**
- Create: `src/__tests__/worker.processor-coverage.guardrail.test.ts`

This is a **unit-tier** test (it must NOT contain the literal `new PrismaClient(`, or the self-detecting partition in `vitest.config.ts` would mis-classify it as integration). It is gated by `pre-push` (L2) on every push, with no Docker dependency.

- [ ] **Step 1: Write the guardrail test**

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Worker processors that intentionally have NO dedicated test.
// Add an entry ONLY with a written justification. The three below are tracked
// debt closed by Tasks 3-5 of this plan; each task removes its entry.
const ALLOWLIST = new Set<string>([
  'push-lead',                // TODO(Task 3): worker.push-lead.test.ts
  'generate-commission-pdf',  // TODO(Task 4): worker.generate-commission-pdf.test.ts
  'generate-commission-xlsx', // TODO(Task 5): worker.generate-commission-xlsx.test.ts
]);

// vitest runs from the repo root, so cwd is the project root.
const ROOT = process.cwd();
const PROCESSORS_DIR = path.join(ROOT, 'src', 'worker', 'processors');
const TESTS_DIR = path.join(ROOT, 'src', '__tests__');

function processorModuleNames(): string[] {
  return readdirSync(PROCESSORS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
}

function allTestSources(): string {
  return readdirSync(TESTS_DIR)
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => readFileSync(path.join(TESTS_DIR, f), 'utf8'))
    .join('\n');
}

describe('worker processor coverage guardrail', () => {
  it('every worker processor is referenced by at least one test', () => {
    const sources = allTestSources();
    const uncovered = processorModuleNames().filter(
      // substring match also catches relative imports, not just the @/ alias
      (mod) => !ALLOWLIST.has(mod) && !sources.includes(`worker/processors/${mod}`)
    );
    expect(
      uncovered,
      `These worker processors have no test importing them. Add an integration ` +
        `test, or add the module name to ALLOWLIST with a justification:\n  ${uncovered.join('\n  ')}`
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect PASS (the 3 gaps are allow-listed)**

Run:
```bash
npm run test:unit -- worker.processor-coverage.guardrail
```
Expected: PASS (7 real processors are referenced; the 3 untested ones are in ALLOWLIST).

- [ ] **Step 3: Prove the guardrail actually detects gaps (negative probe)**

Temporarily replace the `ALLOWLIST` initializer with `new Set<string>([]);` and re-run the command from Step 2.
Expected: FAIL, with the message listing exactly:
```
  push-lead
  generate-commission-pdf
  generate-commission-xlsx
```
Then **restore** the ALLOWLIST to the three-entry version from Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/worker.processor-coverage.guardrail.test.ts
git commit -m "test(worker): structural guardrail — every processor must have a test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Cover `push-lead` processor

**Files:**
- Create: `src/__tests__/worker.push-lead.test.ts`
- Modify: `src/__tests__/worker.processor-coverage.guardrail.test.ts` (remove `push-lead` from ALLOWLIST)

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { pushLeadProcessor, notifyPushLeadFinalFailure } from '@/worker/processors/push-lead';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { PushLeadJobPayload } from '@/lib/jobs/types';

let prisma: PrismaClient;
let partnerId: string;
let authorUserId: string;
let adminUserId: string;
let leadId: string;

function job(id: string): Job<PushLeadJobPayload> {
  return { id: 'test-pushlead-' + Date.now(), data: { leadId: id } } as Job<PushLeadJobPayload>;
}

beforeAll(async () => {
  process.env.ONE_C_ADAPTER = 'fake';
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
  prisma = new PrismaClient();

  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `PushLeadPartner-${stamp}`, slug: `push-lead-test-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const author = await prisma.user.create({
    data: { email: `author-${stamp}@test.local`, name: 'Lead Author', role: 'partner', partnerId }
  });
  authorUserId = author.id;

  const admin = await prisma.user.create({
    data: { email: `admin-${stamp}@test.local`, name: 'Partner Admin', role: 'partner', partnerId }
  });
  adminUserId = admin.id;
  await prisma.partnerUser.create({
    data: { partnerId, userId: adminUserId, roleInPartner: 'admin', isActive: true, assignedOrgIds: [] }
  });

  const lead = await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: authorUserId,
      clientCompanyName: 'ООО Клиент',
      clientContactName: 'Иван Иванов',
      subject: 'Запрос на обучение',
      productType: ['course'],
      estimatedAmount: 50000
    }
  });
  leadId = lead.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } });
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.syncLog.deleteMany({ where: { entity: 'lead' } });
  await prisma.user.deleteMany({ where: { id: { in: [authorUserId, adminUserId] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  resetOneCAdapter();
  await prisma.$disconnect();
});

describe('pushLeadProcessor', () => {
  it('pushes the lead and records the 1C request id', async () => {
    const result = await pushLeadProcessor(job(leadId), prisma);
    expect(result.leadId).toBe(leadId);
    expect(result.externalIdInOneC).toMatch(/^fake-req-/);

    const reread = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { externalIdInOneC: true }
    });
    expect(reread?.externalIdInOneC).toMatch(/^fake-req-/);
  });

  it('throws when the adapter fails (so BullMQ retries)', async () => {
    process.env.FAKE_ONEC_FAILURE_RATE = '1';
    resetOneCAdapter();
    await expect(pushLeadProcessor(job(leadId), prisma)).rejects.toThrow();
  });
});

describe('notifyPushLeadFinalFailure', () => {
  it('notifies active partner admins with a sync_error notification', async () => {
    await notifyPushLeadFinalFailure(prisma, { leadId, errorMessage: 'boom' });

    const notifs = await prisma.notification.findMany({ where: { partnerId } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(adminUserId);
    expect(notifs[0].type).toBe('sync_error');
    expect(notifs[0].body).toContain('boom');
  });

  it('is a no-op when the lead does not exist', async () => {
    await notifyPushLeadFinalFailure(prisma, { leadId: 'does-not-exist', errorMessage: 'x' });
    const count = await prisma.notification.count({ where: { partnerId } });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run it under the gate — expect PASS**

Run:
```bash
npm run gate
```
(or, if Postgres is already up from Task 1: `npm run test:integration -- worker.push-lead`)
Expected: the 4 `push-lead` assertions pass; the rest of the integration suite stays green.

- [ ] **Step 3: Remove `push-lead` from the guardrail ALLOWLIST**

In `src/__tests__/worker.processor-coverage.guardrail.test.ts`, delete this line from the `ALLOWLIST`:
```ts
  'push-lead',                // TODO(Task 3): worker.push-lead.test.ts
```

- [ ] **Step 4: Run the guardrail — expect PASS (now genuinely covered)**

Run:
```bash
npm run test:unit -- worker.processor-coverage.guardrail
```
Expected: PASS (`push-lead` is now referenced by `worker.push-lead.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/worker.push-lead.test.ts src/__tests__/worker.processor-coverage.guardrail.test.ts
git commit -m "test(worker): cover push-lead processor + final-failure notify

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Cover `generate-commission-pdf` processor

**Files:**
- Create: `src/__tests__/worker.generate-commission-pdf.test.ts`
- Modify: `src/__tests__/worker.processor-coverage.guardrail.test.ts` (remove `generate-commission-pdf` from ALLOWLIST)

The renderer (`renderStatementPdf`) and Supabase storage are mocked — the renderer is already unit-tested (`services.commission.pdf.test.ts`), so this test asserts the processor's **orchestration**: load statement → call renderer with DB data → upload to the partner path → persist `pdfPath`. It stays integration-tier because it reads/writes `CommissionStatement` in Postgres.

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { GenerateCommissionPdfPayload } from '@/lib/jobs/types';

const { uploadMock, renderPdfMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  renderPdfMock: vi.fn()
}));

vi.mock('@/lib/storage/supabase', () => ({
  getServerClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
  documentBucket: 'documents'
}));
vi.mock('@/lib/services/commission/pdf', () => ({
  renderStatementPdf: renderPdfMock
}));

import { generateCommissionPdfProcessor } from '@/worker/processors/generate-commission-pdf';

let prisma: PrismaClient;
let partnerId: string;
let statementId: string;

function job(id: string): Job<GenerateCommissionPdfPayload> {
  return { id: 'test-pdf-' + Date.now(), data: { statementId: id } } as Job<GenerateCommissionPdfPayload>;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `PdfProcPartner-${Date.now()}`, legalName: 'ООО PdfProc', commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const stmt = await prisma.commissionStatement.create({
    data: { partnerId, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') }
  });
  statementId = stmt.id;
});

afterAll(async () => {
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  uploadMock.mockReset();
  renderPdfMock.mockReset();
  renderPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  uploadMock.mockResolvedValue({ error: null });
});

describe('generateCommissionPdfProcessor', () => {
  it('renders, uploads to the partner path, and persists pdfPath', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { pdfPath: null } });

    const result = await generateCommissionPdfProcessor(job(statementId), prisma);

    const expectedPath = `partners/${partnerId}/commission/${statementId}.pdf`;
    expect(result).toEqual({ statementId, path: expectedPath });

    expect(renderPdfMock).toHaveBeenCalledTimes(1);
    const renderArg = renderPdfMock.mock.calls[0][0];
    expect(renderArg.statement.id).toBe(statementId);
    expect(renderArg.partner).toEqual({ name: expect.any(String), legalName: 'ООО PdfProc' });
    expect(renderArg.verifyUrl).toBeNull();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [uploadPath, uploadBuf, uploadOpts] = uploadMock.mock.calls[0];
    expect(uploadPath).toBe(expectedPath);
    expect(Buffer.isBuffer(uploadBuf)).toBe(true);
    expect(uploadOpts).toMatchObject({ contentType: 'application/pdf', upsert: true });

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { pdfPath: true }
    });
    expect(reread?.pdfPath).toBe(expectedPath);
  });

  it('throws NOT_FOUND when the statement does not exist', async () => {
    await expect(generateCommissionPdfProcessor(job('does-not-exist'), prisma)).rejects.toThrow(/NOT_FOUND/);
    expect(renderPdfMock).not.toHaveBeenCalled();
  });

  it('throws STORAGE_FAILURE and does not persist pdfPath when upload errors', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { pdfPath: null } });
    uploadMock.mockResolvedValue({ error: { message: 'bucket exploded' } });

    await expect(generateCommissionPdfProcessor(job(statementId), prisma)).rejects.toThrow(/STORAGE_FAILURE/);

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { pdfPath: true }
    });
    expect(reread?.pdfPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run it under the gate — expect PASS**

Run:
```bash
npm run test:integration -- worker.generate-commission-pdf
```
(Postgres must be up — from a prior `npm run gate`.)
Expected: 3 assertions pass.

- [ ] **Step 3: Remove `generate-commission-pdf` from the guardrail ALLOWLIST**

Delete this line from `ALLOWLIST` in `worker.processor-coverage.guardrail.test.ts`:
```ts
  'generate-commission-pdf',  // TODO(Task 4): worker.generate-commission-pdf.test.ts
```

- [ ] **Step 4: Run the guardrail — expect PASS**

```bash
npm run test:unit -- worker.processor-coverage.guardrail
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/worker.generate-commission-pdf.test.ts src/__tests__/worker.processor-coverage.guardrail.test.ts
git commit -m "test(worker): cover generate-commission-pdf processor (orchestration)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Cover `generate-commission-xlsx` processor

**Files:**
- Create: `src/__tests__/worker.generate-commission-xlsx.test.ts`
- Modify: `src/__tests__/worker.processor-coverage.guardrail.test.ts` (remove the last ALLOWLIST entry → empty)

- [ ] **Step 1: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { GenerateCommissionXlsxPayload } from '@/lib/jobs/types';

const { uploadMock, renderXlsxMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  renderXlsxMock: vi.fn()
}));

vi.mock('@/lib/storage/supabase', () => ({
  getServerClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
  documentBucket: 'documents'
}));
vi.mock('@/lib/services/commission/xlsx', () => ({
  renderStatementXlsx: renderXlsxMock
}));

import { generateCommissionXlsxProcessor } from '@/worker/processors/generate-commission-xlsx';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let prisma: PrismaClient;
let partnerId: string;
let statementId: string;

function job(id: string): Job<GenerateCommissionXlsxPayload> {
  return { id: 'test-xlsx-' + Date.now(), data: { statementId: id } } as Job<GenerateCommissionXlsxPayload>;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `XlsxProcPartner-${Date.now()}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const stmt = await prisma.commissionStatement.create({
    data: { partnerId, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') }
  });
  statementId = stmt.id;
});

afterAll(async () => {
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  uploadMock.mockReset();
  renderXlsxMock.mockReset();
  renderXlsxMock.mockResolvedValue(Buffer.from('PK fake-xlsx'));
  uploadMock.mockResolvedValue({ error: null });
});

describe('generateCommissionXlsxProcessor', () => {
  it('renders, uploads to the partner path, and persists xlsxPath', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { xlsxPath: null } });

    const result = await generateCommissionXlsxProcessor(job(statementId), prisma);

    const expectedPath = `partners/${partnerId}/commission/${statementId}.xlsx`;
    expect(result).toEqual({ statementId, path: expectedPath });

    expect(renderXlsxMock).toHaveBeenCalledTimes(1);
    const renderArg = renderXlsxMock.mock.calls[0][0];
    expect(renderArg.statement.id).toBe(statementId);
    expect(renderArg.partner).toEqual({ name: expect.any(String) });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [uploadPath, uploadBuf, uploadOpts] = uploadMock.mock.calls[0];
    expect(uploadPath).toBe(expectedPath);
    expect(Buffer.isBuffer(uploadBuf)).toBe(true);
    expect(uploadOpts).toMatchObject({ contentType: XLSX_CONTENT_TYPE, upsert: true });

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { xlsxPath: true }
    });
    expect(reread?.xlsxPath).toBe(expectedPath);
  });

  it('throws NOT_FOUND when the statement does not exist', async () => {
    await expect(generateCommissionXlsxProcessor(job('does-not-exist'), prisma)).rejects.toThrow(/NOT_FOUND/);
    expect(renderXlsxMock).not.toHaveBeenCalled();
  });

  it('throws STORAGE_FAILURE and does not persist xlsxPath when upload errors', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { xlsxPath: null } });
    uploadMock.mockResolvedValue({ error: { message: 'bucket exploded' } });

    await expect(generateCommissionXlsxProcessor(job(statementId), prisma)).rejects.toThrow(/STORAGE_FAILURE/);

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { xlsxPath: true }
    });
    expect(reread?.xlsxPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run it under the gate — expect PASS**

```bash
npm run test:integration -- worker.generate-commission-xlsx
```
Expected: 3 assertions pass.

- [ ] **Step 3: Empty the guardrail ALLOWLIST**

In `worker.processor-coverage.guardrail.test.ts`, the `ALLOWLIST` should now have no remaining TODO entries:
```ts
const ALLOWLIST = new Set<string>([]);
```

- [ ] **Step 4: Run the full unit suite — guardrail green with an empty allowlist**

```bash
npm run test:unit
```
Expected: entire unit suite passes, including the guardrail — meaning all 10 worker processors are now covered with zero exceptions.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/worker.generate-commission-xlsx.test.ts src/__tests__/worker.processor-coverage.guardrail.test.ts
git commit -m "test(worker): cover generate-commission-xlsx + empty guardrail allowlist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Conditional pre-push enforcement (L2.5)

**Files:**
- Create: `scripts/gate-precheck.ts`
- Modify: `.husky/pre-push`

- [ ] **Step 1: Write `scripts/gate-precheck.ts`**

```ts
/**
 * pre-push helper: decides whether this push needs the integration gate.
 *
 * Reads git's pre-push stdin protocol (`<localRef> <localSha> <remoteRef> <remoteSha>`
 * per line), computes the changed files, and exits:
 *   0  → integration-relevant changes AND Docker available → run the gate
 *   2  → no integration-relevant changes → skip the gate
 *   1  → relevant changes but Docker unavailable → block (clear message)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const TRIGGER_DIRS = ['prisma/', 'src/worker/', 'src/lib/services/'];
const ZERO = '0000000000000000000000000000000000000000';
const useShell = process.platform === 'win32';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8'); // fd 0 = stdin
  } catch {
    return '';
  }
}

function gitLines(cmd: string): string[] {
  try {
    return execSync(cmd, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles(): string[] {
  const files = new Set<string>();
  for (const line of readStdin().split('\n').map((s) => s.trim()).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO) continue; // branch deletion — nothing to push

    let range: string;
    if (!remoteSha || remoteSha === ZERO) {
      // New branch on the remote: diff against the merge-base with main.
      let base =
        gitLines(`git merge-base origin/main ${localSha}`)[0] ??
        gitLines(`git merge-base main ${localSha}`)[0] ??
        '';
      range = base ? `${base}..${localSha}` : localSha;
    } else {
      range = `${remoteSha}..${localSha}`;
    }
    for (const f of gitLines(`git diff --name-only ${range}`)) files.add(f);
  }
  return [...files];
}

function isRelevant(file: string): boolean {
  if (TRIGGER_DIRS.some((d) => file.startsWith(d))) return true;
  // A directly-edited integration test (one that spins up a real PrismaClient).
  if (/^src\/__tests__\/.*\.test\.tsx?$/.test(file) && existsSync(file)) {
    try {
      return readFileSync(file, 'utf8').includes('new PrismaClient(');
    } catch {
      return false;
    }
  }
  return false;
}

function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: useShell });
  return r.status === 0;
}

const relevant = changedFiles().filter(isRelevant);

if (relevant.length === 0) {
  console.log('[gate-precheck] No integration-relevant changes — skipping the gate.');
  process.exit(2);
}

console.log('[gate-precheck] Integration-relevant changes:\n  ' + relevant.join('\n  '));

if (!dockerAvailable()) {
  console.error(
    '\n[gate-precheck] Эти изменения затрагивают интеграционный слой, но Docker недоступен.\n' +
      'Запусти Docker Desktop и повтори push, либо (осознанно) `git push --no-verify`.\n'
  );
  process.exit(1);
}

process.exit(0);
```

- [ ] **Step 2: Replace `.husky/pre-push`**

Overwrite the file with:

```sh
#!/usr/bin/env sh
# L2: full unit suite. Target ~15-30 sec.
# L2.5: conditional integration gate when the push touches the integration layer.
#       See docs/superpowers/specs/2026-05-31-test-safety-net-design.md.
#
# Integration tests require live Postgres; the gate spins one up in Docker.
# Bypass in an emergency (use sparingly): git push --no-verify

# Capture push refs from stdin BEFORE anything else can consume them.
PUSH_INFO="$(cat)"

npm run test:unit || exit 1

echo "$PUSH_INFO" | npx tsx scripts/gate-precheck.ts
RC=$?
if [ "$RC" -eq 0 ]; then
  echo "[pre-push] changes touch the integration layer — running the gate…"
  npm run gate || exit 1
elif [ "$RC" -eq 2 ]; then
  : # not relevant — gate skipped (message already printed)
else
  exit "$RC" # Docker unavailable while relevant, or precheck error — block.
fi
```

- [ ] **Step 3: Verify — neutral (docs-only) change is skipped**

The spec commit `e7d2396` touched only a `.md` file, so its diff is docs-only and deterministic. Run:
```bash
echo "refs/heads/x $(git rev-parse e7d2396) refs/heads/x $(git rev-parse e7d2396~1)" | npx tsx scripts/gate-precheck.ts; echo "exit=$?"
```
Expected: `[gate-precheck] No integration-relevant changes — skipping the gate.` and `exit=2`.

- [ ] **Step 4: Verify — a worker change triggers (Docker up)**

Make a no-op whitespace edit in `src/worker/processors/scan-document.ts`, stage+commit it on a throwaway commit, then:
```bash
echo "refs/heads/x $(git rev-parse HEAD) refs/heads/x $(git rev-parse HEAD~1)" | npx tsx scripts/gate-precheck.ts; echo "exit=$?"
```
Expected: lists `src/worker/processors/scan-document.ts` and (Docker running) `exit=0`. Reset the throwaway commit afterward: `git reset --hard HEAD~1`.

- [ ] **Step 5: Verify — relevant change with Docker stopped blocks**

Stop Docker Desktop, repeat the Step 4 command. Expected: the Russian "Docker недоступен" message and `exit=1`. Restart Docker afterward.

- [ ] **Step 6: Commit**

```bash
git add scripts/gate-precheck.ts .husky/pre-push
git commit -m "feat(test): conditional pre-push integration gate (L2.5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Document the L2.5 layer (CLAUDE.md §6)

**Files:**
- Modify: `CLAUDE.md` (§6 test table + a short note)

- [ ] **Step 1: Add the L2.5 row to the §6 layer table**

In CLAUDE.md §6, the layer table currently has rows for **L1**, **L2**, **L3**. Insert a new row between **L2** and **L3**:

```markdown
| **L2.5** | `git push` (затрагивающий `prisma/`/`worker/`/`services/`) | `npm run gate` | Интеграционный слой против Docker-Postgres | единицы минут |
```

- [ ] **Step 2: Add the gate note under the table**

Immediately after the layer table in §6, add:

```markdown
**`npm run gate` (L2.5):** кроссплатформенный `tsx`-оркестратор — поднимает Docker-Postgres из [docker-compose.yml](docker-compose.yml), `prisma migrate deploy` + seed против host-facing `DATABASE_URL` (localhost, переопределяемо `GATE_DATABASE_URL`), затем `test:integration`. Условно вызывается из `pre-push` (`scripts/gate-precheck.ts` смотрит изменённые пути); запускается и вручную перед PR. `npm run gate:down` останавливает контейнеры. Требует Docker; обход — `git push --no-verify`. Полнота покрытия воркера держится unit-тестом `worker.processor-coverage.guardrail.test.ts` (падает, если у процессора нет теста).
```

- [ ] **Step 3: Sanity-check the docs render**

Run:
```bash
npx prettier --check CLAUDE.md
```
Expected: either "All matched files use Prettier code style!" or a formatting diff — if it reports issues, run `npx prettier --write CLAUDE.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(test): document the L2.5 integration gate in CLAUDE.md §6

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — green (new scripts + tests compile under strict TS).
- [ ] `npm run lint` — green.
- [ ] `npm run gate` — Postgres up, migrate+seed, full integration suite (now incl. the 3 new tests) green.
- [ ] `npm run test:unit` — full unit suite incl. the guardrail (empty allowlist) green.
- [ ] Per §8: write a close-out `docs/superpowers/plans/2026-05-31-test-safety-net-DONE.md` and open a PR linking the spec.
