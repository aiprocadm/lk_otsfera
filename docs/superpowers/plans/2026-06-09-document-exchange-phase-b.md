# Document Exchange Phase B — order-less «общие документы» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow documents that belong to a `(counterparty, company)` relationship instead of a specific order — order-less «общие документы» — while preserving Phase A channel isolation.

**Architecture:** `Document.orderId` becomes nullable; a new nullable `Document.companyId` anchors order-less docs to a single company (a DB CHECK enforces the XOR: exactly one of orderId/companyId is set). All channel/scope rules live in `documentChannelPolicy.ts` (single source of truth, per CLAUDE.md §4). Order-less directions: org bidirectional, partner outgoing-only. Order-less manager scope is company-level (not teamMode-aware — teamMode partitions orders, which order-less docs lack).

**Tech Stack:** Next.js 15 App Router · Prisma 5 + PostgreSQL · Vitest · TypeScript strict. Spec: [docs/superpowers/specs/2026-06-09-document-exchange-phase-b-design.md](../specs/2026-06-09-document-exchange-phase-b-design.md).

**Conventions for every task:**
- Result contract (CLAUDE.md §3): `{ ok: true; ... } | { ok: false; error: <stable code> }`.
- Unit-tested components MUST `import React` (vitest classic JSX — see project memory).
- Commit after each task. Push with `git push` only when the user asks (gate may need `--no-verify` if Docker :5432 is busy).
- Run `npm run typecheck` after schema/type changes; `npm run test:unit` for unit tasks; integration tasks need live Postgres (`npm run test:integration`).

---

## File Structure

**Create:**
- `prisma/migrations/<timestamp>_document_order_less/migration.sql` — orderId nullable + companyId + index + XOR CHECK.
- `src/lib/services/manager/counterparties.ts` — counterparty picker derivation (managed orgs + partners whose company-union contains the manager's company).
- `src/components/organization/organization-order-less-upload-form.tsx` — org «Общие документы» inline upload form.
- `src/components/manager/manager-order-less-upload-form.tsx` — manager order-less upload form with counterparty picker.
- `src/app/api/manager/documents/order-less/route.ts` — manager order-less upload endpoint.
- Test files listed per task.

**Modify:**
- `prisma/schema.prisma` — Document.orderId nullable, +companyId+company relation+index; Company.documents back-relation.
- `src/lib/auth/documentChannelPolicy.ts` — order-bound/order-less where helpers, `managerOrderLessWhere`, `canManagerUploadOrderLess`, `canReadOrderLessDocument`.
- `src/lib/services/documents/upload-core.ts` — nullable orderId + companyId + storage-path branch.
- `src/lib/services/manager/uploads.ts` — add `createManagerOrderLessDocument`.
- `src/server-actions/organization/documents.ts` — order-less branch (orderId optional).
- `src/lib/notifications/manager.ts` — company-scoped order-less recipients + `notifyManagersOrderLess`.
- `src/lib/services/{organization/documents,partner/orgDocuments,partner/documentsList,manager/documents}.ts` — nullable row types, order-less list functions, order-less download branches.
- `src/lib/auth/policy.ts` — `canReadDocument` order-less branch; `DocumentLike` nullable.
- `src/app/api/documents/[id]/download/route.ts` — select companyId + counterparty.
- `src/components/partner/documents-list.tsx` — order-less label.
- `src/app/{organization,partner,manager,admin}/documents/page.tsx` — order-less tabs/sections.
- Null-cascade typecheck sites (Task 5).
- Existing test seed files (Task 16).

---

## Task 1: Schema migration + null-cascade (ATOMIC — folds Tasks 4 & 5)

> **ATOMICITY (load-bearing):** The project pre-commit hook runs `npm run typecheck` on every commit. The moment `orderId` becomes nullable and the Prisma client is regenerated, every `Document.order` deref and every `orderId: string` row type becomes a typecheck error. Therefore Task 1 MUST also complete **all of Tasks 4 and 5** (nullable row types + null-safe `.order?.` derefs + `DocumentLike` widening) and only commit ONCE, after `npm run typecheck` is green. Tasks 4 and 5 below are NOT separate commits — they are the second half of this task. (Mirrors Phase A's atomic schema task.)

**Files:**
- Modify: `prisma/schema.prisma` (model `Document` ~467-497, model `Company` ~410-419)
- Create: `prisma/migrations/<timestamp>_document_order_less/migration.sql`
- Test: `src/__tests__/schema.document.test.ts` (existing — extend)

- [ ] **Step 1: Edit `prisma/schema.prisma` — `Document` model**

Change `orderId`/`order` to nullable and add the company anchor. In model `Document`:
```prisma
  orderId          String?
  order            Order?            @relation(fields: [orderId], references: [id])
  companyId        String?
  // Restrict (not SetNull): an order-less doc with companyId nulled would
  // violate the XOR CHECK below. Companies are not deleted in normal ops.
  company          Company?          @relation(fields: [companyId], references: [id], onDelete: Restrict)
```
Add to the `@@index` block:
```prisma
  @@index([companyId])
```

- [ ] **Step 2: Edit `prisma/schema.prisma` — `Company` back-relation**

In model `Company`, add to the relations list (next to `orders Order[]`):
```prisma
  documents     Document[]
```

- [ ] **Step 3: Generate the migration skeleton (create-only)**

Run: `npx prisma migrate dev --create-only --name document_order_less`
Expected: creates `prisma/migrations/<timestamp>_document_order_less/migration.sql` with auto SQL. Do NOT apply yet.

- [ ] **Step 4: Replace the migration SQL with the safe ordered sequence**

Overwrite `prisma/migrations/<timestamp>_document_order_less/migration.sql` with:
```sql
-- orderId becomes optional (order-less documents)
ALTER TABLE "Document" ALTER COLUMN "orderId" DROP NOT NULL;

-- company anchor for order-less documents (NULL for order-bound docs)
ALTER TABLE "Document" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");

-- XOR invariant: a document is either order-bound (orderId set, companyId null)
-- or order-less (orderId null, companyId set) — never neither, never both.
-- Existing rows are all order-bound with companyId NULL, so they pass as-is.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_order_xor_company" CHECK (
    ("orderId" IS NOT NULL AND "companyId" IS NULL) OR
    ("orderId" IS NULL AND "companyId" IS NOT NULL)
  );
```

- [ ] **Step 5: Apply the migration + regenerate client**

Run: `npx prisma migrate dev` then `npm run prisma:generate`
Expected: migration applies clean (existing order-bound rows satisfy the CHECK); Prisma client regenerated with `orderId: string | null`, `companyId: string | null`.

- [ ] **Step 6: Extend schema test for the XOR invariant**

Add to `src/__tests__/schema.document.test.ts` (this is a `new PrismaClient()` integration test — needs live Postgres):
```ts
it('rejects a document that is neither order-bound nor order-less (XOR CHECK)', async () => {
  await expect(
    prisma.document.create({
      data: {
        name: 'bad.pdf', path: 'fake://bad', mimeType: 'application/pdf', type: 'other',
        counterpartyType: 'organization', counterpartyId: 'x'
        // no orderId, no companyId
      } as never
    })
  ).rejects.toThrow();
});
```

- [ ] **Step 7: Run the schema test**

Run: `npm run test:integration -- schema.document`
Expected: PASS (new XOR test rejects the neither-anchor row).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/__tests__/schema.document.test.ts
git commit -m "feat(docs): Document.orderId nullable + companyId anchor (order-less, XOR CHECK)"
```

---

## Task 2: documentChannelPolicy — order-less axis + scope + read/upload gates

**Files:**
- Modify: `src/lib/auth/documentChannelPolicy.ts`
- Test: `src/__tests__/auth.documentChannelPolicy.test.ts` (existing — extend)

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/auth.documentChannelPolicy.test.ts`:
```ts
import {
  orderBoundWhere, orderLessWhere, managerOrderLessWhere,
  canManagerUploadOrderLess, canReadOrderLessDocument
} from '@/lib/auth/documentChannelPolicy';

describe('order-less axis', () => {
  it('orderBoundWhere matches docs with an order', () => {
    expect(orderBoundWhere()).toEqual({ orderId: { not: null } });
  });
  it('orderLessWhere matches docs without an order', () => {
    expect(orderLessWhere()).toEqual({ orderId: null });
  });
  it('managerOrderLessWhere pins company + hides infected', () => {
    expect(managerOrderLessWhere('co-1')).toEqual({
      orderId: null, companyId: 'co-1', scanStatus: { not: 'infected' }
    });
  });
});

describe('canManagerUploadOrderLess', () => {
  const scope = { managedOrgIds: ['o1'], partnerIds: ['p1'] };
  it('allows org channel in managed orgs', () => {
    expect(canManagerUploadOrderLess({ type: 'organization', id: 'o1' }, scope)).toBe(true);
  });
  it('rejects org channel outside managed orgs', () => {
    expect(canManagerUploadOrderLess({ type: 'organization', id: 'oX' }, scope)).toBe(false);
  });
  it('allows partner channel in scope', () => {
    expect(canManagerUploadOrderLess({ type: 'partner', id: 'p1' }, scope)).toBe(true);
  });
  it('rejects partner channel outside scope', () => {
    expect(canManagerUploadOrderLess({ type: 'partner', id: 'pX' }, scope)).toBe(false);
  });
});

describe('canReadOrderLessDocument', () => {
  const doc = { counterpartyType: 'partner' as const, counterpartyId: 'p1', companyId: 'co-1' };
  it('admin reads anything', () => {
    expect(canReadOrderLessDocument({ role: 'admin' }, doc)).toBe(true);
  });
  it('manager reads only same-company', () => {
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-1' }, doc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-2' }, doc)).toBe(false);
  });
  it('partner reads only its partner channel', () => {
    expect(canReadOrderLessDocument({ role: 'partner', partnerId: 'p1' }, doc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'partner', partnerId: 'pX' }, doc)).toBe(false);
  });
  it('organization reads only its org channel', () => {
    const orgDoc = { counterpartyType: 'organization' as const, counterpartyId: 'o1', companyId: 'co-1' };
    expect(canReadOrderLessDocument({ role: 'organization', organizationId: 'o1' }, orgDoc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'organization', organizationId: 'oX' }, orgDoc)).toBe(false);
  });
  it('manager denied when doc has no company', () => {
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-1' }, { ...doc, companyId: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- auth.documentChannelPolicy`
Expected: FAIL — imported functions not defined.

- [ ] **Step 3: Implement in `src/lib/auth/documentChannelPolicy.ts`**

Append (the file already exports `CounterpartyType`, `DocumentChannel`, and imports `INFECTED_HIDDEN_WHERE`):
```ts
/** Order-bound vs order-less axis — composed with the channel where-builders. */
export function orderBoundWhere(): Prisma.DocumentWhereInput {
  return { orderId: { not: null } };
}
export function orderLessWhere(): Prisma.DocumentWhereInput {
  return { orderId: null };
}

/**
 * Manager visibility for order-less documents. Order-less docs have no order,
 * so teamMode (which partitions orders) does not apply — visibility is purely
 * company-level. Leader sees the same company set; admin uses /admin (Model A).
 */
export function managerOrderLessWhere(companyId: string): Prisma.DocumentWhereInput {
  return { orderId: null, companyId, ...INFECTED_HIDDEN_WHERE };
}

/** Manager order-less upload gate — channel must be in the manager's resolved scope. */
export function canManagerUploadOrderLess(
  channel: DocumentChannel,
  scope: { managedOrgIds: string[]; partnerIds: string[] }
): boolean {
  return channel.type === 'organization'
    ? scope.managedOrgIds.includes(channel.id)
    : scope.partnerIds.includes(channel.id);
}

/**
 * Read authorization for an order-less document (download gate). Order-less docs
 * cannot pass through the order-centric `canReadOrder` (order is null), so this
 * is the dedicated branch: managers gate on the doc's companyId, clients on their
 * own channel. Pure + testable — called from every download guard.
 */
export function canReadOrderLessDocument(
  session: { role: string; organizationId?: string | null; partnerId?: string | null; companyId?: string | null },
  doc: { counterpartyType: CounterpartyType; counterpartyId: string; companyId: string | null }
): boolean {
  if (session.role === 'admin') return true;
  if (session.role === 'manager') return !!doc.companyId && doc.companyId === session.companyId;
  if (session.role === 'organization') {
    return doc.counterpartyType === 'organization' && doc.counterpartyId === session.organizationId;
  }
  if (session.role === 'partner') {
    return doc.counterpartyType === 'partner' && doc.counterpartyId === session.partnerId;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- auth.documentChannelPolicy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/documentChannelPolicy.ts src/__tests__/auth.documentChannelPolicy.test.ts
git commit -m "feat(docs): order-less channel-policy axis, scope, read/upload gates"
```

---

## Task 3: upload-core — nullable orderId + companyId + storage-path branch

**Files:**
- Modify: `src/lib/services/documents/upload-core.ts`
- Test: `src/__tests__/services.documents.upload-core.test.ts` (existing — extend)

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/services.documents.upload-core.test.ts` (it mocks supabase/prisma — follow the existing mock pattern in that file; this assertion targets the create payload):
```ts
it('order-less upload sets companyId, null orderId, and counterparty storage path', async () => {
  // Arrange mocks per the existing file pattern so prisma.document.create is captured.
  const result = await persistUploadedDocument(prismaMock, {
    counterparty: { type: 'partner', id: 'p1' },
    orderId: null,
    companyId: 'co-1',
    direction: 'outgoing',
    docType: 'other',
    uploadedById: 'u1',
    source: 'manager',
    file: { name: 'x.pdf', size: 10, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
  });
  expect(result.ok).toBe(true);
  const createArg = createSpy.mock.calls[0][0].data;
  expect(createArg.orderId).toBeNull();
  expect(createArg.companyId).toBe('co-1');
  expect(uploadSpy.mock.calls[0][0]).toMatch(/^counterparty\/partner\/p1\//);
});
```
(Adapt `prismaMock`/`createSpy`/`uploadSpy` to the names already used in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- services.documents.upload-core`
Expected: FAIL — `companyId` not on `PersistDocumentArgs`; storage path always `orders/...`.

- [ ] **Step 3: Implement in `src/lib/services/documents/upload-core.ts`**

Change `PersistDocumentArgs` (lines 53-61):
```ts
export type PersistDocumentArgs = {
  counterparty: { type: 'organization' | 'partner'; id: string };
  orderId: string | null;
  companyId?: string | null;
  direction: DocumentDirection;
  docType: string;
  uploadedById: string;
  source: UploadSource;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};
```
Change the storage path (line 83) to branch on order-bound vs order-less:
```ts
  const storagePath = args.orderId
    ? `orders/${args.orderId}/${randomUUID()}-${safeName}`
    : `counterparty/${args.counterparty.type}/${args.counterparty.id}/${randomUUID()}-${safeName}`;
```
Change the `prisma.document.create` data (lines 98-111) to include companyId:
```ts
    data: {
      orderId: args.orderId,
      companyId: args.companyId ?? null,
      counterpartyType: args.counterparty.type,
      counterpartyId: args.counterparty.id,
      name: args.file.name,
      mimeType: args.file.mimeType,
      size: args.file.size,
      path: storagePath,
      type: docType,
      direction: args.direction,
      generatedBy: 'user',
      scanStatus: 'pending',
      uploadedById: args.uploadedById
    } as Prisma.DocumentUncheckedCreateInput
```
Change the audit `after` block (lines 130-140) to record the anchor:
```ts
    after: {
      orderId: args.orderId,
      companyId: args.companyId ?? null,
      counterpartyType: args.counterparty.type,
      counterpartyId: args.counterparty.id,
      direction: args.direction,
      docType,
      source: args.source,
      path: storagePath,
      mimeType: args.file.mimeType,
      size: args.file.size
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- services.documents.upload-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/documents/upload-core.ts src/__tests__/services.documents.upload-core.test.ts
git commit -m "feat(docs): upload-core supports order-less (companyId + counterparty path)"
```

---

## Task 4: Null-cascade — document row types become nullable

**Files:**
- Modify: `src/lib/services/organization/documents.ts` (type `OrgDocRow` 5-16, map 110-121)
- Modify: `src/lib/services/partner/orgDocuments.ts` (type `OrgDocumentRow` 4-15, map 82-93)
- Modify: `src/lib/services/partner/documentsList.ts` (row type + map ~84-85)
- Test: `src/__tests__/services.organization.documents.test.ts` (existing — extend)

- [ ] **Step 1: Make `OrgDocRow` nullable in `organization/documents.ts`**

Lines 5-16 — change `orderId` and `orderTitle` to nullable:
```ts
export type OrgDocRow = {
  id: string;
  name: string;
  type: DocumentType;
  direction: DocumentDirection;
  signedAt: Date | null;
  createdAt: Date;
  size: number | null;
  orderId: string | null;
  orderNumber: string | null;
  orderTitle: string | null;
};
```
The `select` already pulls `order: { select: { orderNumber, title } }`; `order` is now nullable. Update the map (lines 110-121):
```ts
  const rows: OrgDocRow[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null
  }));
```

- [ ] **Step 2: Make `OrgDocumentRow` nullable in `partner/orgDocuments.ts`**

Lines 4-15 — same nullable change (`orderId: string | null`, `orderTitle: string | null`). Update the map (lines 90-92):
```ts
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null
```

- [ ] **Step 3: Make the partner documentsList row nullable in `partner/documentsList.ts`**

Open the file. Change the row type's `orderId`/`orderTitle` to `string | null` and the map at ~84-85 to `d.order?.orderNumber ?? null` / `d.order?.title ?? null` (same shape as Steps 1-2).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS for these three files (other `.order` derefs handled in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/organization/documents.ts src/lib/services/partner/orgDocuments.ts src/lib/services/partner/documentsList.ts
git commit -m "refactor(docs): document row types nullable for order-less"
```

---

## Task 5: Null-cascade — remaining `.order` derefs + DocumentLike

**Files (each has a Document query whose `order` is now nullable — add optional chaining):**
- Modify: `src/lib/services/manager/documents.ts` (LIST_INCLUDE consumers; `getDocumentForDownload` 116-124 — handled fully in Task 11, here only make it typecheck)
- Modify: `src/app/manager/documents/page.tsx:53-54`
- Modify: `src/lib/services/manager/dashboard/events.ts:105,114` (doc + payment order)
- Modify: `src/lib/services/manager/dashboard/attention.ts:151,158`
- Modify: `src/lib/services/organization/dashboard.ts:140`
- Modify: `src/lib/auth/policy.ts` `DocumentLike` (7-13)

- [ ] **Step 1: `manager/documents/page.tsx` map (53-54)**

Order-less docs do not appear in `listDocuments` (its scope filters by the order relation), but `d.order` is now typed nullable. Make it typecheck-safe:
```ts
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null
```

- [ ] **Step 2: `policy.ts` `DocumentLike` nullable + add companyId (7-13)**

```ts
type DocumentLike = {
  id: string;
  orderId: string | null;
  companyId?: string | null;
  order?: { companyId: string } | null;
  counterpartyType?: 'organization' | 'partner';
  counterpartyId?: string;
};
```
(The `canReadDocument` body is rewritten in Task 11; this step only widens the type so dependents compile.)

- [ ] **Step 3: Dashboard derefs — add `?.` at each site**

In `manager/dashboard/events.ts` (105, 114), `manager/dashboard/attention.ts` (151, 158), `organization/dashboard.ts` (140): replace `X.order.orderNumber`/`X.order.title` with `X.order?.orderNumber ?? null` / `X.order?.title ?? null`. These feeds filter documents by the order relation, so order-less rows never appear — the `?.` is purely to satisfy the nullable type. (Comment.order / Payment.order in those files are NOT Document relations and stay unchanged.)

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS across the whole project (Task 11 will refine the download guards, but they must already compile).

- [ ] **Step 5: Run unit suite (regression)**

Run: `npm run test:unit`
Expected: PASS (no behavior change — only optional chaining on always-present relations).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/manager/documents.ts src/app/manager/documents/page.tsx src/lib/services/manager/dashboard/events.ts src/lib/services/manager/dashboard/attention.ts src/lib/services/organization/dashboard.ts src/lib/auth/policy.ts
git commit -m "refactor(docs): null-safe .order derefs for nullable orderId"
```

---

## Task 6: Manager counterparty picker derivation

**Files:**
- Create: `src/lib/services/manager/counterparties.ts`
- Test: `src/__tests__/services.manager.counterparties.test.ts` (integration — `new PrismaClient()`)

- [ ] **Step 1: Write failing integration test**

Create `src/__tests__/services.manager.counterparties.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';

let prisma: PrismaClient;
let companyId: string, otherCompanyId: string, orgId: string, partnerInCompany: string, partnerOther: string, mgrId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  const company = await prisma.company.create({ data: { name: `CPC-${s}` } });
  companyId = company.id;
  const other = await prisma.company.create({ data: { name: `CPO-${s}` } });
  otherCompanyId = other.id;
  const pIn = await prisma.partner.create({ data: { name: `CPpin-${s}`, commissionRate: 0 } });
  partnerInCompany = pIn.id;
  const pOut = await prisma.partner.create({ data: { name: `CPpout-${s}`, commissionRate: 0 } });
  partnerOther = pOut.id;
  const org = await prisma.organization.create({ data: { name: `CPorg-${s}`, companyId, partnerId: partnerInCompany } });
  orgId = org.id;
  // partnerOther touches only the other company via an order
  const orgOther = await prisma.organization.create({ data: { name: `CPorg2-${s}`, companyId: otherCompanyId } });
  await prisma.order.create({ data: { title: 'o', companyId: otherCompanyId, organizationId: orgOther.id, partnerId: partnerOther } });
  const mgr = await prisma.user.create({ data: { email: `cpm-${s}@x.io`, role: 'manager', companyId, isActive: true } });
  mgrId = mgr.id;
  await prisma.organizationManager.create({ data: { organizationId: orgId, userId: mgrId, isActive: true } });
});

afterAll(async () => {
  await prisma.organizationManager.deleteMany({ where: { userId: mgrId } });
  await prisma.order.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.organization.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.user.delete({ where: { id: mgrId } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerInCompany, partnerOther] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe('listManagerCounterparties', () => {
  it('returns managed orgs and partners whose company-union includes the manager company', async () => {
    const session = { sub: mgrId, role: 'manager', companyId, managedOrgIds: [orgId] } as never;
    const res = await listManagerCounterparties(prisma, session);
    expect(res.organizations.map((o) => o.id)).toContain(orgId);
    expect(res.partners.map((p) => p.id)).toContain(partnerInCompany);
    expect(res.partners.map((p) => p.id)).not.toContain(partnerOther);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- services.manager.counterparties`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/services/manager/counterparties.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

export type CounterpartyOption = { id: string; name: string };
export type ManagerCounterparties = {
  organizations: CounterpartyOption[];
  partners: CounterpartyOption[];
};

/**
 * Resolves the counterparties a manager may target with an order-less document.
 * Organizations: the manager's scoped orgs (company-wide when teamMode=ON, else
 * the per-manager managed set). Partners: any partner whose company-union
 * (organizations[].companyId ∪ orders[].companyId) contains the manager's
 * company — write pins companyId=session.companyId, so a multi-company partner
 * is offered to each company's managers but the doc stays company-isolated.
 */
export async function listManagerCounterparties(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ManagerCounterparties> {
  const companyId = session.companyId;
  if (!companyId) return { organizations: [], partners: [] };

  const teamMode = await getCompanyTeamVisibility(prisma, companyId);
  const orgs = await prisma.organization.findMany({
    where: teamMode ? { companyId } : { id: { in: managedOrgIds(session) } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  const partners = await prisma.partner.findMany({
    where: {
      isActive: true,
      OR: [
        { organizations: { some: { companyId } } },
        { orders: { some: { companyId } } }
      ]
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  return {
    organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
    partners: partners.map((p) => ({ id: p.id, name: p.name }))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- services.manager.counterparties`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/manager/counterparties.ts src/__tests__/services.manager.counterparties.test.ts
git commit -m "feat(docs): manager counterparty picker derivation (company-union partners)"
```

---

## Task 7: Manager order-less upload service

**Files:**
- Modify: `src/lib/services/manager/uploads.ts`
- Test: `src/__tests__/services.manager.uploads.test.ts` (existing — extend)

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/services.manager.uploads.test.ts` (mirror its existing mock setup for prisma/persist):
```ts
it('order-less: persists with companyId=session.companyId, orderId=null, notifies channel', async () => {
  // listManagerCounterparties is exercised via DB; here mock prisma minimal for scope check.
  const session = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1'] } as never;
  const res = await createManagerOrderLessDocument(prismaMock, session, {
    counterparty: { type: 'organization', id: 'o1' },
    docType: 'other',
    file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
  });
  expect(res).toEqual({ ok: true, documentId: expect.any(String) });
  const persistArg = persistSpy.mock.calls[0][0];
  expect(persistArg.orderId).toBeNull();
  expect(persistArg.companyId).toBe('co-1');
  expect(persistArg.direction).toBe('outgoing');
});

it('order-less: rejects counterparty outside manager scope', async () => {
  const session = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1'] } as never;
  const res = await createManagerOrderLessDocument(prismaMock, session, {
    counterparty: { type: 'organization', id: 'oX' },
    docType: 'other',
    file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
  });
  expect(res).toEqual({ ok: false, error: 'forbidden' });
});
```
(Adapt `prismaMock`/`persistSpy` and mock `listManagerCounterparties` to return `{ organizations:[{id:'o1',name:'O'}], partners:[] }` via `vi.mock`/`vi.hoisted`, per the file's existing pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- services.manager.uploads`
Expected: FAIL — `createManagerOrderLessDocument` not exported.

- [ ] **Step 3: Implement in `src/lib/services/manager/uploads.ts`**

Add imports at the top:
```ts
import { canManagerUploadOrderLess } from '@/lib/auth/documentChannelPolicy';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { notifyManagers } from '@/lib/notifications'; // already imported notifyOrgUsers/notifyPartnerUsers
```
Append:
```ts
export type CreateManagerOrderLessArgs = {
  counterparty: { type: DocumentRecipient; id: string };
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export async function createManagerOrderLessDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateManagerOrderLessArgs
): Promise<CreateCounterpartyDocumentResult> {
  const fileCheck = validateUploadFile(args.file);
  if (!fileCheck.ok) return fileCheck;
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const { organizations, partners } = await listManagerCounterparties(prisma, session);
  const scope = {
    managedOrgIds: organizations.map((o) => o.id),
    partnerIds: partners.map((p) => p.id)
  };
  if (!canManagerUploadOrderLess(args.counterparty, scope)) {
    return { ok: false, error: 'forbidden' };
  }

  const persisted = await persistUploadedDocument(prisma, {
    counterparty: args.counterparty,
    orderId: null,
    companyId: session.companyId,
    direction: 'outgoing',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'manager',
    file: args.file
  });
  if (!persisted.ok) return persisted;

  // Best-effort fan-out to the chosen channel only (never roll back upload).
  try {
    if (args.counterparty.type === 'organization') {
      await notifyOrgUsers(prisma, {
        organizationId: args.counterparty.id,
        type: 'document_published',
        payload: { orderId: null, orderNumber: null, orderTitle: null, documentName: args.file.name, documentType: args.docType }
      });
    } else {
      await notifyPartnerUsers(prisma, {
        partnerId: args.counterparty.id,
        type: 'document_published',
        payload: { orderId: null, orderNumber: null, orderTitle: null, documentName: args.file.name, documentType: args.docType }
      });
    }
  } catch (err) {
    console.warn('[manager/uploads] order-less notify failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
```
Note: `notifyOrgUsers`/`notifyPartnerUsers` payloads must accept `orderId/orderNumber/orderTitle` as nullable. Verify their input types in `src/lib/notifications/org.ts` / `partner.ts`; if they hardcode non-null, widen them to `string | null` in this task (small edit, no behavior change for order-bound calls).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- services.manager.uploads`
Expected: PASS.

- [ ] **Step 5: Run typecheck (notify payload widening)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/manager/uploads.ts src/lib/notifications src/__tests__/services.manager.uploads.test.ts
git commit -m "feat(docs): manager order-less upload service (scoped counterparty, company-pinned)"
```

---

## Task 8: Org order-less server-action branch + company-scoped manager notify

**Files:**
- Modify: `src/lib/notifications/manager.ts` (add `notifyManagersOrderLess` + company recipient resolver)
- Modify: `src/server-actions/organization/documents.ts` (orderId optional → order-less branch)
- Test: `src/__tests__/notifications.manager.order-less.test.ts` (integration), `src/__tests__/server-actions.organization.documents.test.ts` (existing — extend)

- [ ] **Step 1: Write failing test for company recipient resolver**

Create `src/__tests__/notifications.manager.order-less.test.ts` (integration):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveCompanyManagerRecipients } from '@/lib/notifications/manager';

let prisma: PrismaClient;
let companyId: string, orgId: string, mgrId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  const c = await prisma.company.create({ data: { name: `NMC-${s}` } });
  companyId = c.id;
  const org = await prisma.organization.create({ data: { name: `NMO-${s}`, companyId } });
  orgId = org.id;
  const m = await prisma.user.create({ data: { email: `nm-${s}@x.io`, role: 'manager', companyId, isActive: true } });
  mgrId = m.id;
  await prisma.organizationManager.create({ data: { organizationId: orgId, userId: mgrId, isActive: true } });
});
afterAll(async () => {
  await prisma.organizationManager.deleteMany({ where: { userId: mgrId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: mgrId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('resolveCompanyManagerRecipients', () => {
  it('returns active managers assigned to orgs in the company', async () => {
    const recips = await resolveCompanyManagerRecipients(prisma, orgId);
    expect(recips.map((r) => r.id)).toContain(mgrId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- notifications.manager.order-less`
Expected: FAIL — `resolveCompanyManagerRecipients` not exported.

- [ ] **Step 3: Implement company recipient resolver + order-less notify in `src/lib/notifications/manager.ts`**

Add after `resolveManagerRecipients` (155):
```ts
/**
 * Recipients for an order-less org→managers upload. No order exists, so the
 * order-centric `resolveManagerRecipients` cannot apply — we target the active
 * OrganizationManager set for the organization (the per-org branch (b), which
 * needs no order). Company-level by construction (org belongs to one company).
 */
export async function resolveCompanyManagerRecipients(
  db: PrismaClient,
  organizationId: string,
  opts?: NotifyManagersOptions
): Promise<ManagerRecipient[]> {
  const assigned = await db.organizationManager.findMany({
    where: { organizationId, isActive: true },
    select: { userId: true }
  });
  const ids = new Set(assigned.map((a) => a.userId));
  if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
  if (ids.size === 0) return [];
  return db.user.findMany({
    where: { id: { in: Array.from(ids) }, role: 'manager', isActive: true },
    select: { id: true, email: true, name: true }
  });
}
```
Add a thin order-less notify that reuses the `document_uploaded_by_org` template with an order-less context (no orderUrl to a specific order — link to `/manager/documents`):
```ts
export async function notifyManagersOrderLess(
  db: PrismaClient,
  input: {
    organizationId: string;
    orgName: string;
    documentName: string;
    documentType: string;
  },
  opts?: NotifyManagersOptions
): Promise<NotifyManagersSummary> {
  const recipients = await resolveCompanyManagerRecipients(db, input.organizationId, opts);
  if (recipients.length === 0) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const props = {
    orgName: input.orgName,
    orderNumber: 'Общий документ',
    documentName: input.documentName,
    documentType: input.documentType,
    orderUrl: `${getAppBaseUrl()}/manager/documents`
  };
  const subject = managerDocumentUploadedByOrgSubject(props);
  const shortBody = managerDocumentUploadedByOrgText(props);
  const meta = { ...input, orderId: null } as Prisma.InputJsonValue;

  let emailsSent = 0, emailsSkipped = 0, recipientsNotified = 0;
  for (const r of recipients) {
    await db.notification.create({
      data: { userId: r.id, type: 'document_uploaded_by_org', title: subject, body: shortBody, meta }
    });
    recipientsNotified += 1;
    if (r.email) {
      try {
        const result = await sendManagerDocumentUploadedByOrgEmail({ to: r.email, ...props });
        result.status === 'sent' ? (emailsSent += 1) : (emailsSkipped += 1);
      } catch { emailsSkipped += 1; }
    } else emailsSkipped += 1;
  }
  return { recipientsNotified, emailsSent, emailsSkipped };
}
```

- [ ] **Step 4: Run resolver test**

Run: `npm run test:integration -- notifications.manager.order-less`
Expected: PASS.

- [ ] **Step 5: Add order-less branch to `uploadOrganizationDocument`**

In `src/server-actions/organization/documents.ts`: make `orderId` optional and branch. Change the schema (14-18):
```ts
const schema = z.object({
  organizationId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  docType: z.string().min(1)
});
```
After the membership check (39) and BEFORE the order lookup, branch on order-less:
```ts
  // Order-less «общие документы»: anchor to the org's company, notify company managers.
  if (!parsed.data.orderId) {
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { name: true, companyId: true }
    });
    if (!org?.companyId) return { ok: false, error: 'not_found' };

    const buffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedDocument(prisma, {
      counterparty: { type: 'organization', id: parsed.data.organizationId },
      orderId: null,
      companyId: org.companyId,
      direction: 'incoming',
      docType: parsed.data.docType,
      uploadedById: session.sub,
      source: 'organization',
      file: { name: file.name, size: file.size, mimeType: file.type, buffer }
    });
    if (!persisted.ok) return persisted;

    try {
      await notifyManagersOrderLess(prisma, {
        organizationId: parsed.data.organizationId,
        orgName: org.name,
        documentName: file.name,
        documentType: parsed.data.docType
      });
    } catch (err) {
      console.warn('[uploadOrganizationDocument] order-less notify failed', {
        documentId: persisted.documentId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    revalidatePath('/organization/documents');
    return { ok: true, documentId: persisted.documentId };
  }
```
Update the import (7): `import { notifyManagers, notifyManagersOrderLess } from '@/lib/notifications';` (ensure barrel re-exports `notifyManagersOrderLess` — add `export` if `notifications/index.ts` uses an explicit list). The existing order-bound path (42-80) stays unchanged below this branch.

- [ ] **Step 6: Extend the server-action test**

Add to `src/__tests__/server-actions.organization.documents.test.ts` (follow its mock pattern; assert the order-less FormData path persists with `orderId:null`, `companyId` set, and calls `notifyManagersOrderLess`).
```ts
it('order-less upload (no orderId) anchors to org company and notifies company managers', async () => {
  // build FormData without 'orderId'; mock org.findUnique → { name, companyId:'co-1' }
  const fd = makeFormData({ organizationId: 'org-1', docType: 'other' /* no orderId */ });
  const res = await uploadOrganizationDocument(fd);
  expect(res.ok).toBe(true);
  expect(persistSpy.mock.calls[0][0]).toMatchObject({ orderId: null, companyId: 'co-1', direction: 'incoming' });
  expect(notifyOrderLessSpy).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test:unit -- server-actions.organization.documents` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/manager.ts src/lib/notifications/index.ts src/server-actions/organization/documents.ts src/__tests__/notifications.manager.order-less.test.ts src/__tests__/server-actions.organization.documents.test.ts
git commit -m "feat(docs): org order-less upload + company-scoped manager notify"
```

---

## Task 9: Manager order-less upload API route

**Files:**
- Create: `src/app/api/manager/documents/order-less/route.ts`
- Test: `src/__tests__/api.manager.documents.order-less.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/api.manager.documents.order-less.test.ts` (mirror `api.manager.documents.upload.test.ts` mock style — `vi.hoisted` + `vi.mock` for `requireManager`, `createManagerOrderLessDocument`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager, createManagerOrderLessDocument } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  createManagerOrderLessDocument: vi.fn()
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/uploads', () => ({ createManagerOrderLessDocument }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/manager/documents/order-less/route';

function form(fields: Record<string, string>, withFile = true) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (withFile) fd.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'g.pdf', { type: 'application/pdf' }));
  return { formData: async () => fd } as unknown as Request;
}

beforeEach(() => { vi.clearAllMocks(); requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'co-1' }); });

describe('POST /api/manager/documents/order-less', () => {
  it('maps forbidden → 403', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' }));
    expect(res.status).toBe(403);
  });
  it('200 with documentId on success', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentId: 'd1' });
  });
  it('400 on missing file', async () => {
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' }, false));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- api.manager.documents.order-less`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `src/app/api/manager/documents/order-less/route.ts`**

Use the existing manager upload route as the thin-route template (CLAUDE.md §3 — route only maps codes to status):
```ts
import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createManagerOrderLessDocument } from '@/lib/services/manager/uploads';

const STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, invalid_recipient: 422,
  too_large: 413, invalid_mime: 415, storage: 502
};

export async function POST(req: Request) {
  const session = await requireManager();
  const fd = await req.formData();
  const counterpartyType = String(fd.get('counterpartyType') ?? '');
  const counterpartyId = String(fd.get('counterpartyId') ?? '');
  const docType = String(fd.get('docType') ?? 'other');
  const file = fd.get('file');

  if ((counterpartyType !== 'organization' && counterpartyType !== 'partner') || !counterpartyId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await createManagerOrderLessDocument(prisma, session, {
    counterparty: { type: counterpartyType, id: counterpartyId },
    docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  }
  return NextResponse.json({ documentId: result.documentId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- api.manager.documents.order-less`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/manager/documents/order-less/route.ts src/__tests__/api.manager.documents.order-less.test.ts
git commit -m "feat(docs): manager order-less upload API route (thin, maps Result codes)"
```

---

## Task 10: Order-less read services (org / partner / manager / admin lists)

**Files:**
- Modify: `src/lib/services/organization/documents.ts` (add `orderLess` option to `ListOrgDocumentsOptions`)
- Modify: `src/lib/services/partner/documentsList.ts` (add `orderLess` filter)
- Modify: `src/lib/services/manager/documents.ts` (add `listManagerOrderLessDocuments`)
- Test: `src/__tests__/services.organization.documents.test.ts`, `src/__tests__/services.manager.documents.test.ts` (existing — extend)

- [ ] **Step 1: Write failing tests (org order-bound/order-less split)**

Add to `src/__tests__/services.organization.documents.test.ts` (integration — seed one order-bound + one order-less org doc for the same org, assert each list returns only its kind):
```ts
it('orderLess=true returns only order-less docs; default returns only order-bound', async () => {
  const bound = await listOrgDocuments(prisma, { organizationId: orgId });
  const less = await listOrgDocuments(prisma, { organizationId: orgId, orderLess: true });
  expect(bound.rows.every((r) => r.orderId !== null)).toBe(true);
  expect(less.rows.every((r) => r.orderId === null)).toBe(true);
});
```
(Seed an order-less doc in `beforeAll`: `prisma.document.create({ data: { name:'gen.pdf', path:'fake://gen', mimeType:'application/pdf', type:'other', counterpartyType:'organization', counterpartyId: orgId, companyId } })`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- services.organization.documents`
Expected: FAIL — `orderLess` option ignored (both lists identical).

- [ ] **Step 3: Implement org `orderLess` option**

In `src/lib/services/organization/documents.ts`: add `orderLess?: boolean` to `ListOrgDocumentsOptions`, and compose into `baseWhere` (67-72) using the policy axis:
```ts
import { organizationChannelWhere, documentInChannel, orderBoundWhere, orderLessWhere } from '@/lib/auth/documentChannelPolicy';
// ...
  const baseWhere: Prisma.DocumentWhereInput = {
    ...organizationChannelWhere(opts.organizationId),
    ...(opts.orderLess ? orderLessWhere() : orderBoundWhere()),
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
    ...dateFilter,
    ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' as const } } : {})
  };
```

- [ ] **Step 4: Implement partner `orderLess` filter**

In `src/lib/services/partner/documentsList.ts`: add `orderLess?: boolean` to its options and compose `orderLessWhere()`/`orderBoundWhere()` into the where, same as Step 3 (partner channel already pinned). Default (no flag) = order-bound.

- [ ] **Step 5: Implement `listManagerOrderLessDocuments`**

In `src/lib/services/manager/documents.ts`, append:
```ts
import { managerOrderLessWhere } from '@/lib/auth/documentChannelPolicy';

export type ManagerOrderLessRow = {
  id: string; name: string; type: DocumentType; direction: DocumentDirection;
  signedAt: Date | null; createdAt: Date; size: number | null;
  counterpartyType: 'organization' | 'partner'; counterpartyId: string;
};

export async function listManagerOrderLessDocuments(
  prisma: PrismaClient,
  session: SessionPayload,
  opts?: { type?: DocumentType; take?: number; cursor?: string }
): Promise<{ rows: ManagerOrderLessRow[]; nextCursor: string | null }> {
  if (!session.companyId) return { rows: [], nextCursor: null };
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const where: Prisma.DocumentWhereInput = {
    ...managerOrderLessWhere(session.companyId),
    ...(opts?.type ? { type: opts.type } : {})
  };
  const rows = await prisma.document.findMany({
    where,
    orderBy: { id: 'desc' },
    take: take + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, name: true, type: true, direction: true, signedAt: true,
      createdAt: true, size: true, counterpartyType: true, counterpartyId: true
    }
  });
  const hasMore = rows.length > take;
  const sliced = hasMore ? rows.slice(0, take) : rows;
  return {
    rows: sliced as ManagerOrderLessRow[],
    nextCursor: hasMore ? sliced[sliced.length - 1]!.id : null
  };
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test:integration -- services.organization.documents` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/organization/documents.ts src/lib/services/partner/documentsList.ts src/lib/services/manager/documents.ts src/__tests__/services.organization.documents.test.ts
git commit -m "feat(docs): order-less read services (org/partner/manager lists)"
```

---

## Task 11: Download guards — order-less authorization branch

**Files:**
- Modify: `src/lib/auth/policy.ts` (`canReadDocument` 84-117)
- Modify: `src/app/api/documents/[id]/download/route.ts` (select 25-28)
- Modify: `src/lib/services/manager/documents.ts` (`getDocumentForDownload` 83-138)
- Modify: `src/lib/services/organization/documents.ts` (`getOrgDocumentForDownload` 131-167 — already channel-checks; confirm order-less docs pass)
- Test: `src/__tests__/auth.policy.document-channel.test.ts` (existing — extend), `src/__tests__/services.manager.documents.test.ts`

- [ ] **Step 1: Write failing tests for `canReadDocument` order-less**

Add to `src/__tests__/auth.policy.document-channel.test.ts` (follow its mock pattern for `prisma.document.findUnique`):
```ts
it('manager downloads order-less doc only in same company', async () => {
  mockDoc({ id: 'd1', orderId: null, companyId: 'co-1', counterpartyType: 'partner', counterpartyId: 'p1', order: null });
  expect(await canReadDocument({ role: 'manager', companyId: 'co-1' } as never, { id: 'd1' } as never)).toBe(true);
  expect(await canReadDocument({ role: 'manager', companyId: 'co-2' } as never, { id: 'd1' } as never)).toBe(false);
});
it('partner downloads order-less doc only in its channel', async () => {
  mockDoc({ id: 'd2', orderId: null, companyId: 'co-1', counterpartyType: 'partner', counterpartyId: 'p1', order: null });
  expect(await canReadDocument({ role: 'partner', partnerId: 'p1' } as never, { id: 'd2' } as never)).toBe(true);
  expect(await canReadDocument({ role: 'partner', partnerId: 'pX' } as never, { id: 'd2' } as never)).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- auth.policy.document-channel`
Expected: FAIL — current `canReadDocument` bails on `!doc?.order?.companyId` (order-less has null order).

- [ ] **Step 3: Rewrite `canReadDocument` to branch on order-less**

In `src/lib/auth/policy.ts`, replace the body (84-117). Import the gate:
```ts
import { canReadOrderLessDocument } from '@/lib/auth/documentChannelPolicy';
```
New body:
```ts
export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  // Re-fetch unless the caller already provided every field both branches need.
  const haveAll =
    document.counterpartyType && document.counterpartyId &&
    (document.order?.companyId || document.companyId || document.orderId === null);
  const doc = haveAll
    ? document
    : await prisma.document.findUnique({
        where: { id: document.id },
        select: {
          id: true, orderId: true, companyId: true,
          counterpartyType: true, counterpartyId: true,
          order: { select: { companyId: true } }
        }
      });
  if (!doc || !doc.counterpartyType || !doc.counterpartyId) return false;

  // Order-less branch: order is null, company anchor lives on the doc.
  if (doc.orderId === null) {
    return canReadOrderLessDocument(session, {
      counterpartyType: doc.counterpartyType,
      counterpartyId: doc.counterpartyId,
      companyId: doc.companyId ?? null
    });
  }

  // Order-bound branch (unchanged from Phase A).
  if (!doc.order?.companyId) return false;
  if (session.role === 'partner') {
    if (doc.counterpartyType !== 'partner' || doc.counterpartyId !== session.partnerId) return false;
  } else if (session.role === 'organization') {
    if (doc.counterpartyType !== 'organization') return false;
  }
  return canReadOrder(session, { id: doc.orderId, companyId: doc.order.companyId });
}
```

- [ ] **Step 4: Widen the generic download route select**

In `src/app/api/documents/[id]/download/route.ts` (25-28), include the order-less fields so `canReadDocument` short-circuits without a re-fetch:
```ts
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true, path: true, name: true, scanStatus: true, scanReason: true,
      orderId: true, companyId: true, counterpartyType: true, counterpartyId: true,
      order: { select: { companyId: true } }
    }
  });
```
(`doc.scanStatus`/`doc.path`/`doc.name` are already used below — keep them.)

- [ ] **Step 5: Add order-less branch to manager `getDocumentForDownload`**

In `src/lib/services/manager/documents.ts` (83-138), add `companyId`, `counterpartyType`, `counterpartyId`, and nullable `order` to the select, then branch before the order-centric scope check:
```ts
import { canReadOrderLessDocument } from '@/lib/auth/documentChannelPolicy';
// ... in the select add:
//   orderId: true, companyId: true, counterpartyType: true, counterpartyId: true,
//   order: { select: { managerId: true, organizationId: true, companyId: true } }
  if (!doc) return { ok: false, error: 'not_found' };

  if (doc.orderId === null) {
    if (!canReadOrderLessDocument(session, {
      counterpartyType: doc.counterpartyType,
      counterpartyId: doc.counterpartyId,
      companyId: doc.companyId ?? null
    })) {
      return { ok: false, error: 'not_found' };
    }
    if (doc.scanStatus === 'infected') return { ok: false, error: 'infected', scanReason: doc.scanReason ?? null };
    return { ok: true, path: doc.path, mimeType: doc.mimeType, name: doc.name };
  }
  // existing order-bound scope check below, guarded by doc.order (now nullable → use doc.order!.X
  // is unsafe; instead early-returned above so order is present here — use a local const):
  const ord = doc.order!;
```
Then replace the subsequent `doc.order.managerId`/`doc.order.organizationId`/`{ ...doc.order, ... }` references with `ord.managerId`/`ord.organizationId`/`{ ...ord, commentsCountByMe }`.

- [ ] **Step 6: Confirm `getOrgDocumentForDownload` handles order-less**

`src/lib/services/organization/documents.ts:131-167` already gates by `documentInChannel(doc, { type:'organization', id: organizationId })` — order-less org docs carry `counterpartyType:'organization'`, `counterpartyId: orgId`, so they pass for the owning org and `not_found` for others. No code change needed; add a regression test asserting an org downloads its own order-less doc and not another org's:
```ts
it('org downloads its own order-less doc, not another org channel', async () => {
  const ok = await getOrgDocumentForDownload(prisma, orgId, orderLessOrgDocId);
  expect(ok.ok).toBe(true);
  const denied = await getOrgDocumentForDownload(prisma, otherOrgId, orderLessOrgDocId);
  expect(denied).toEqual({ ok: false, error: 'not_found' });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test:unit -- auth.policy.document-channel` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/policy.ts src/app/api/documents/[id]/download/route.ts src/lib/services/manager/documents.ts src/lib/services/organization/documents.ts src/__tests__/auth.policy.document-channel.test.ts
git commit -m "feat(docs): order-less download authorization across all guards"
```

---

## Task 12: UI — documents-list order-less label

**Files:**
- Modify: `src/components/partner/documents-list.tsx` (115-117)
- Test: `src/__tests__/components.documents-list.test.tsx` (create)

- [ ] **Step 1: Write failing test**

Create `src/__tests__/components.documents-list.test.tsx`:
```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DocumentsList } from '@/components/partner/documents-list';

const base = { id: 'd1', name: 'gen.pdf', type: 'other' as const, direction: 'outgoing' as const,
  signedAt: null, createdAt: new Date('2026-06-01'), size: 100 };

describe('DocumentsList order-less label', () => {
  it('shows «Общий документ» when order fields are null', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: null, orderNumber: null, orderTitle: null }] as never} />);
    expect(html).toContain('Общий документ');
  });
  it('shows order reference for order-bound docs', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: 'o1', orderNumber: '№42', orderTitle: 'T' }] as never} />);
    expect(html).toContain('№42');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- components.documents-list`
Expected: FAIL — current code renders `doc.orderNumber ?? doc.orderTitle` → `null ?? null` → empty.

- [ ] **Step 3: Implement order-less label in `documents-list.tsx` (115-117)**

```tsx
              <div className='text-xs text-gray-400 mt-0.5 truncate'>
                {doc.orderNumber ?? doc.orderTitle ?? 'Общий документ'}
              </div>
```
(Replace the `Сделка: {doc.orderNumber ?? doc.orderTitle}` line; for order-bound keep the order ref, for order-less show «Общий документ».)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- components.documents-list`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/documents-list.tsx src/__tests__/components.documents-list.test.tsx
git commit -m "feat(docs): order-less label «Общий документ» in documents list"
```

---

## Task 13: UI — org «Общие документы» tab + order-less upload form

**Files:**
- Create: `src/components/organization/organization-order-less-upload-form.tsx`
- Modify: `src/app/organization/documents/page.tsx` (tabs)
- Test: visual/manual (no unit assertion beyond the form rendering with React import)

- [ ] **Step 1: Create the order-less upload form**

`src/components/organization/organization-order-less-upload-form.tsx` — inline card form (sibling of the existing org order-bound upload; CLAUDE.md §9 a11y: `role="status"`/`role="alert"` for messages). It posts to `uploadOrganizationDocument` (server action) WITHOUT `orderId`:
```tsx
'use client';
import React, { useState } from 'react';
import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

const DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' }, { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' }, { value: 'other', label: 'Прочее' }
];

export function OrganizationOrderLessUploadForm({ organizationId }: { organizationId: string }) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function action(formData: FormData) {
    setBusy(true); setMsg(null);
    formData.set('organizationId', organizationId); // no orderId → order-less branch
    const res = await uploadOrganizationDocument(formData);
    setBusy(false);
    setMsg(res.ok ? { kind: 'ok', text: 'Документ загружен' } : { kind: 'err', text: `Ошибка: ${res.error}` });
  }

  return (
    <form action={action} className='bg-white border border-gray-200 rounded-xl p-4 space-y-3'>
      <div className='font-medium text-[#111111] text-sm'>Загрузить общий документ</div>
      <select name='docType' className='border border-gray-200 rounded px-2 py-1 text-sm w-full' defaultValue='other'>
        {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input type='file' name='file' required className='block w-full text-sm' />
      <p className='text-xs text-gray-400'>PDF, JPG, PNG, DOCX, XLSX · до 20 МБ</p>
      <button type='submit' disabled={busy} className='px-3 py-1.5 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C] disabled:opacity-50'>
        {busy ? 'Загрузка…' : 'Загрузить'}
      </button>
      {msg && (
        <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-700' : 'text-green-700'}`}>
          {msg.text}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Add the tab switch to `organization/documents/page.tsx`**

Add a `tab` search param (`'orders' | 'general'`, default `'orders'`). When `tab==='general'`, call `listOrgDocuments(prisma, { organizationId: ctx.activeOrgId, orderLess: true, ... })` and render `<OrganizationOrderLessUploadForm organizationId={ctx.activeOrgId} />` above the list. Add two `<Link>` tab chips:
```tsx
// in SearchParams type add: tab?: string;
const tab = sp.tab === 'general' ? 'general' : 'orders';
const { rows, total, countsByType } = await listOrgDocuments(prisma, {
  organizationId: ctx.activeOrgId, orderLess: tab === 'general',
  type: typeFilter, search: sp.search, take, skip
});
// tab chips (place above <TypeFilter>):
<nav className='flex gap-2'>
  <Link href={`/organization/documents${sp.org ? `?org=${sp.org}` : ''}`}
    className={`px-3 py-1.5 text-sm rounded-full border ${tab==='orders'?'bg-[#F97316] text-white border-[#F97316]':'bg-white border-gray-200'}`}>По заказам</Link>
  <Link href={`/organization/documents?tab=general${sp.org ? `&org=${sp.org}` : ''}`}
    className={`px-3 py-1.5 text-sm rounded-full border ${tab==='general'?'bg-[#F97316] text-white border-[#F97316]':'bg-white border-gray-200'}`}>Общие документы</Link>
</nav>
{tab === 'general' && <OrganizationOrderLessUploadForm organizationId={ctx.activeOrgId} />}
```
Import the form: `import { OrganizationOrderLessUploadForm } from '@/components/organization/organization-order-less-upload-form';`

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/organization/organization-order-less-upload-form.tsx src/app/organization/documents/page.tsx
git commit -m "feat(docs): org «Общие документы» tab + order-less upload"
```

---

## Task 14: UI — partner «Общие документы» tab (read-only)

**Files:**
- Modify: `src/app/partner/documents/page.tsx` (tabs; order-less list read-only — NO upload)
- Modify: `src/lib/services/partner/documentsList.ts` (consumed via `orderLess` from Task 10)

- [ ] **Step 1: Add the tab switch to `partner/documents/page.tsx`**

Mirror Task 13's tab chips (`По заказам` / `Общие документы`) but with NO upload form (partner order-less is outgoing-only — read-only inbox). When `tab==='general'`, pass `orderLess: true` to `listPartnerDocuments`:
```tsx
const tab = sp.tab === 'general' ? 'general' : 'orders';
const { rows, total, countsByType } = await listPartnerDocuments(prisma, {
  partnerId: session.partnerId, scopeOrgIds: scope, orderLess: tab === 'general',
  type: typeFilter, search: sp.search, take, skip
});
// tab chips above <TypeFilter>:
<nav className='flex gap-2'>
  <Link href='/partner/documents' className={`px-3 py-1.5 text-sm rounded-full border ${tab==='orders'?'bg-[#F97316] text-white border-[#F97316]':'bg-white border-gray-200'}`}>По заказам</Link>
  <Link href='/partner/documents?tab=general' className={`px-3 py-1.5 text-sm rounded-full border ${tab==='general'?'bg-[#F97316] text-white border-[#F97316]':'bg-white border-gray-200'}`}>Общие документы</Link>
</nav>
```
(`sp` type already widens with `tab?: string` — add it to the `searchParams` shape.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/partner/documents/page.tsx
git commit -m "feat(docs): partner «Общие документы» read-only tab"
```

---

## Task 15: UI — manager + admin order-less section with counterparty picker

**Files:**
- Create: `src/components/manager/manager-order-less-upload-form.tsx`
- Modify: `src/app/manager/documents/page.tsx` (order-less section)
- Modify: `src/app/admin/documents/page.tsx` (order-less section, read-only or admin upload — read-only for this plan)

- [ ] **Step 1: Create the manager order-less upload form (counterparty picker)**

`src/components/manager/manager-order-less-upload-form.tsx` — posts to `/api/manager/documents/order-less`:
```tsx
'use client';
import React, { useState } from 'react';

type Option = { id: string; name: string };
const DOC_TYPES = [
  { value: 'contract', label: 'Договор' }, { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' }, { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' }
];

export function ManagerOrderLessUploadForm({ organizations, partners }: { organizations: Option[]; partners: Option[] }) {
  const [type, setType] = useState<'organization' | 'partner'>('organization');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = type === 'organization' ? organizations : partners;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/manager/documents/order-less', { method: 'POST', body: fd });
    setBusy(false);
    setMsg(res.ok ? { kind: 'ok', text: 'Документ загружен' } : { kind: 'err', text: 'Не удалось загрузить' });
    if (res.ok) e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className='bg-white border border-gray-200 rounded-xl p-4 space-y-3'>
      <div className='font-medium text-[#111111] text-sm'>Загрузить общий документ</div>
      <div className='flex gap-2'>
        <select name='counterpartyType' value={type} onChange={(e) => setType(e.target.value as 'organization' | 'partner')}
          className='border border-gray-200 rounded px-2 py-1 text-sm'>
          <option value='organization'>Организация</option>
          <option value='partner'>Партнёр</option>
        </select>
        <select name='counterpartyId' required className='border border-gray-200 rounded px-2 py-1 text-sm flex-1'>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <select name='docType' defaultValue='other' className='border border-gray-200 rounded px-2 py-1 text-sm w-full'>
        {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input type='file' name='file' required className='block w-full text-sm' />
      <p className='text-xs text-gray-400'>PDF, JPG, PNG, DOCX, XLSX · до 20 МБ</p>
      <button type='submit' disabled={busy} className='px-3 py-1.5 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C] disabled:opacity-50'>
        {busy ? 'Загрузка…' : 'Загрузить'}
      </button>
      {msg && <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</div>}
    </form>
  );
}
```

- [ ] **Step 2: Add order-less section to `manager/documents/page.tsx`**

Add a `tab` param (`'orders' | 'general'`). For `general`: fetch `listManagerOrderLessDocuments(prisma, session)` + `listManagerCounterparties(prisma, session)`, render the picker form + an order-less list. Map order-less rows to `OrgDocumentRow` shape with null order fields:
```tsx
import { listManagerOrderLessDocuments } from '@/lib/services/manager/documents';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { ManagerOrderLessUploadForm } from '@/components/manager/manager-order-less-upload-form';
// ...
const tab = sp.tab === 'general' ? 'general' : 'orders';
if (tab === 'general') {
  const [{ rows }, cps] = await Promise.all([
    listManagerOrderLessDocuments(prisma, session),
    listManagerCounterparties(prisma, session)
  ]);
  const documentRows: OrgDocumentRow[] = rows.map((d) => ({
    id: d.id, name: d.name, type: d.type, direction: d.direction, signedAt: d.signedAt,
    createdAt: d.createdAt, size: d.size, orderId: null, orderNumber: null, orderTitle: null
  }));
  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Документы</h1>
      <TabChips tab='general' />
      <ManagerOrderLessUploadForm organizations={cps.organizations} partners={cps.partners} />
      <DocumentsList rows={documentRows} downloadEndpointBase='/api/manager/documents' />
    </div>
  );
}
```
Add a small `TabChips` helper (two `<Link>`s: `/manager/documents` and `/manager/documents?tab=general`) and render it in the order-bound branch too.

- [ ] **Step 3: Add a read-only order-less section to `admin/documents/page.tsx`**

Admin sees all (Model A). Add a `tab=general` view that lists order-less docs unscoped (`prisma.document.findMany({ where: { orderId: null }, ... })`) reusing `DocumentsList` with null order fields and `downloadEndpointBase='/api/documents'`. No upload form for admin in this plan (admin order-less creation is out of scope — managers/orgs create; admin reviews). Mirror the existing admin/documents page structure.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/manager/manager-order-less-upload-form.tsx src/app/manager/documents/page.tsx src/app/admin/documents/page.tsx
git commit -m "feat(docs): manager+admin order-less section with counterparty picker"
```

---

## Task 16: Update existing test seeds for nullable orderId / companyId

**Files (each constructs Document rows and must keep passing under the XOR CHECK — order-bound docs need `orderId` set, `companyId` absent; that is already true, so most need NO change, but the integration seeds run against the migrated DB and must be re-verified):**
- `src/__tests__/services.document-channel-isolation.test.ts`
- `src/__tests__/services.manager.dashboard.test.ts`, `services.manager.orders.test.ts`, `services.manager.documents.test.ts`
- `src/__tests__/services.organization.dashboard.test.ts`, `services.organization.documents.test.ts`, `services.organization.orders.test.ts`
- `src/__tests__/services.partner.documents.test.ts`
- `src/__tests__/worker.notification-hooks.test.ts`

- [ ] **Step 1: Run the full integration suite against the migrated DB**

Run: `npm run test:integration`
Expected: existing Document-creating tests still PASS — they all set `orderId` and omit `companyId`, satisfying the XOR CHECK. Note any failures (e.g. a seed that relied on a now-removed default).

- [ ] **Step 2: Fix only the seeds that fail**

For any failing seed, ensure order-bound creates set `orderId` and DO NOT set `companyId` (XOR). No bulk edit — touch only what the run flags. (Expected: zero or near-zero changes; this task is a verification gate, not a rewrite.)

- [ ] **Step 3: Commit (if any changes)**

```bash
git add src/__tests__
git commit -m "test(docs): verify document seeds under nullable-orderId XOR constraint"
```

---

## Task 17: Integration — company-isolation invariant (linchpin) + order-less e2e

**Files:**
- Create: `src/__tests__/services.order-less-isolation.test.ts` (integration — the Phase B linchpin, mirroring `services.document-channel-isolation.test.ts`)

- [ ] **Step 1: Write the invariant test**

Create `src/__tests__/services.order-less-isolation.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getDocumentForDownload } from '@/lib/services/manager/documents';
import { listManagerOrderLessDocuments } from '@/lib/services/manager/documents';

let prisma: PrismaClient;
let companyA: string, companyB: string, partnerId: string, orgA: string;
let orderLessDocId: string, mgrA: string, mgrB: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  companyA = (await prisma.company.create({ data: { name: `OLA-${s}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `OLB-${s}` } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `OLP-${s}`, commissionRate: 0 } })).id;
  orgA = (await prisma.organization.create({ data: { name: `OLO-${s}`, companyId: companyA, partnerId } })).id;
  mgrA = (await prisma.user.create({ data: { email: `ola-${s}@x.io`, role: 'manager', companyId: companyA, isActive: true } })).id;
  mgrB = (await prisma.user.create({ data: { email: `olb-${s}@x.io`, role: 'manager', companyId: companyB, isActive: true } })).id;
  // order-less partner doc anchored to company A
  orderLessDocId = (await prisma.document.create({
    data: { name: 'general.pdf', path: 'fake://ol', mimeType: 'application/pdf', type: 'other',
      counterpartyType: 'partner', counterpartyId: partnerId, companyId: companyA }
  })).id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: orderLessDocId } });
  await prisma.user.deleteMany({ where: { id: { in: [mgrA, mgrB] } } });
  await prisma.organization.delete({ where: { id: orgA } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('order-less company isolation (Phase B linchpin)', () => {
  it('manager of company A sees + downloads the order-less doc', async () => {
    const sessionA = { sub: mgrA, role: 'manager', companyId: companyA } as never;
    const { rows } = await listManagerOrderLessDocuments(prisma, sessionA);
    expect(rows.map((r) => r.id)).toContain(orderLessDocId);
    const dl = await getDocumentForDownload(prisma, sessionA, orderLessDocId);
    expect(dl.ok).toBe(true);
  });
  it('manager of company B neither sees nor downloads it', async () => {
    const sessionB = { sub: mgrB, role: 'manager', companyId: companyB } as never;
    const { rows } = await listManagerOrderLessDocuments(prisma, sessionB);
    expect(rows.map((r) => r.id)).not.toContain(orderLessDocId);
    const dl = await getDocumentForDownload(prisma, sessionB, orderLessDocId);
    expect(dl).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: Run the invariant test**

Run: `npm run test:integration -- services.order-less-isolation`
Expected: PASS — company B manager is fully isolated from company A's order-less doc (list + download).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.order-less-isolation.test.ts
git commit -m "test(docs): order-less company-isolation invariant (manager A vs B)"
```

---

## Task 18: Full verification gate

- [ ] **Step 1: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: PASS (all ~1300 unit tests).

- [ ] **Step 3: Full integration suite (live Postgres)**

Run: `npm run test:integration`
Expected: PASS including the two isolation invariants (Phase A channel + Phase B company) and the XOR schema test.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (catches slug/route conflicts that `next dev` would surface).

- [ ] **Step 5: Manual smoke (preview) — order-less round-trip**

Start the preview, then: (a) org «Общие документы» tab → upload → appears in list + manager «Общие документы» sees it; (b) manager order-less upload to a partner → partner «Общие документы» shows it read-only; (c) confirm a second-company manager cannot see it. Capture a screenshot of each cabinet's order-less tab.

- [ ] **Step 6: Final commit (if smoke fixes needed)**

```bash
git add -A
git commit -m "chore(docs): Phase B order-less verification fixes"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** §3.1 schema→T1; §3.2 policy→T2; §3.3 write→T3/T7/T8/T9; §3.4 notifications→T8; §3.5 reads+null-cascade→T4/T5/T10/T11; §3.6 UI→T12-15; §4 tests→T2/T6/T8/T11/T17/T18; XOR §2.1→T1.
- **Order-less manager scope is company-level, not teamMode-aware** — `managerOrderLessWhere`/`canReadOrderLessDocument` gate purely on `companyId` (spec §2.4). Do not thread `teamMode` into order-less paths.
- **Partner order-less is outgoing-only** — there is intentionally NO partner order-less server-action; `uploadPartnerDocument` keeps requiring `orderId`. Partner sees order-less docs read-only (T14).
- **The XOR CHECK is load-bearing** — every order-bound `document.create` must leave `companyId` null; every order-less one must set it and pass `orderId:null`. Task 3 centralizes this in upload-core, so callers only choose the anchor.
- **Download guards are the security linchpin** — Task 11 + Task 17 together prove no cross-company leak on the order-less download path. Do not merge Task 11 without the Task 17 invariant.
