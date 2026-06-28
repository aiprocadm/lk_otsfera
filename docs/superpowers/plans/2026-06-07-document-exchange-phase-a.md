# Document Exchange — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship bidirectional, channel-isolated document exchange for order-anchored documents — manager↔organization and manager↔partner — so the organization and the partner each see only their own channel, and both sides can upload to the manager.

**Architecture:** Add a first-class `counterparty = (type, id)` to `Document`; centralize the channel rule in one policy module (`documentChannelPolicy.ts`, sibling of `managerPolicy.ts`); extract a shared upload core; add a `notifyPartner` fan-out and a `document_uploaded_by_partner` manager notification; flip the three cabinets' reads to channel-scoped; lock isolation with an integration invariant test. `orderId` stays NOT NULL (order-less docs are Phase B).

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript 5 strict · Prisma 5 + PostgreSQL · Supabase Storage · BullMQ · Vitest.

**Spec:** [docs/superpowers/specs/2026-06-07-document-exchange-design.md](../specs/2026-06-07-document-exchange-design.md)

**Conventions for every task:** unit tests run with `npx vitest run <file> --mode=unit`; integration tests (any file that does `new PrismaClient(`) run with `npx vitest run <file> --mode=integration` and need a live Postgres (`npm run gate` or a local DB). Commit messages end with a `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Pre-commit hook runs typecheck + changed unit tests; if the L2.5 gate hangs on a busy `:5432`, push with `git push --no-verify` (documented in CLAUDE.md §6 / memory).

---

## Task 1: Schema — `CounterpartyType` enum + `Document.counterparty*` (backfill-safe), fix every create site

**Files:**
- Modify: `prisma/schema.prisma` (Document model ~451-478; add enum near other enums ~42-57)
- Create: `prisma/migrations/<timestamp>_document_counterparty/migration.sql` (via `--create-only`, hand-written body)
- Modify (prod create sites): `src/worker/processors/sync-documents.ts:63`, `src/lib/services/manager/uploads.ts:155`, `src/app/api/documents/upload/route.ts:111`
- Modify (test seeds): `src/__tests__/services.manager.dashboard.test.ts`, `services.manager.documents.test.ts`, `services.manager.orders.test.ts`, `services.organization.dashboard.test.ts`, `services.organization.documents.test.ts`, `services.organization.orders.test.ts`, `worker.notification-hooks.test.ts`
- Modify: `src/__tests__/schema.document.test.ts`

- [ ] **Step 1: Write the failing schema test** — append to `src/__tests__/schema.document.test.ts`:

```ts
it('Document has counterpartyType + counterpartyId and CounterpartyType enum exists', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8'
  );
  expect(schema).toMatch(/enum CounterpartyType \{[\s\S]*organization[\s\S]*partner[\s\S]*\}/);
  expect(schema).toMatch(/counterpartyType\s+CounterpartyType/);
  expect(schema).toMatch(/counterpartyId\s+String/);
  expect(schema).toMatch(/@@index\(\[counterpartyType, counterpartyId\]\)/);
});
```

(If `readFileSync`/`join` aren't already imported in that file, add `import { readFileSync } from 'node:fs'; import { join } from 'node:path';` at the top.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/schema.document.test.ts --mode=unit`
Expected: FAIL (enum/columns not present yet).

- [ ] **Step 3: Edit `prisma/schema.prisma`** — add the enum next to `DocumentDirection`:

```prisma
enum CounterpartyType {
  organization
  partner
}
```

In `model Document`, add the two fields (keep `orderId String` required) and the index:

```prisma
  orderId            String
  order              Order             @relation(fields: [orderId], references: [id])
  counterpartyType   CounterpartyType
  counterpartyId     String
  uploadedById       String?
  // ... existing fields ...

  @@index([orderId, type])
  @@index([counterpartyType, counterpartyId])
  @@index([type, createdAt])
  @@index([externalId])
  @@index([scanStatus])
```

- [ ] **Step 4: Generate the migration scaffold, then hand-write the SQL**

Run: `npx prisma migrate dev --create-only --name document_counterparty`

Replace the generated `migration.sql` body with this backfill-safe sequence:

```sql
-- CounterpartyType enum
CREATE TYPE "CounterpartyType" AS ENUM ('organization', 'partner');

-- Add columns nullable first (existing rows have no value yet)
ALTER TABLE "Document" ADD COLUMN "counterpartyType" "CounterpartyType";
ALTER TABLE "Document" ADD COLUMN "counterpartyId" TEXT;

-- Backfill: default to the order's organization channel...
UPDATE "Document" d
SET "counterpartyType" = 'organization', "counterpartyId" = o."organizationId"
FROM "Order" o
WHERE d."orderId" = o."id";

-- ...except commission statements, which belong to the partner channel
-- (only when the order actually has a partner).
UPDATE "Document" d
SET "counterpartyType" = 'partner', "counterpartyId" = o."partnerId"
FROM "Order" o
WHERE d."orderId" = o."id"
  AND d."type" = 'commission_statement'
  AND o."partnerId" IS NOT NULL;

-- Enforce NOT NULL now that every row is populated
ALTER TABLE "Document" ALTER COLUMN "counterpartyType" SET NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "counterpartyId" SET NOT NULL;

-- Channel index
CREATE INDEX "Document_counterpartyType_counterpartyId_idx"
  ON "Document"("counterpartyType", "counterpartyId");
```

Apply + regenerate client:

Run: `npx prisma migrate dev` then `npm run prisma:generate`

- [ ] **Step 5: Fix prod create site — worker `sync-documents.ts:63`** (1C incoming docs are organization-channel). Add to the `db.document.create({ data: {...} })`:

```ts
        counterpartyType: 'organization',
        counterpartyId: order.organizationId,
```

(The processor already loads `order` with `organizationId` for its notify call — reuse it. If `organizationId` isn't in that order select, add it.)

- [ ] **Step 6: Fix prod create site — `src/lib/services/manager/uploads.ts:155`** (preserve current behavior = organization-channel; Task 6 generalizes). The `order` select at line 103 already has `organizationId`. Add to the `prisma.document.create` data:

```ts
      counterpartyType: 'organization',
      counterpartyId: order.organizationId,
```

- [ ] **Step 7: Fix prod create site — `src/app/api/documents/upload/route.ts:111`** (legacy generic upload; the full `order` is loaded at line 67). Replace the create data with:

```ts
    data: {
      orderId,
      counterpartyType: 'organization',
      counterpartyId: order.organizationId,
      name: file.name,
      path: internalPath,
      mimeType: file.type,
      uploadedById: s.sub
    }
```

- [ ] **Step 8: Fix all test seeds.** In each test file listed above, every `prisma.document.create({ data: { ... orderId: <X>, ... } })` must gain `counterpartyType` + `counterpartyId`. Rule: use the **organization** channel of that seed's order. Concretely, for a doc created against an order whose `organizationId` is `orgAId`, add:

```ts
      counterpartyType: 'organization',
      counterpartyId: orgAId,
```

Apply the same edit (with the matching org id variable for that order) to every create site in: `services.manager.dashboard.test.ts` (2), `services.manager.documents.test.ts` (5), `services.manager.orders.test.ts` (2), `services.organization.dashboard.test.ts` (2), `services.organization.documents.test.ts` (5), `services.organization.orders.test.ts` (2), `worker.notification-hooks.test.ts` (1). Where a seed's order variable exposes only the order (not the org id), read the org id from the order the seed created (the seeds create the org just above).

- [ ] **Step 9: Run the schema test + full typecheck**

Run: `npx vitest run src/__tests__/schema.document.test.ts --mode=unit` → PASS
Run: `npm run typecheck` → PASS (every `document.create` now supplies counterparty)

- [ ] **Step 10: Run the touched integration tests against a live DB**

Run: `npx vitest run src/__tests__/services.organization.documents.test.ts src/__tests__/services.manager.documents.test.ts --mode=integration`
Expected: PASS (reads unchanged in this task; only seeds gained columns).

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/worker/processors/sync-documents.ts src/lib/services/manager/uploads.ts src/app/api/documents/upload/route.ts src/__tests__
git commit -m "feat(documents): add Document.counterparty (enum+columns) with backfill-safe migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `documentChannelPolicy.ts` — single source of truth for the channel rule

**Files:**
- Create: `src/lib/auth/documentChannelPolicy.ts`
- Test: `src/__tests__/auth.documentChannelPolicy.test.ts`

- [ ] **Step 1: Write the failing test** — `src/__tests__/auth.documentChannelPolicy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  organizationChannelWhere,
  partnerChannelWhere,
  documentInChannel
} from '@/lib/auth/documentChannelPolicy';

describe('documentChannelPolicy', () => {
  it('organizationChannelWhere pins the org channel and hides infected', () => {
    expect(organizationChannelWhere('org-1')).toEqual({
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('partnerChannelWhere pins the partner channel and hides infected', () => {
    expect(partnerChannelWhere('p-1')).toEqual({
      counterpartyType: 'partner',
      counterpartyId: 'p-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('documentInChannel matches type + id', () => {
    const doc = { counterpartyType: 'partner' as const, counterpartyId: 'p-1' };
    expect(documentInChannel(doc, { type: 'partner', id: 'p-1' })).toBe(true);
    expect(documentInChannel(doc, { type: 'partner', id: 'p-2' })).toBe(false);
    expect(documentInChannel(doc, { type: 'organization', id: 'p-1' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/auth.documentChannelPolicy.test.ts --mode=unit`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `src/lib/auth/documentChannelPolicy.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

/**
 * Channel isolation for documents (spec 2026-06-07-document-exchange).
 *
 * Every Document belongs to a channel = (counterpartyType, counterpartyId)
 * exchanged between that counterparty and the managers who scope it. Isolation
 * constrains CLIENTS: an organization sees only its organization-channel, a
 * partner only its partner-channel. Managers see both channels within their
 * existing order/company scope (managerPolicy), so there is intentionally no
 * manager where-builder here in Phase A.
 *
 * This module is the single source of truth for the client-side channel rule —
 * do not inline `{ counterpartyType, counterpartyId }` filters in cabinet
 * services; call these helpers so the rule cannot drift (CLAUDE.md §4).
 */

export type CounterpartyType = 'organization' | 'partner';
export type DocumentChannel = { type: CounterpartyType; id: string };

export function organizationChannelWhere(organizationId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'organization',
    counterpartyId: organizationId,
    ...INFECTED_HIDDEN_WHERE
  };
}

export function partnerChannelWhere(partnerId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'partner',
    counterpartyId: partnerId,
    ...INFECTED_HIDDEN_WHERE
  };
}

/**
 * Membership check for a fetched document — used by download guards to return a
 * silent `not_found` when a document is outside the caller's channel (no
 * existence leak).
 */
export function documentInChannel(
  doc: { counterpartyType: CounterpartyType; counterpartyId: string },
  channel: DocumentChannel
): boolean {
  return doc.counterpartyType === channel.type && doc.counterpartyId === channel.id;
}
```

- [ ] **Step 4: Run the test → PASS**

Run: `npx vitest run src/__tests__/auth.documentChannelPolicy.test.ts --mode=unit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/documentChannelPolicy.ts src/__tests__/auth.documentChannelPolicy.test.ts
git commit -m "feat(documents): add documentChannelPolicy (channel where-builders)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared upload core — `persistUploadedDocument`

**Files:**
- Create: `src/lib/services/documents/upload-core.ts`
- Test: `src/__tests__/services.documents.upload-core.test.ts`

- [ ] **Step 1: Write the failing test** (validation branches are pure; storage/queue/audit are mocked):

```ts
import { describe, it, expect, vi } from 'vitest';

const { uploadMock, addMock, auditMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addMock: vi.fn(),
  auditMock: vi.fn()
}));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  supabaseAdmin: { storage: { from: () => ({ upload: uploadMock }) } }
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addMock }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: auditMock }));

import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

const baseArgs = {
  counterparty: { type: 'organization' as const, id: 'org-1' },
  orderId: 'order-1',
  direction: 'incoming' as const,
  docType: 'act',
  uploadedById: 'user-1',
  source: 'organization' as const,
  file: { name: 'a.pdf', size: 10, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
};

describe('persistUploadedDocument', () => {
  it('rejects oversize files before any storage call', async () => {
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, size: 21 * 1024 * 1024 }
    });
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects disallowed MIME types', async () => {
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, mimeType: 'application/x-msdownload' }
    });
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('persists with counterparty + direction and enqueues a scan', async () => {
    uploadMock.mockResolvedValue({ error: null });
    const create = vi.fn().mockResolvedValue({ id: 'doc-9' });
    const prisma = { document: { create } } as never;
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: true, documentId: 'doc-9' });
    const data = create.mock.calls[0][0].data;
    expect(data.counterpartyType).toBe('organization');
    expect(data.counterpartyId).toBe('org-1');
    expect(data.direction).toBe('incoming');
    expect(addMock).toHaveBeenCalledOnce();
    expect(auditMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/services.documents.upload-core.test.ts --mode=unit`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `src/lib/services/documents/upload-core.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, DocumentType, DocumentDirection } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

/**
 * Shared write path for every document upload (manager outgoing, org/partner
 * incoming). Owns MIME/size validation, magic-byte fingerprinting, Supabase
 * upload, the Document row (with counterparty + direction), best-effort scan
 * enqueue, and the audit entry. RBAC and notification fan-out stay in the
 * callers — they differ per direction/role (CLAUDE.md §3).
 */

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const VALID_DOC_TYPES = new Set<DocumentType>([
  'contract', 'extra_agreement', 'invoice', 'act', 'waybill',
  'certificate', 'report', 'commission_statement', 'other'
]);

export type UploadSource = 'manager' | 'organization' | 'partner';

export type PersistDocumentArgs = {
  counterparty: { type: 'organization' | 'partner'; id: string };
  orderId: string;
  direction: DocumentDirection;
  docType: string;
  uploadedById: string;
  source: UploadSource;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type PersistDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'too_large' | 'invalid_mime' | 'storage' };

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function coerceDocType(input: string): DocumentType {
  return VALID_DOC_TYPES.has(input as DocumentType) ? (input as DocumentType) : 'other';
}

export async function persistUploadedDocument(
  prisma: PrismaClient,
  args: PersistDocumentArgs
): Promise<PersistDocumentResult> {
  if (args.file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: 'too_large' };
  if (!ALLOWED_MIME_TYPES.has(args.file.mimeType)) return { ok: false, error: 'invalid_mime' };
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(args.file.mimeType)) {
    const validation = validateMagicBytes(args.file.mimeType, args.file.buffer);
    if (!validation.ok) return { ok: false, error: 'invalid_mime' };
  }

  const safeName = sanitizeFilename(args.file.name);
  const storagePath = `orders/${args.orderId}/${randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(storagePath, args.file.buffer, { contentType: args.file.mimeType, upsert: false });
  if (uploadError) {
    console.error('[documents/upload-core] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError.message
    });
    return { ok: false, error: 'storage' };
  }

  const docType = coerceDocType(args.docType);
  const doc = await prisma.document.create({
    data: {
      orderId: args.orderId,
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
  });

  try {
    const payload: ScanDocumentPayload = { kind: 'document', id: doc.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    console.warn('[documents/upload-core] enqueue scan failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  await recordAudit(prisma, {
    action: 'document_uploaded',
    entity: 'document',
    entityId: doc.id,
    userId: args.uploadedById,
    after: {
      orderId: args.orderId,
      counterpartyType: args.counterparty.type,
      counterpartyId: args.counterparty.id,
      direction: args.direction,
      docType,
      source: args.source,
      path: storagePath,
      mimeType: args.file.mimeType,
      size: args.file.size
    }
  });

  return { ok: true, documentId: doc.id };
}
```

- [ ] **Step 4: Run the test → PASS**

Run: `npx vitest run src/__tests__/services.documents.upload-core.test.ts --mode=unit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/documents/upload-core.ts src/__tests__/services.documents.upload-core.test.ts
git commit -m "feat(documents): add shared persistUploadedDocument upload core

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `notifyPartner` — partner fan-out + email template + send fn + barrel

**Files:**
- Create: `src/lib/notifications/partner.ts`
- Create: `src/lib/email/templates/partner/document-published.tsx`
- Modify: `src/lib/email/templates/index.ts` (export the new template)
- Modify: `src/lib/email/send.tsx` (add `sendPartnerDocumentPublishedEmail`)
- Modify: `src/lib/notifications/index.ts` (add `export * from './partner'`)
- Test: `src/__tests__/notifications.partner.test.ts`

- [ ] **Step 1: Write the partner email template** `src/lib/email/templates/partner/document-published.tsx` (model: manager `document-uploaded-by-org.tsx`):

```tsx
import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'договор',
  extra_agreement: 'доп. соглашение',
  invoice: 'счёт',
  act: 'акт',
  waybill: 'накладную',
  certificate: 'сертификат',
  report: 'отчёт',
  commission_statement: 'расчёт комиссии',
  other: 'документ'
};

export type PartnerDocumentPublishedProps = {
  partnerName: string;
  orderNumber: string;
  orderTitle: string;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function PartnerDocumentPublished(props: PartnerDocumentPublishedProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return (
    <EmailLayout title='Новый документ'>
      <p style={emailStyles.paragraph}>
        По заказу <strong>№ {props.orderNumber}</strong> загружен {typeLabel}{' '}
        <strong>«{props.documentName}»</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.orderUrl} style={emailStyles.button}>Открыть портфолио</a>
      </p>
      <p style={emailStyles.muted}>
        <span style={emailStyles.mono}>{props.orderUrl}</span>
      </p>
    </EmailLayout>
  );
}

export function partnerDocumentPublishedSubject(props: PartnerDocumentPublishedProps): string {
  return `Новый документ ${props.documentName} по заказу № ${props.orderNumber}`;
}

export function partnerDocumentPublishedText(props: PartnerDocumentPublishedProps): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return [
    `По заказу № ${props.orderNumber} загружен ${typeLabel} «${props.documentName}».`,
    '',
    `Открыть портфолио: ${props.orderUrl}`
  ].join('\n');
}
```

- [ ] **Step 2: Export it from `src/lib/email/templates/index.ts`** (append):

```ts
export {
  PartnerDocumentPublished,
  partnerDocumentPublishedSubject,
  partnerDocumentPublishedText
} from './partner/document-published';
export type { PartnerDocumentPublishedProps } from './partner/document-published';
```

- [ ] **Step 3: Add the send fn in `src/lib/email/send.tsx`** — add to the templates import block: `PartnerDocumentPublished, partnerDocumentPublishedSubject, partnerDocumentPublishedText, type PartnerDocumentPublishedProps`, then add:

```tsx
export async function sendPartnerDocumentPublishedEmail(
  args: { to: string } & PartnerDocumentPublishedProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: partnerDocumentPublishedSubject(props),
      html: await renderHtml(<PartnerDocumentPublished {...props} />),
      text: partnerDocumentPublishedText(props),
    },
    options,
  );
}
```

- [ ] **Step 4: Write the failing fan-out test** `src/__tests__/notifications.partner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendPartnerDocumentPublishedEmail: sendMock }));

import { notifyPartnerUsers } from '@/lib/notifications/partner';

function dbWith(users: Array<{ id: string; email: string | null }>) {
  const create = vi.fn().mockResolvedValue({});
  return {
    db: {
      partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', name: 'ООО Партнёр', users }) },
      notification: { create }
    } as never,
    create
  };
}

describe('notifyPartnerUsers', () => {
  it('creates an in-app notification per active partner user', async () => {
    sendMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([
      { id: 'u1', email: 'a@p.ru' },
      { id: 'u2', email: null }
    ]);
    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: { orderId: 'o1', orderNumber: '42', orderTitle: 'T', documentName: 'k.pdf', documentType: 'commission_statement' }
    });
    expect(r.recipientsNotified).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.partnerId).toBe('p-1');
  });

  it('returns zeroes for an unknown partner', async () => {
    const db = { partner: { findUnique: vi.fn().mockResolvedValue(null) }, notification: { create: vi.fn() } } as never;
    const r = await notifyPartnerUsers(db, {
      partnerId: 'missing',
      type: 'document_published',
      payload: { orderId: 'o', orderNumber: null, orderTitle: 'T', documentName: 'k', documentType: 'other' }
    });
    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/notifications.partner.test.ts --mode=unit`
Expected: FAIL ("Cannot find module './partner'").

- [ ] **Step 6: Implement `src/lib/notifications/partner.ts`**

```ts
import { Prisma, type PrismaClient } from '@prisma/client';
import { sendPartnerDocumentPublishedEmail } from '@/lib/email/send';
import { getAppBaseUrl, orderLabel } from './shared';

/**
 * Fan-out to all active users of a partner (in-app + best-effort email).
 * Mirrors notifyOrgUsers; the Notification row carries `partnerId` (the
 * Partner.notifications relation already exists). Partner has no per-order
 * route, so the deep link targets the portfolio.
 */

export type PartnerNotifyInput = {
  partnerId: string;
  type: 'document_published';
  payload: {
    orderId: string;
    orderNumber: string | null;
    orderTitle: string;
    documentName: string;
    documentType: string;
  };
};

export type NotifyPartnerSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
};

export async function notifyPartnerUsers(
  db: PrismaClient,
  input: PartnerNotifyInput
): Promise<NotifyPartnerSummary> {
  const partner = await db.partner.findUnique({
    where: { id: input.partnerId },
    select: {
      id: true,
      name: true,
      users: { where: { isActive: true }, select: { id: true, email: true } }
    }
  });
  if (!partner) return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };

  const orderUrl = `${getAppBaseUrl()}/partner/portfolio`;
  const label = orderLabel(input.payload.orderNumber, input.payload.orderTitle);
  const title = `Новый документ по заказу ${label}`;
  const body = `Загружен документ «${input.payload.documentName}» (${input.payload.documentType}).`;
  const meta = { ...input.payload, partnerName: partner.name, url: orderUrl };

  let emailsSent = 0;
  let emailsSkipped = 0;
  let recipientsNotified = 0;

  for (const u of partner.users) {
    await db.notification.create({
      data: {
        userId: u.id,
        partnerId: partner.id,
        type: input.type,
        title,
        body,
        meta: meta as Prisma.InputJsonValue
      }
    });
    recipientsNotified += 1;

    if (u.email) {
      try {
        const r = await sendPartnerDocumentPublishedEmail({
          to: u.email,
          partnerName: partner.name,
          orderNumber: input.payload.orderNumber ?? input.payload.orderTitle,
          orderTitle: input.payload.orderTitle,
          documentName: input.payload.documentName,
          documentType: input.payload.documentType,
          orderUrl
        });
        if (r.status === 'sent') emailsSent += 1;
        else emailsSkipped += 1;
      } catch (err) {
        emailsSkipped += 1;
        console.warn('[notifyPartnerUsers] email dispatch failed', {
          partnerId: partner.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    } else {
      emailsSkipped += 1;
    }
  }

  return { recipientsNotified, emailsSent, emailsSkipped };
}
```

- [ ] **Step 7: Add the barrel export** in `src/lib/notifications/index.ts`:

```ts
export * from './core';
export * from './org';
export * from './manager';
export * from './partner';
```

- [ ] **Step 8: Run test + typecheck → PASS**

Run: `npx vitest run src/__tests__/notifications.partner.test.ts --mode=unit`
Run: `npm run typecheck`

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications/partner.ts src/lib/notifications/index.ts src/lib/email/templates/partner src/lib/email/templates/index.ts src/lib/email/send.tsx src/__tests__/notifications.partner.test.ts
git commit -m "feat(notifications): add notifyPartnerUsers + partner document-published email

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `document_uploaded_by_partner` — manager notification type

**Files:**
- Create: `src/lib/email/templates/manager/document-uploaded-by-partner.tsx`
- Modify: `src/lib/email/templates/index.ts`, `src/lib/email/send.tsx`
- Modify: `src/lib/notifications/manager.ts` (union + template map)
- Test: `src/__tests__/notifications.manager.partner-upload.test.ts`

- [ ] **Step 1: Create the email template** `src/lib/email/templates/manager/document-uploaded-by-partner.tsx` (copy `document-uploaded-by-org.tsx`, swap org→partner):

```tsx
import * as React from 'react';
import { EmailLayout, emailStyles } from '../layout';

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'договор', extra_agreement: 'доп. соглашение', invoice: 'счёт',
  act: 'акт', waybill: 'накладную', certificate: 'сертификат', report: 'отчёт',
  commission_statement: 'расчёт комиссии', other: 'документ'
};

export type ManagerDocumentUploadedByPartnerProps = {
  partnerName: string;
  orderNumber: string;
  documentName: string;
  documentType: string;
  orderUrl: string;
};

export function ManagerDocumentUploadedByPartner(props: ManagerDocumentUploadedByPartnerProps) {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return (
    <EmailLayout title='Документ от партнёра'>
      <p style={emailStyles.paragraph}>
        Партнёр <strong>{props.partnerName}</strong> загрузил {typeLabel}{' '}
        <strong>«{props.documentName}»</strong> к заказу <strong>№ {props.orderNumber}</strong>.
      </p>
      <p style={emailStyles.paragraph}>
        <a href={props.orderUrl} style={emailStyles.button}>Открыть заказ</a>
      </p>
      <p style={emailStyles.muted}><span style={emailStyles.mono}>{props.orderUrl}</span></p>
    </EmailLayout>
  );
}

export function managerDocumentUploadedByPartnerSubject(props: ManagerDocumentUploadedByPartnerProps): string {
  return `${props.partnerName} загрузил документ ${props.documentName} к заказу № ${props.orderNumber}`;
}

export function managerDocumentUploadedByPartnerText(props: ManagerDocumentUploadedByPartnerProps): string {
  const typeLabel = DOC_TYPE_LABELS[props.documentType] ?? 'документ';
  return [
    `Партнёр ${props.partnerName} загрузил ${typeLabel} «${props.documentName}» к заказу № ${props.orderNumber}.`,
    '',
    `Открыть заказ: ${props.orderUrl}`
  ].join('\n');
}
```

- [ ] **Step 2: Export from `templates/index.ts`** (append, mirroring the by-org block):

```ts
export {
  ManagerDocumentUploadedByPartner,
  managerDocumentUploadedByPartnerSubject,
  managerDocumentUploadedByPartnerText
} from './manager/document-uploaded-by-partner';
export type { ManagerDocumentUploadedByPartnerProps } from './manager/document-uploaded-by-partner';
```

- [ ] **Step 3: Add the send fn in `send.tsx`** — add the three identifiers + type to the templates import, then:

```tsx
export async function sendManagerDocumentUploadedByPartnerEmail(
  args: { to: string } & ManagerDocumentUploadedByPartnerProps,
  options: SendOptions = {},
): Promise<SendResult> {
  const { to, ...props } = args;
  return send(
    {
      to,
      subject: managerDocumentUploadedByPartnerSubject(props),
      html: await renderHtml(<ManagerDocumentUploadedByPartner {...props} />),
      text: managerDocumentUploadedByPartnerText(props),
    },
    options,
  );
}
```

- [ ] **Step 4: Write the failing test** `src/__tests__/notifications.manager.partner-upload.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const { sendOrg, sendPartner } = vi.hoisted(() => ({ sendOrg: vi.fn(), sendPartner: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendManagerCommentFromOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByOrgEmail: sendOrg,
  sendManagerDocumentUploadedByPartnerEmail: sendPartner,
  sendManagerOrderMarkedPaidBy1CEmail: vi.fn(),
  sendManagerOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: vi.fn()
}));

import { notifyManagers } from '@/lib/notifications/manager';

describe('notifyManagers — document_uploaded_by_partner', () => {
  it('creates rows + dispatches the partner-upload email to managers in scope', async () => {
    sendPartner.mockResolvedValue({ status: 'sent', id: 'e1' });
    const create = vi.fn().mockResolvedValue({});
    const db = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', orderNumber: '42', title: 'T', managerId: 'm1', organizationId: 'org1' }) },
      organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', email: 'm@x.ru', name: 'M' }]) },
      notification: { create }
    } as never;

    const r = await notifyManagers(db, {
      orderId: 'o1',
      type: 'document_uploaded_by_partner',
      payload: { partnerName: 'ООО Партнёр', documentName: 'k.pdf', documentType: 'commission_statement' }
    });

    expect(r.recipientsNotified).toBe(1);
    expect(create.mock.calls[0][0].data.type).toBe('document_uploaded_by_partner');
    expect(sendPartner).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/notifications.manager.partner-upload.test.ts --mode=unit`
Expected: FAIL (type not in union / template map).

- [ ] **Step 6: Extend `src/lib/notifications/manager.ts`.** (a) Add to the import from `@/lib/email/send`: `sendManagerDocumentUploadedByPartnerEmail`. (b) Add to the import from `@/lib/email/templates`: `managerDocumentUploadedByPartnerSubject, managerDocumentUploadedByPartnerText`. (c) Add `'document_uploaded_by_partner'` to `NotifyManagersType`. (d) Add the input variant to `NotifyManagersInput`:

```ts
  | {
      orderId: string;
      type: 'document_uploaded_by_partner';
      payload: {
        partnerName: string;
        documentName: string;
        documentType: string;
      };
    }
```

(e) Add the builder to `MANAGER_TEMPLATES`:

```ts
  document_uploaded_by_partner: (input, ctx) => {
    if (input.type !== 'document_uploaded_by_partner') throw new Error('type mismatch');
    const props = {
      partnerName: input.payload.partnerName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerDocumentUploadedByPartnerSubject(props),
      shortBody: managerDocumentUploadedByPartnerText(props),
      dispatch: (to) => sendManagerDocumentUploadedByPartnerEmail({ to, ...props })
    };
  },
```

- [ ] **Step 7: Run test + typecheck → PASS**

Run: `npx vitest run src/__tests__/notifications.manager.partner-upload.test.ts --mode=unit`
Run: `npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/lib/notifications/manager.ts src/lib/email/templates/manager/document-uploaded-by-partner.tsx src/lib/email/templates/index.ts src/lib/email/send.tsx src/__tests__/notifications.manager.partner-upload.test.ts
git commit -m "feat(notifications): add document_uploaded_by_partner manager notification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Generalize manager upload → recipient channel + route + form selector

**Files:**
- Modify: `src/lib/services/manager/uploads.ts` (`createOrderDocument` → `createCounterpartyDocument`, use upload-core, recipient branch)
- Modify: `src/app/api/manager/documents/[id]/upload/route.ts` (pass `recipient`, map `invalid_recipient`→400)
- Modify: `src/components/manager/manager-doc-upload-form.tsx` (recipient `<select>`, default by type)
- Modify: `src/__tests__/services.manager.uploads.test.ts` and `src/__tests__/api.manager.documents.upload.test.ts`

- [ ] **Step 1: Update the unit test** `src/__tests__/services.manager.uploads.test.ts`. **First, migrate every existing call site:** rename the import on line 35 and all ~12 `createOrderDocument(prisma, session, { ... })` calls to `createCounterpartyDocument(prisma, session, { ... })`, and add `recipient: 'organization'` to each args object (preserves today's behavior — all existing manager uploads were org-facing). Add `notifyPartnerUsers` to the mocked `@/lib/notifications` (alongside the existing `notifyOrgUsers` mock), and add `partnerId` to the mocked order objects. **Then add three new cases:** (a) `recipient: 'organization'` sets `counterpartyType: 'organization'` + `direction: 'outgoing'` and calls `notifyOrgUsers`; (b) `recipient: 'partner'` on an order **with** a partner sets `counterpartyType: 'partner'` + calls `notifyPartnerUsers`; (c) `recipient: 'partner'` on an order with `partnerId: null` returns `{ ok: false, error: 'invalid_recipient' }` and never uploads.

```ts
it('recipient=partner on a partnerless order is rejected before upload', async () => {
  orderFindUnique.mockResolvedValue({
    id: 'o1', managerId: 'm1', organizationId: 'org1', partnerId: null,
    companyId: 'c1', orderNumber: '1', title: 'T'
  });
  const r = await createCounterpartyDocument(prisma, managerSession, {
    orderId: 'o1', recipient: 'partner', docType: 'commission_statement', file: pdf()
  });
  expect(r).toEqual({ ok: false, error: 'invalid_recipient' });
  expect(uploadMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/services.manager.uploads.test.ts --mode=unit`
Expected: FAIL (`createCounterpartyDocument` undefined / no recipient handling).

- [ ] **Step 3: Rewrite `src/lib/services/manager/uploads.ts`.** Replace the file body below the imports. Add `partnerId: true` to the order select; import the core + notifiers; branch on recipient. Keep `canSeeOrder` RBAC.

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { notifyOrgUsers, notifyPartnerUsers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

export type DocumentRecipient = 'organization' | 'partner';

export type CreateCounterpartyDocumentArgs = {
  orderId: string;
  recipient: DocumentRecipient;
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type CreateCounterpartyDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'forbidden' | 'too_large' | 'invalid_mime' | 'storage' | 'not_found' | 'invalid_recipient';
    };

export async function createCounterpartyDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateCounterpartyDocumentArgs
): Promise<CreateCounterpartyDocumentResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true, managerId: true, organizationId: true, partnerId: true,
      companyId: true, orderNumber: true, title: true
    }
  });
  if (!order) return { ok: false, error: 'not_found' };

  let commentsCountByMe = 0;
  if (!teamMode && order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null && managedOrgIds(session).includes(order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }
  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) {
    return { ok: false, error: 'forbidden' };
  }

  // Resolve the target channel. Partner channel requires the order to have a partner.
  const counterparty =
    args.recipient === 'partner'
      ? order.partnerId
        ? { type: 'partner' as const, id: order.partnerId }
        : null
      : { type: 'organization' as const, id: order.organizationId };
  if (!counterparty) return { ok: false, error: 'invalid_recipient' };

  const persisted = await persistUploadedDocument(prisma, {
    counterparty,
    orderId: order.id,
    direction: 'outgoing',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'manager',
    file: args.file
  });
  if (!persisted.ok) return persisted;

  // Fan out to the recipient channel only (best-effort — never roll back upload).
  try {
    if (counterparty.type === 'organization') {
      await notifyOrgUsers(prisma, {
        organizationId: counterparty.id,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    } else {
      await notifyPartnerUsers(prisma, {
        partnerId: counterparty.id,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    }
  } catch (err) {
    console.warn('[manager/uploads] recipient notify failed', {
      documentId: persisted.documentId,
      recipient: args.recipient,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
```

- [ ] **Step 4: Update the route** `src/app/api/manager/documents/[id]/upload/route.ts` — read `recipient`, call the renamed service, map the new error:

```ts
import { createCounterpartyDocument } from '@/lib/services/manager/uploads';
// ...
  const docType = String(form.get('docType') ?? 'other');
  const recipientRaw = String(form.get('recipient') ?? 'organization');
  const recipient = recipientRaw === 'partner' ? 'partner' : 'organization';
  // ...
  const result = await createCounterpartyDocument(prisma, session, {
    orderId, recipient, docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403
      : result.error === 'too_large' ? 413
      : result.error === 'invalid_mime' ? 415
      : result.error === 'not_found' ? 404
      : result.error === 'invalid_recipient' ? 400
      : 500;
    return Response.json({ ok: false, error: result.error }, { status });
  }
```

- [ ] **Step 5: Update the route test** `src/__tests__/api.manager.documents.upload.test.ts` — change the mock to `createCounterpartyDocument`, assert `recipient` is forwarded, and add a 400 case for `invalid_recipient`. (Match the file's existing vi.hoisted mock pattern.)

- [ ] **Step 6: Add the recipient selector to the form** `src/components/manager/manager-doc-upload-form.tsx`. Add state + default-by-type + a `<select>` and include `recipient` in the FormData:

```tsx
  const [recipient, setRecipient] = useState<'organization' | 'partner'>('organization');

  // default recipient by document type: commission statements go to the partner
  function onDocTypeChange(value: string) {
    setDocType(value);
    setRecipient(value === 'commission_statement' ? 'partner' : 'organization');
  }
```

Replace `onChange={(e) => setDocType(e.target.value)}` with `onChange={(e) => onDocTypeChange(e.target.value)}`, add `formData.set('recipient', recipient);` next to the other `formData.set(...)`, add `invalid_recipient: 'У заказа нет партнёра — получатель «партнёр» недоступен.'` to `ERROR_LABEL_RU`, and add the control:

```tsx
        <label className='text-sm text-gray-700'>
          <span className='block text-xs text-gray-500 mb-1'>Получатель</span>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value as 'organization' | 'partner')}
            disabled={isPending}
            className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50'
          >
            <option value='organization'>Организация</option>
            <option value='partner'>Партнёр</option>
          </select>
        </label>
```

- [ ] **Step 7: Run unit tests + typecheck → PASS**

Run: `npx vitest run src/__tests__/services.manager.uploads.test.ts src/__tests__/api.manager.documents.upload.test.ts --mode=unit`
Run: `npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/manager/uploads.ts "src/app/api/manager/documents/[id]/upload/route.ts" src/components/manager/manager-doc-upload-form.tsx src/__tests__/services.manager.uploads.test.ts src/__tests__/api.manager.documents.upload.test.ts
git commit -m "feat(documents): manager upload picks recipient channel (org|partner)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Organization reverse upload — server-action + UI form

**Files:**
- Create: `src/server-actions/organization/documents.ts` (`uploadOrganizationDocument`)
- Create: `src/components/organization/organization-document-upload-form.tsx`
- Test: `src/__tests__/server-actions.organization.documents.test.ts`

- [ ] **Step 1: Write the failing test** (mock prisma membership + order + the core + notifyManagers):

```ts
import { describe, it, expect, vi } from 'vitest';

const { core, notify, session } = vi.hoisted(() => ({
  core: vi.fn(), notify: vi.fn(),
  session: { sub: 'u1', role: 'organization', email: 'o@x.ru', name: 'O' }
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({ notifyManagers: notify }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn().mockResolvedValue(session) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: {
  organizationUser: { findFirst: vi.fn() },
  order: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() }
} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

function fd(entries: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

describe('uploadOrganizationDocument', () => {
  it('rejects when the user is not an active member of the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue(null);
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });

  it('rejects when the order is not in the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'OTHER', orderNumber: '1', title: 'T' });
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('persists incoming org-channel doc + notifies managers', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: '1', title: 'T' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Клиент' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'organization', id: 'org1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_org');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/server-actions.organization.documents.test.ts --mode=unit`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `src/server-actions/organization/documents.ts`**

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyManagers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' };

const schema = z.object({
  organizationId: z.string().min(1),
  orderId: z.string().min(1),
  docType: z.string().min(1)
});

export async function uploadOrganizationDocument(formData: FormData): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const parsed = schema.safeParse({
    organizationId: String(formData.get('organizationId') ?? ''),
    orderId: String(formData.get('orderId') ?? ''),
    docType: String(formData.get('docType') ?? 'other')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  // Membership: user must be an active member of the target org.
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId: parsed.data.organizationId, userId: session.sub, isActive: true },
    select: { id: true }
  });
  if (!membership) return { ok: false, error: 'forbidden' };

  // Order must belong to that org (silent not_found otherwise).
  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { id: true, organizationId: true, orderNumber: true, title: true }
  });
  if (!order || order.organizationId !== parsed.data.organizationId) {
    return { ok: false, error: 'not_found' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'organization', id: parsed.data.organizationId },
    orderId: order.id,
    direction: 'incoming',
    docType: parsed.data.docType,
    uploadedById: session.sub,
    source: 'organization',
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });
  if (!persisted.ok) return persisted;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { name: true }
    });
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_org',
      payload: { orgName: org?.name ?? 'организация', documentName: file.name, documentType: parsed.data.docType }
    });
  } catch (err) {
    console.warn('[uploadOrganizationDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  revalidatePath('/organization/documents');
  return { ok: true, documentId: persisted.documentId };
}
```

- [ ] **Step 4: Run the test → PASS**

Run: `npx vitest run src/__tests__/server-actions.organization.documents.test.ts --mode=unit`

- [ ] **Step 5: Create the upload form** `src/components/organization/organization-document-upload-form.tsx` (client component; calls the action; `useState` for file/docType/pending/error/success; mirror `manager-doc-upload-form.tsx` minus the recipient selector; takes props `{ organizationId: string; orderId: string }`; on success `router.refresh()`). Include `import React` is implicit via `'use client'` + JSX; this file is not unit-tested so the classic-JSX caveat does not apply, but keep the `'use client'` directive first.

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' }
];

const ERROR_LABEL_RU: Record<string, string> = {
  validation: 'Проверьте поля формы.',
  forbidden: 'Нет прав на загрузку.',
  not_found: 'Заказ не найден.',
  too_large: 'Файл превышает 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.'
};

export function OrganizationDocumentUploadForm({ organizationId, orderId }: { organizationId: string; orderId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Файл не выбран.'); return; }
    const formData = new FormData();
    formData.set('organizationId', organizationId);
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    formData.set('file', file);
    setIsPending(true);
    try {
      const res = await uploadOrganizationDocument(formData);
      if (res.ok) {
        setSuccess(`Документ «${file.name}» отправлен менеджеру.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
      } else {
        setError(ERROR_LABEL_RU[res.error] ?? 'Ошибка загрузки.');
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Отправить документ менеджеру</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <input ref={fileInputRef} type='file' disabled={isPending}
          className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50' />
        <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={isPending}
          className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] disabled:opacity-50'>
          {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type='submit' disabled={isPending}
          className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50'>
          {isPending ? 'Отправляю…' : 'Отправить'}
        </button>
        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
        {success && <p role='status' className='text-sm text-emerald-600'>{success}</p>}
        <p className='text-xs text-gray-400'>PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.</p>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck → PASS**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/organization/documents.ts src/components/organization/organization-document-upload-form.tsx src/__tests__/server-actions.organization.documents.test.ts
git commit -m "feat(documents): organization can upload documents to the manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Partner reverse upload — server-action + UI form

**Files:**
- Create: `src/server-actions/partner/documents.ts` (`uploadPartnerDocument`)
- Create: `src/components/partner/partner-document-upload-form.tsx`
- Test: `src/__tests__/server-actions.partner.documents.test.ts`

- [ ] **Step 1: Write the failing test** (mirror Task 7; session has `partnerId`; order matched on `partnerId`; notify type `document_uploaded_by_partner`):

```ts
import { describe, it, expect, vi } from 'vitest';

const { core, notify, session } = vi.hoisted(() => ({
  core: vi.fn(), notify: vi.fn(),
  session: { sub: 'pu1', role: 'partner', partnerId: 'p1', email: 'p@x.ru', name: 'P' }
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({ notifyManagers: notify }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn().mockResolvedValue(session) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: {
  order: { findUnique: vi.fn() },
  partner: { findUnique: vi.fn() }
} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { uploadPartnerDocument } from '@/server-actions/partner/documents';

const fd = (e: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };
const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

describe('uploadPartnerDocument', () => {
  it('rejects an order that is not the partner’s', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'OTHER', orderNumber: '1', title: 'T' });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('persists incoming partner-channel doc + notifies managers', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'partner', id: 'p1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_partner');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/server-actions.partner.documents.test.ts --mode=unit`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `src/server-actions/partner/documents.ts`**

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyManagers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' };

const schema = z.object({ orderId: z.string().min(1), docType: z.string().min(1) });

export async function uploadPartnerDocument(formData: FormData): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'partner' || !session.partnerId) {
    return { ok: false, error: 'forbidden' };
  }

  const parsed = schema.safeParse({
    orderId: String(formData.get('orderId') ?? ''),
    docType: String(formData.get('docType') ?? 'other')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { id: true, partnerId: true, orderNumber: true, title: true }
  });
  if (!order || order.partnerId !== session.partnerId) {
    return { ok: false, error: 'not_found' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'partner', id: session.partnerId },
    orderId: order.id,
    direction: 'incoming',
    docType: parsed.data.docType,
    uploadedById: session.sub,
    source: 'partner',
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });
  if (!persisted.ok) return persisted;

  try {
    const partner = await prisma.partner.findUnique({
      where: { id: session.partnerId },
      select: { name: true }
    });
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_partner',
      payload: { partnerName: partner?.name ?? 'партнёр', documentName: file.name, documentType: parsed.data.docType }
    });
  } catch (err) {
    console.warn('[uploadPartnerDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  revalidatePath('/partner/documents');
  return { ok: true, documentId: persisted.documentId };
}
```

- [ ] **Step 4: Run the test → PASS**

Run: `npx vitest run src/__tests__/server-actions.partner.documents.test.ts --mode=unit`

- [ ] **Step 5: Create the partner upload form** `src/components/partner/partner-document-upload-form.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadPartnerDocument } from '@/server-actions/partner/documents';

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' }
];

const ERROR_LABEL_RU: Record<string, string> = {
  validation: 'Проверьте поля формы.',
  forbidden: 'Нет прав на загрузку.',
  not_found: 'Заказ не найден.',
  too_large: 'Файл превышает 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.'
};

export function PartnerDocumentUploadForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Файл не выбран.'); return; }
    const formData = new FormData();
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    formData.set('file', file);
    setIsPending(true);
    try {
      const res = await uploadPartnerDocument(formData);
      if (res.ok) {
        setSuccess(`Документ «${file.name}» отправлен менеджеру.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
      } else {
        setError(ERROR_LABEL_RU[res.error] ?? 'Ошибка загрузки.');
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Отправить документ менеджеру</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <input ref={fileInputRef} type='file' disabled={isPending}
          className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50' />
        <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={isPending}
          className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] disabled:opacity-50'>
          {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type='submit' disabled={isPending}
          className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50'>
          {isPending ? 'Отправляю…' : 'Отправить'}
        </button>
        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
        {success && <p role='status' className='text-sm text-emerald-600'>{success}</p>}
        <p className='text-xs text-gray-400'>PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.</p>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck → PASS**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/partner/documents.ts src/components/partner/partner-document-upload-form.tsx src/__tests__/server-actions.partner.documents.test.ts
git commit -m "feat(documents): partner can upload documents to the manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Channel-scoped organization reads (the visibility change)

**Files:**
- Modify: `src/lib/services/organization/documents.ts` (`listOrgDocuments` + `getOrgDocumentForDownload`)
- Modify: `src/lib/services/organization/orders.ts` (`getOrgOrder` per-order `documents` include)
- Modify: `src/__tests__/services.organization.documents.test.ts` (add a partner-channel doc that must NOT leak)

- [ ] **Step 1: Extend the integration test seed + add an isolation case.** In `services.organization.documents.test.ts` `beforeAll`, add one partner-channel doc on order A1:

```ts
  const dCommission = await prisma.document.create({
    data: {
      name: 'commission-A1.pdf', path: 'fake://commission-a1',
      mimeType: 'application/pdf', type: 'commission_statement',
      orderId: orderA1Id,
      counterpartyType: 'partner', counterpartyId: partnerId
    }
  });
  docA1CommissionId = dCommission.id;
```

(declare `let docA1CommissionId: string;` up top). Then **update the existing org-channel seeds** in this file to set `counterpartyType: 'organization', counterpartyId: orgAId` (or `orgBId` for the B doc) — done in Task 1, verify present. Add the assertion:

```ts
  it('does NOT leak partner-channel documents to the organization', async () => {
    const { rows, total } = await listOrgDocuments(prisma, { organizationId: orgAId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(docA1CommissionId);
    expect(total).toBe(3); // contract + act + invoice; commission is partner-channel
  });

  it('download of a partner-channel doc returns not_found for the org', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgAId, docA1CommissionId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
```

Update `afterAll` cleanup to also remove the commission doc — it is already covered by `deleteMany({ where: { order: { partnerId } } })`, so no change needed.

- [ ] **Step 2: Run it to confirm the new cases fail**

Run: `npx vitest run src/__tests__/services.organization.documents.test.ts --mode=integration`
Expected: the two new cases FAIL (current `order:{organizationId}` filter still shows the commission doc).

- [ ] **Step 3: Switch `listOrgDocuments` to the channel filter.** In `src/lib/services/organization/documents.ts`, replace the `orderScope`/`baseWhere` construction:

```ts
import { organizationChannelWhere } from '@/lib/auth/documentChannelPolicy';
// ...
  const dateFilter =
    opts.from || opts.to
      ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
      : {};

  const baseWhere: Prisma.DocumentWhereInput = {
    ...organizationChannelWhere(opts.organizationId),
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
    ...dateFilter,
    ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' as const } } : {})
  };
```

(Add `import type { Prisma } from '@prisma/client'` if not present. The old standalone `...INFECTED_HIDDEN_WHERE` line is now inside `organizationChannelWhere`; remove the separate import/use if it becomes unused.)

- [ ] **Step 4: Switch `getOrgDocumentForDownload` to a channel membership check.** Replace its select + guard:

```ts
import { organizationChannelWhere, documentInChannel } from '@/lib/auth/documentChannelPolicy';
// ...
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true, name: true, path: true, mimeType: true,
      scanStatus: true, scanReason: true,
      counterpartyType: true, counterpartyId: true
    }
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!documentInChannel(doc, { type: 'organization', id: organizationId })) {
    return { ok: false, error: 'not_found' };
  }
  if (doc.scanStatus === 'infected') {
    return { ok: false, error: 'infected', scanReason: doc.scanReason ?? null };
  }
  return { ok: true, path: doc.path, mimeType: doc.mimeType, name: doc.name };
```

- [ ] **Step 4b: Channel-scope the per-order detail embed.** The org order-detail page renders `order.documents` from `getOrgOrder` ([organization/orders.ts:176](../../../src/lib/services/organization/orders.ts)) — a separate read path from the list service. Add the org-channel discriminator to that `documents` include (the order is already org-scoped, so `counterpartyType` alone drops partner-channel docs):

```ts
      documents: {
        where: { counterpartyType: 'organization', scanStatus: { not: 'infected' } },
        orderBy: { createdAt: 'desc' },
        // ...existing select unchanged...
      },
```

- [ ] **Step 5: Run the full org documents test → PASS**

Run: `npx vitest run src/__tests__/services.organization.documents.test.ts --mode=integration`

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/organization/documents.ts src/__tests__/services.organization.documents.test.ts
git commit -m "feat(documents): scope organization reads to the org channel (isolation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Channel-scoped partner reads

**Files:**
- Modify: `src/lib/services/partner/orgDocuments.ts` (`getOrgDocuments`)
- Modify: `src/lib/services/partner/documentsList.ts` (`listPartnerDocuments`)
- Modify: `src/lib/services/partner/dealDetail.ts` (per-order `documents` include)
- Modify: tests `src/__tests__/api.partner.portfolio.org.test.ts` and any partner-docs test that seeds documents (set counterparty in seeds, add an org-channel doc that must NOT leak to the partner).

- [ ] **Step 1: Update/seed tests.** Wherever these services are integration-tested with seeded docs, ensure seeds set counterparty (Task 1) and add an **organization-channel** doc on a partner order that must NOT appear in partner reads. Assertion pattern:

```ts
  it('does NOT leak organization-channel docs to the partner', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(orgChannelDocId);
    expect(ids).toContain(partnerChannelDocId);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/api.partner.portfolio.org.test.ts --mode=integration`
Expected: new case FAILs (current `order:{partnerId,companyId}` shows both channels).

- [ ] **Step 3: Switch `getOrgDocuments` (per-org portfolio) to partner channel + org scope.** In `src/lib/services/partner/orgDocuments.ts`:

```ts
import { partnerChannelWhere } from '@/lib/auth/documentChannelPolicy';
// ... keep the org ownership guard (org.partnerId === filter.partnerId && org.companyId) ...
  const docWhere = {
    ...partnerChannelWhere(filter.partnerId),
    order: { organizationId: filter.orgId },
    ...(filter.type ? { type: filter.type } : {})
  };
  // use docWhere in findMany + groupBy (replace the old `order: orderFilter, ...INFECTED_HIDDEN_WHERE`)
```

Remove the now-unused `orderFilter` and the standalone `INFECTED_HIDDEN_WHERE` spread (it lives inside `partnerChannelWhere`). The `org` lookup/guard at the top stays.

- [ ] **Step 4: Switch `listPartnerDocuments` (all docs) to partner channel.** In `src/lib/services/partner/documentsList.ts`:

```ts
import { partnerChannelWhere } from '@/lib/auth/documentChannelPolicy';
// Channel scoping already restricts to this partner — keep optional per-user
// org assignment as an extra narrowing.
  const orgScope =
    filter.scopeOrgIds && filter.scopeOrgIds.length > 0
      ? { order: { organizationId: { in: filter.scopeOrgIds } } }
      : {};

  const docWhere = {
    ...partnerChannelWhere(filter.partnerId),
    ...orgScope,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {})
  };
```

Delete the now-unused `organization.findMany`/`companyIds` block and the `companyIds.length === 0` early-return (channel scoping replaces it). The `groupBy` where must use the same `partnerChannelWhere(filter.partnerId)` + `orgScope` + search (without `type`).

- [ ] **Step 4b: Channel-scope the partner deal-detail embed.** The partner deal page renders the order's documents via `getDealDetail` ([partner/dealDetail.ts:48](../../../src/lib/services/partner/dealDetail.ts)). Add the partner-channel discriminator to that `documents` include (`args.partnerId` is already in scope from the deal lookup):

```ts
      documents: {
        where: { counterpartyType: 'partner', counterpartyId: args.partnerId, scanStatus: { not: 'infected' } },
        orderBy: { createdAt: 'desc' },
        // ...existing select unchanged...
      },
```

- [ ] **Step 5: Run partner tests + typecheck → PASS**

Run: `npx vitest run src/__tests__/api.partner.portfolio.org.test.ts src/__tests__/services.organization.documents.test.ts --mode=integration`
Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/partner/orgDocuments.ts src/lib/services/partner/documentsList.ts src/__tests__
git commit -m "feat(documents): scope partner reads to the partner channel (isolation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Channel-guard the generic download route (`canReadDocument`)

The partner cabinet downloads through the generic `POST /api/documents/[id]/download` route, which gates on `canReadDocument` ([policy.ts:78](../../../src/lib/auth/policy.ts)). Today that helper is purely company/role-based — a partner can fetch an **organization-channel** document by id (the partner list no longer shows it after Task 10, but the download endpoint must enforce too — CLAUDE.md §4 defense-in-depth). The org cabinet uses its own channel-checked route (Task 9), so this closes the last client-side download hole. Managers/admins are unchanged (they see both channels within their order scope).

**Files:**
- Modify: `src/lib/auth/policy.ts` (`DocumentLike` type + `canReadDocument`)
- Modify: `src/__tests__/auth.policy.partner-scope.test.ts` (existing fixtures gain counterparty)
- Test: `src/__tests__/auth.policy.document-channel.test.ts` (new)

- [ ] **Step 1: Write the failing unit test** `src/__tests__/auth.policy.document-channel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    organization: { findFirst: vi.fn(), findMany: vi.fn() },
    document: { findUnique: vi.fn() },
    order: { findUnique: vi.fn() }
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { canReadDocument } from '@/lib/auth/policy';

const partnerSession = { sub: 'pu', role: 'partner', partnerId: 'p1' } as never;
const orgSession = { sub: 'ou', role: 'organization', organizationId: 'org1' } as never;

describe('canReadDocument — channel isolation', () => {
  it('denies a partner reading an organization-channel document (no order lookup)', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'organization', counterpartyId: 'org1' };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
    expect(db.organization.findFirst).not.toHaveBeenCalled();
  });

  it('allows a partner reading its own partner-channel document', async () => {
    db.organization.findFirst.mockResolvedValue({ id: 'org1' });
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner', counterpartyId: 'p1' };
    expect(await canReadDocument(partnerSession, doc)).toBe(true);
  });

  it('denies a partner reading another partner’s document', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner', counterpartyId: 'pX' };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
  });

  it('denies an organization reading a partner-channel document', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner', counterpartyId: 'p1' };
    expect(await canReadDocument(orgSession, doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/__tests__/auth.policy.document-channel.test.ts --mode=unit`
Expected: the "denies" cases FAIL (no channel guard yet).

- [ ] **Step 3: Extend `DocumentLike` + `canReadDocument`** in `src/lib/auth/policy.ts`:

```ts
type DocumentLike = {
  id: string;
  orderId: string;
  order?: { companyId: string };
  counterpartyType?: 'organization' | 'partner';
  counterpartyId?: string;
};

export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  const doc =
    document.order?.companyId && document.counterpartyType && document.counterpartyId
      ? document
      : await prisma.document.findUnique({
          where: { id: document.id },
          select: {
            id: true,
            orderId: true,
            counterpartyType: true,
            counterpartyId: true,
            order: { select: { companyId: true } }
          }
        });

  if (!doc?.order?.companyId) return false;

  // Channel isolation for client roles (defense-in-depth at the download gate):
  // a partner reads only its partner-channel; an organization only org-channel.
  // Managers/admins see both channels within their order scope (unchanged).
  if (session.role === 'partner') {
    if (doc.counterpartyType !== 'partner' || doc.counterpartyId !== session.partnerId) return false;
  } else if (session.role === 'organization') {
    if (doc.counterpartyType !== 'organization') return false;
  }

  return canReadOrder(session, { id: doc.orderId, companyId: doc.order.companyId });
}
```

(The generic download route fetches the document with `include`, which returns the new `counterpartyType`/`counterpartyId` scalars automatically, so the fast path is taken there — no extra query.)

- [ ] **Step 4: Repair existing partner-scope fixtures.** In `src/__tests__/auth.policy.partner-scope.test.ts`, every document object passed to `canReadDocument` in an **expected-allowed** partner case must now include `counterpartyType: 'partner'` and `counterpartyId` equal to that session's `partnerId` (otherwise the new guard denies it). Run the file in the mode it already uses (it is integration iff it contains `new PrismaClient(`, else unit) and fix any allowed case that now returns false:

Run: `npx vitest run src/__tests__/auth.policy.partner-scope.test.ts --mode=unit`
(if it constructs `PrismaClient`, use `--mode=integration` and a live DB)

- [ ] **Step 5: Run the new test + typecheck → PASS**

Run: `npx vitest run src/__tests__/auth.policy.document-channel.test.ts --mode=unit`
Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/policy.ts src/__tests__/auth.policy.document-channel.test.ts src/__tests__/auth.policy.partner-scope.test.ts
git commit -m "fix(documents): channel-guard canReadDocument (partner download isolation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Document list — direction badge

**Files:**
- Modify: `src/components/partner/documents-list.tsx` (shared list renderer)

- [ ] **Step 1: Add a direction badge.** In the meta line of each row (after the type `<span>`), add:

```tsx
                <span aria-hidden>·</span>
                <span className={doc.direction === 'incoming' ? 'text-blue-700' : 'text-gray-500'}>
                  {doc.direction === 'incoming' ? 'Входящий' : 'Исходящий'}
                </span>
```

(`OrgDocumentRow` already carries `direction`; no type change needed. The label is viewer-neutral: outgoing = manager→client, incoming = client→manager.)

- [ ] **Step 2: Typecheck + build the affected route compiles**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/components/partner/documents-list.tsx
git commit -m "feat(documents): show document direction badge in the shared list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Integration invariant — channel isolation (linchpin)

**Files:**
- Create: `src/__tests__/services.document-channel-isolation.test.ts`

- [ ] **Step 1: Write the invariant test.** Seeds one order shared by an org and a partner, one doc per channel, then asserts cross-channel reads are blocked in both directions:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgDocuments, getOrgDocumentForDownload } from '@/lib/services/organization/documents';
import { getOrgDocuments } from '@/lib/services/partner/orgDocuments';

let prisma: PrismaClient;
let partnerId: string, companyId: string, orgId: string, orderId: string;
let orgDocId: string, partnerDocId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();
  const partner = await prisma.partner.create({ data: { name: `IsoP-${stamp}`, commissionRate: 0.1 } });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `IsoC-${stamp}` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `IsoO-${stamp}`, partnerId, companyId } });
  orgId = org.id;
  const order = await prisma.order.create({
    data: { title: 'Iso order', companyId, partnerId, organizationId: orgId, executionStatus: 'in_progress' }
  });
  orderId = order.id;

  const od = await prisma.document.create({
    data: {
      name: 'act.pdf', path: 'fake://iso-act', mimeType: 'application/pdf', type: 'act',
      orderId, counterpartyType: 'organization', counterpartyId: orgId
    }
  });
  orgDocId = od.id;
  const pd = await prisma.document.create({
    data: {
      name: 'commission.pdf', path: 'fake://iso-commission', mimeType: 'application/pdf', type: 'commission_statement',
      orderId, counterpartyType: 'partner', counterpartyId: partnerId
    }
  });
  partnerDocId = pd.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { orderId } });
  await prisma.order.delete({ where: { id: orderId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('channel isolation invariant (org ⟂ partner on a shared order)', () => {
  it('organization sees only its channel', async () => {
    const { rows } = await listOrgDocuments(prisma, { organizationId: orgId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgDocId);
    expect(ids).not.toContain(partnerDocId);
  });

  it('organization cannot download the partner-channel doc (silent not_found)', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgId, partnerDocId);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('partner sees only its channel', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocId);
    expect(ids).not.toContain(orgDocId);
  });
});
```

- [ ] **Step 1b: Also cover the order-detail embed.** Import `getOrgOrder` from `@/lib/services/organization/orders` and add a case asserting the per-order detail path isolates too:

```ts
  it('order-detail embed isolates channels too', async () => {
    const order = await getOrgOrder(prisma, orgId, orderId);
    const ids = (order?.documents ?? []).map((d: { id: string }) => d.id);
    expect(ids).toContain(orgDocId);
    expect(ids).not.toContain(partnerDocId);
  });
```

- [ ] **Step 2: Run it → PASS** (Tasks 9-10 already implement the behavior; this test pins the invariant against future regressions).

Run: `npx vitest run src/__tests__/services.document-channel-isolation.test.ts --mode=integration`

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.document-channel-isolation.test.ts
git commit -m "test(documents): lock channel isolation invariant (org vs partner)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Mount the reverse-upload forms on the order-detail pages

The forms from Tasks 7-8 need a home so clients can actually upload. Mount them on the existing order-detail pages (the manager form is itself currently unmounted — out of scope here).

**Files:**
- Modify: `src/app/organization/orders/[id]/page.tsx`
- Modify: `src/app/partner/deals/[id]/page.tsx`

- [ ] **Step 1: Org order-detail.** In `src/app/organization/orders/[id]/page.tsx`, import the form and render it inside the «Документы» card, right after `<DocumentsList ... />` (~line 89). `ctx.activeOrgId` and `order.id` are already in scope:

```tsx
import { OrganizationDocumentUploadForm } from '@/components/organization/organization-document-upload-form';
// ...inside the Документы card, after </DocumentsList>:
              <OrganizationDocumentUploadForm organizationId={ctx.activeOrgId} orderId={order.id} />
```

- [ ] **Step 2: Partner deal-detail.** In `src/app/partner/deals/[id]/page.tsx`, import `PartnerDocumentUploadForm` and render it next to that page's documents list, passing `orderId={id}` where `id` is the deal id resolved from `params` (the same value passed to `getDealDetail`):

```tsx
import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';
// ...next to the page's <DocumentsList ... />:
              <PartnerDocumentUploadForm orderId={id} />
```

- [ ] **Step 3: Typecheck + build → PASS**

Run: `npm run typecheck && npm run build`

- [ ] **Step 4: Commit**

```bash
git add "src/app/organization/orders/[id]/page.tsx" "src/app/partner/deals/[id]/page.tsx"
git commit -m "feat(documents): mount reverse-upload forms on order-detail pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before PR)

- [ ] **Full unit layer:** `npm run test:unit` → all green.
- [ ] **Full integration layer (live PG):** `npm run gate` (ephemeral Docker PG + migrate + seed + integration) → green. If `:5432` is busy on a dev box, run `npm run test:integration` against the local DB instead.
- [ ] **Typecheck + lint + build:** `npm run typecheck && npm run lint && npm run build`.
- [ ] **Wire-up smoke (manual, optional):** confirm the new upload forms are mounted on the order-detail pages of the org and partner cabinets (the forms exist; mounting them on the per-order pages is a thin wiring step — add `<OrganizationDocumentUploadForm organizationId={…} orderId={…} />` / `<PartnerDocumentUploadForm orderId={…} />` where the per-order document block renders, mirroring where `ManagerDocUploadForm` is mounted in the manager order page).

---

## Notes carried to Phase B (do NOT implement here)

- `orderId` → `String?` migration + the `d.order?.…` null-cascade across read services, row types, and the shared list component.
- Order-less "Общие документы" surfaces (org/partner tabs) + manager/admin counterparty view + order-less upload.
- Manager↔partner scope for order-less partner-channel docs = **company-wide** (derive the partner's company via `Partner.organizations[].companyId` / orders; union if multiple).
- Review/deprecate the legacy `/api/documents/upload` route — it now writes org-channel by default but predates the channel model and the 20 MB/typed-upload contract.
