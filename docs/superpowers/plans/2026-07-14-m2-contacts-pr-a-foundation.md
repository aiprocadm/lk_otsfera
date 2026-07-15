# M2 Contacts — PR-A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the person we communicate with" a first-class `Contact` with a `ContactChannel` index, rewire inbound/call attribution to resolve against it, add the missing manual triage for unresolved calls, teach the system to capture channels on manual link (learn-on-link), and source click-to-call's internal number from `User.internalPhone`.

**Architecture:** Additive Prisma model (`Contact`, `ContactChannel`) + nullable columns on `Order`/`User`/`InboundMessage`/`Call`. A single canonical phone normalizer replaces three divergent ones. A shared `resolveContactByChannel` becomes the first resolution step inside the existing `resolveInboundSender`/`resolveCaller` (both keep their `User`/`Lead` fallbacks — pure improvement, no flag). Triage server-actions mirror the existing `bindInboundMessageAction`. This is PR-A of two; PR-B adds the directory, contact card, org-card "People" tab, deal-card contact block, and lead-promotion wiring.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript 5 (strict) · Prisma 5 + PostgreSQL · Vitest (mode-partitioned unit/integration) · project `Result`-contract services (CLAUDE.md §3).

**Spec:** [docs/superpowers/specs/2026-07-14-m2-contacts-design.md](../specs/2026-07-14-m2-contacts-design.md). Stacked on M1 (branch `claude/m1-deal-activity-spec`; this worktree branch `claude/m2-contacts` descends from it).

**Conventions the worker MUST follow (from CLAUDE.md):**
- Services live in `src/lib/services/**`, return `{ ok: true, ... } | { ok: false, error: <stable-code> }`, never import from `app/`/`components/`.
- RBAC defense-in-depth; `companyId` is the C8 isolation boundary; pass `teamMode` explicitly (omitting it = silently scoped).
- Every logical-layer file must stay at 100% coverage (`npm run test:coverage`); any `/* v8 ignore */` needs a reason comment.
- Logging only via `@/lib/logging`; no raw `console.*`.
- Integration test ⟺ its source contains `new PrismaClient(` (auto-detected mode). `fileParallelism: false` is intentional; stamp externalIds/emails with a per-file unique prefix and clean up.
- Mock pattern: `const { x } = vi.hoisted(() => ({ x: vi.fn() }))` + `vi.mock('@/lib/...', () => ({ x }))`.

---

## Task 0: Worktree environment setup + clean baseline

**Files:** none (environment only).

- [ ] **Step 1: Copy env from a sibling checkout and install deps**

This worktree has no `node_modules`/`.env`. Copy `.env` from the main checkout (two levels up) and install.

Run (from the worktree root):
```bash
cp "../../../.env" .env 2>/dev/null || cp "../../.env" .env
npm ci
npm run prisma:generate
```
Expected: `.env` exists; `npm ci` completes; Prisma Client generated. If `.env` is not found at either path, ask the user for the correct path — do NOT invent DB credentials.

- [ ] **Step 2: Verify a clean unit baseline**

Run: `npm run test:unit`
Expected: PASS (all unit tests green). If failures exist that are unrelated to M2, report them and ask whether to proceed.

- [ ] **Step 3: Confirm Postgres reachable for integration tests**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!" If Postgres is not reachable, integration steps in later tasks will fail — surface this now (see memory: local Docker PG on `localhost:5432`, or override to `15432`).

---

## Task 1: Schema — `Contact`, `ContactChannel`, additive columns, migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_m2_contacts_foundation/migration.sql`
- Test: `src/__tests__/schema.m2-contacts.integration.test.ts`

- [ ] **Step 1: Add the enum and two models to `prisma/schema.prisma`**

Add near the other enums:
```prisma
enum ContactChannelType {
  phone
  email
  telegram
  whatsapp
  max
}
```

Add two new models (place after the `Call` model for locality):
```prisma
model Contact {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  companyId      String
  company        Company  @relation("CompanyContacts", fields: [companyId], references: [id], onDelete: Cascade)
  organizationId String?
  organization   Organization? @relation("OrgContacts", fields: [organizationId], references: [id], onDelete: SetNull)
  userId         String?  @unique
  user           User?    @relation("UserContact", fields: [userId], references: [id], onDelete: SetNull)
  name           String
  position       String?
  note           String?
  isArchived     Boolean  @default(false)
  createdById    String?
  createdBy      User?    @relation("ContactCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)

  channels        ContactChannel[]
  inboundMessages InboundMessage[] @relation("ContactInbound")
  calls           Call[]           @relation("ContactCalls")
  ordersAsPrimary Order[]          @relation("OrderPrimaryContact")

  @@index([companyId, organizationId])
  @@index([organizationId])
}

model ContactChannel {
  id              String             @id @default(cuid())
  createdAt       DateTime           @default(now())
  contactId       String
  contact         Contact            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  companyId       String
  type            ContactChannelType
  value           String
  normalizedValue String
  isPrimary       Boolean            @default(false)

  @@unique([companyId, type, normalizedValue])
  @@index([type, normalizedValue])
  @@index([contactId])
}
```

- [ ] **Step 2: Add additive nullable columns + back-relations to existing models**

In `model Order { ... }` add:
```prisma
  primaryContactId String?
  primaryContact   Contact? @relation("OrderPrimaryContact", fields: [primaryContactId], references: [id], onDelete: SetNull)
```
In `model User { ... }` add the scalar field and back-relations:
```prisma
  internalPhone     String?
  contact           Contact?  @relation("UserContact")
  contactsCreated   Contact[] @relation("ContactCreatedBy")
```
In `model InboundMessage { ... }` add:
```prisma
  contactId String?
  contact   Contact? @relation("ContactInbound", fields: [contactId], references: [id], onDelete: SetNull)
```
In `model Call { ... }` add:
```prisma
  contactId String?
  contact   Contact? @relation("ContactCalls", fields: [contactId], references: [id], onDelete: SetNull)
```
In `model Organization { ... }` add:
```prisma
  contacts Contact[] @relation("OrgContacts")
```
In `model Company { ... }` add:
```prisma
  contacts Contact[] @relation("CompanyContacts")
```

- [ ] **Step 3: Generate the migration and client**

Run: `npx prisma migrate dev --name m2_contacts_foundation`
Expected: a new migration folder is created, applied to the dev DB, and Prisma Client regenerates with no errors. The migration must be **purely additive** (new tables + new nullable columns + new indexes) — inspect `migration.sql` and confirm there is **no** `DROP`/`ALTER ... SET NOT NULL` on existing columns.

- [ ] **Step 4: Write the failing smoke integration test**

```ts
// src/__tests__/schema.m2-contacts.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STAMP = `m2sc${Date.now()}`;

afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('M2 Contact schema', () => {
  it('creates a Contact with a channel; per-company uniqueness holds', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const contact = await prisma.contact.create({
      data: { companyId: company.id, name: `${STAMP}-Иван`, channels: { create: [{ companyId: company.id, type: 'phone', value: `${STAMP}+79990001122`, normalizedValue: '+79990001122', isPrimary: true }] } },
      include: { channels: true }
    });
    expect(contact.channels).toHaveLength(1);
    expect(contact.organizationId).toBeNull();

    // Same (company,type,normalizedValue) → unique violation
    await expect(
      prisma.contactChannel.create({ data: { contactId: contact.id, companyId: company.id, type: 'phone', value: 'dup', normalizedValue: '+79990001122' } })
    ).rejects.toThrow();

    // Different company, same normalizedValue → allowed (no cross-company leak)
    const company2 = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
    const contact2 = await prisma.contact.create({ data: { companyId: company2.id, name: `${STAMP}-Пётр` } });
    const ok = await prisma.contactChannel.create({ data: { contactId: contact2.id, companyId: company2.id, type: 'phone', value: `${STAMP}b`, normalizedValue: '+79990001122' } });
    expect(ok.id).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the test — expect PASS (schema already migrated in Step 3)**

Run: `npx vitest run src/__tests__/schema.m2-contacts.integration.test.ts`
Expected: PASS. If the uniqueness assertion fails, re-check the `@@unique([companyId, type, normalizedValue])` line.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/__tests__/schema.m2-contacts.integration.test.ts
git commit -m "feat(m2): Contact + ContactChannel schema (per-company channel uniqueness) + additive columns"
```

---

## Task 2: Unified phone normalizer

**Files:**
- Create: `src/lib/phone/normalize.ts`
- Test: `src/__tests__/phone.normalize.unit.test.ts`
- Modify: `src/lib/services/inbound/resolve.ts`, `src/lib/services/telephony/resolveCaller.ts`, `src/lib/services/notifications/preferences.ts`
- Modify tests: `src/__tests__/inbound.resolve.test.ts` (the `normalizePhone('8 …')` expectation changes — this is the bug fix)

- [ ] **Step 1: Write the failing normalizer test**

```ts
// src/__tests__/phone.normalize.unit.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

describe('normalizePhoneCanonical', () => {
  it('canonicalizes RU national 8XXXXXXXXXX (11 digits) → +7XXXXXXXXXX', () => {
    expect(normalizePhoneCanonical('8 (999) 000-11-22')).toBe('+79990001122');
    expect(normalizePhoneCanonical('89990001122')).toBe('+79990001122');
  });
  it('passes through already-canonical +7 numbers, stripping formatting', () => {
    expect(normalizePhoneCanonical('+7 (999) 000-11-22')).toBe('+79990001122');
  });
  it('non-RU / non-11-digit: strip to digits, prefix +', () => {
    expect(normalizePhoneCanonical('+1 202 555 0100')).toBe('+12025550100');
    expect(normalizePhoneCanonical('8005553535')).toBe('+8005553535'); // 10 digits, not the 11-digit RU pattern
  });
  it('empty / no digits → empty string', () => {
    expect(normalizePhoneCanonical('---')).toBe('');
    expect(normalizePhoneCanonical('')).toBe('');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `npx vitest run src/__tests__/phone.normalize.unit.test.ts`
Expected: FAIL — cannot resolve `@/lib/phone/normalize`.

- [ ] **Step 3: Implement the canonical normalizer**

```ts
// src/lib/phone/normalize.ts
/**
 * Единый канон телефонов для хранения и матчинга (M2). Заменяет три
 * расходящихся нормализатора (inbound/resolve, telephony/resolveCaller,
 * notifications/preferences). RU-национальный 8XXXXXXXXXX (11 цифр) → +7XXXXXXXXXX;
 * иначе — только цифры с ведущим '+'. Пустой ввод → ''.
 */
export function normalizePhoneCanonical(raw: string): string {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  return `+${digits}`;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/__tests__/phone.normalize.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Point the three existing normalizers at the canonical one**

In `src/lib/services/inbound/resolve.ts` replace the body of `normalizePhone` (keep the export name for compatibility):
```ts
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
// ...
/** @deprecated use normalizePhoneCanonical; kept as a thin alias (M2 unification). */
export function normalizePhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}
```
In `src/lib/services/telephony/resolveCaller.ts` replace `canonicalizeRuPhone`:
```ts
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
// ...
/** @deprecated use normalizePhoneCanonical; kept as a thin alias (M2 unification). */
export function canonicalizeRuPhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}
```
In `src/lib/services/notifications/preferences.ts` change its local `normalizePhone` (returns `string | null`) to delegate, preserving its null-on-empty contract:
```ts
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
// ...
export function normalizePhone(raw: string): string | null {
  const n = normalizePhoneCanonical(raw);
  return n === '' ? null : n;
}
```

- [ ] **Step 6: Fix the behaviour-changed regression in `inbound.resolve.test.ts`**

The old `normalizePhone('8 (999) 000-11-22')` returned `'+89990001122'` (bug). It now canonicalizes to `'+79990001122'`. Update that assertion (this is the intended fix):
```ts
// src/__tests__/inbound.resolve.test.ts  (the normalizePhone test)
expect(normalizePhone('---')).toBe('');
expect(normalizePhone('8 (999) 000-11-22')).toBe('+79990001122'); // canonicalized (M2 fix)
```

- [ ] **Step 7: Run the affected suites — expect PASS**

Run: `npx vitest run src/__tests__/phone.normalize.unit.test.ts src/__tests__/inbound.resolve.test.ts`
Then run the notifications preferences test file (find it): `npx vitest run src/__tests__/ -t "normalizePhone"`
Expected: PASS. If a notifications test asserted `normalizePhone('')` behaviour, confirm it still expects `null`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/phone/normalize.ts src/__tests__/phone.normalize.unit.test.ts src/lib/services/inbound/resolve.ts src/lib/services/telephony/resolveCaller.ts src/lib/services/notifications/preferences.ts src/__tests__/inbound.resolve.test.ts
git commit -m "refactor(m2): single canonical phone normalizer (fixes latent 8→+7 attribution mismatch)"
```

---

## Task 3: `resolveContactByChannel` service

**Files:**
- Create: `src/lib/services/contacts/resolveContactByChannel.ts`
- Test: `src/__tests__/contacts.resolveByChannel.test.ts`

- [ ] **Step 1: Write the failing test (mocked prisma, unit)**

```ts
// src/__tests__/contacts.resolveByChannel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';

function db(rows: any[]) {
  return { contactChannel: { findMany: vi.fn(async () => rows) } } as any;
}
const chan = (over: any = {}) => ({ contact: { id: 'k1', organizationId: 'o1', companyId: 'c1', userId: 'u1', isArchived: false }, ...over });

describe('resolveContactByChannel', () => {
  it('exact single channel → contact + derived org/company/user', async () => {
    const r = await resolveContactByChannel(db([chan()]), { type: 'telegram', value: '123' });
    expect(r).toEqual({ contactId: 'k1', organizationId: 'o1', companyId: 'c1', userId: 'u1' });
  });
  it('no match → null', async () => {
    expect(await resolveContactByChannel(db([]), { type: 'email', value: 'x@y.z' })).toBeNull();
  });
  it('ambiguous (>1, e.g. cross-company) → null (never guess)', async () => {
    const r = await resolveContactByChannel(db([chan(), chan({ contact: { id: 'k2', organizationId: 'o2', companyId: 'c2' } })]), { type: 'phone', value: '+79990001122' });
    expect(r).toBeNull();
  });
  it('archived contact is ignored', async () => {
    const r = await resolveContactByChannel(db([chan({ contact: { id: 'k1', organizationId: 'o1', companyId: 'c1', isArchived: true } })]), { type: 'phone', value: '+7999' });
    expect(r).toBeNull();
  });
  it('call resolution searches phone-like types {phone, whatsapp}', async () => {
    const d = db([chan({ type: 'whatsapp' })]);
    await resolveContactByChannel(d, { type: 'phone', value: '+79990001122', phoneLike: true });
    expect(d.contactChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: { in: ['phone', 'whatsapp'] }, normalizedValue: '+79990001122' }) })
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npx vitest run src/__tests__/contacts.resolveByChannel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/services/contacts/resolveContactByChannel.ts
import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

export type ChannelResolution = {
  contactId: string;
  organizationId: string | null;
  companyId: string;
  userId?: string;
};

/** Normalize a raw channel value the same way it is stored (Task 4 storage path). */
export function normalizeChannelValue(type: ContactChannelType, value: string): string {
  if (type === 'phone' || type === 'whatsapp') return normalizePhoneCanonical(value);
  if (type === 'email') return value.trim().toLowerCase();
  return value.trim(); // telegram/max: chatId as-is (learn-on-link key)
}

/**
 * Resolve a communication identity to a Contact via ContactChannel. Exactly-one
 * or null (ambiguous/absent → null; never guesses — mirrors resolve.ts/resolveCaller.ts).
 * `phoneLike` widens a voice-call lookup to both {phone, whatsapp} (same number space).
 */
export async function resolveContactByChannel(
  prisma: PrismaClient,
  input: { type: ContactChannelType; value: string; phoneLike?: boolean }
): Promise<ChannelResolution | null> {
  const normalizedValue = normalizeChannelValue(input.type, input.value);
  if (!normalizedValue) return null;
  const typeFilter = input.phoneLike ? { in: ['phone', 'whatsapp'] as ContactChannelType[] } : input.type;

  const rows = await prisma.contactChannel.findMany({
    where: { type: typeFilter, normalizedValue, contact: { is: { isArchived: false } } },
    select: { contact: { select: { id: true, organizationId: true, companyId: true, userId: true } } },
    take: 2,
  });
  if (rows.length !== 1) return null;
  const c = rows[0].contact;
  return { contactId: c.id, organizationId: c.organizationId, companyId: c.companyId, ...(c.userId ? { userId: c.userId } : {}) };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/__tests__/contacts.resolveByChannel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/contacts/resolveContactByChannel.ts src/__tests__/contacts.resolveByChannel.test.ts
git commit -m "feat(m2): resolveContactByChannel — channel→contact index (exactly-one, phone-like for calls)"
```

---

## Task 4: Contact service core — `createContact` + `captureChannel` (learn-on-link helper)

**Files:**
- Create: `src/lib/services/manager/contacts.ts`
- Test: `src/__tests__/contacts.service.integration.test.ts`

**Note:** PR-A only needs create + channel-capture (for triage and learn-on-link). `listContacts`/`getContact`/`updateContact`/`archiveContact` are PR-B. Signatures follow CLAUDE.md §3.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/contacts.service.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createContact, captureChannel } from '@/lib/services/manager/contacts';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `m2cs${Date.now()}`;
const session = (companyId: string): SessionPayload => ({ sub: 'mgr1', role: 'manager', companyId, managedOrgIds: [] } as any);

afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('contacts service', () => {
  it('createContact: org-less contact scoped to company, normalizes channel values', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const r = await createContact(prisma, session(co.id), {
      name: `${STAMP}-Иван`, channels: [{ type: 'phone', value: '8 (999) 000-11-22' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await prisma.contact.findUnique({ where: { id: r.contactId }, include: { channels: true } });
    expect(row?.companyId).toBe(co.id);
    expect(row?.organizationId).toBeNull();
    expect(row?.channels[0].normalizedValue).toBe('+79990001122');
    expect(row?.channels[0].isPrimary).toBe(true); // first channel is primary
  });

  it('createContact rejects a session without companyId', async () => {
    const r = await createContact(prisma, session(null as any), { name: `${STAMP}-x`, channels: [] });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('captureChannel is idempotent and de-dupes on (company,type,normalizedValue)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
    const c = await prisma.contact.create({ data: { companyId: co.id, name: `${STAMP}-Пётр` } });
    await captureChannel(prisma, { contactId: c.id, companyId: co.id, type: 'telegram', value: 'tg-777' });
    await captureChannel(prisma, { contactId: c.id, companyId: co.id, type: 'telegram', value: 'tg-777' });
    const chans = await prisma.contactChannel.findMany({ where: { contactId: c.id } });
    expect(chans).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npx vitest run src/__tests__/contacts.service.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `createContact` + `captureChannel`**

```ts
// src/lib/services/manager/contacts.ts
import type { PrismaClient, Prisma, ContactChannelType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { recordAudit } from '@/lib/auth/audit';

export type ContactChannelInput = { type: ContactChannelType; value: string };
export type CreateContactArgs = {
  name: string;
  organizationId?: string | null;
  position?: string;
  note?: string;
  channels: ContactChannelInput[];
};
export type CreateContactResult = { ok: true; contactId: string } | { ok: false; error: 'forbidden' | 'invalid' };

export async function createContact(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateContactArgs
): Promise<CreateContactResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const name = args.name.trim();
  if (!name) return { ok: false, error: 'invalid' };

  const channelData: Prisma.ContactChannelCreateWithoutContactInput[] = args.channels
    .map((ch, i) => ({
      companyId: session.companyId!, type: ch.type, value: ch.value.trim(),
      normalizedValue: normalizeChannelValue(ch.type, ch.value), isPrimary: i === 0,
    }))
    .filter((ch) => ch.normalizedValue !== '');

  const contact = await prisma.contact.create({
    data: {
      companyId: session.companyId,
      organizationId: args.organizationId ?? null,
      name, position: args.position?.trim() || null, note: args.note?.trim() || null,
      createdById: session.sub,
      channels: { create: channelData },
    },
    select: { id: true },
  });

  await recordAudit(prisma, { action: 'contact_created', entity: 'contact', entityId: contact.id, userId: session.sub, after: { organizationId: args.organizationId ?? null } });
  return { ok: true, contactId: contact.id };
}

/**
 * Learn-on-link: attach a communication identifier to a contact if not already
 * present. Idempotent — a duplicate (company,type,normalizedValue) is a no-op
 * (P2002 swallowed). Used by triage/bind paths so future comms auto-resolve.
 */
export async function captureChannel(
  prisma: PrismaClient,
  args: { contactId: string; companyId: string; type: ContactChannelType; value: string }
): Promise<void> {
  const normalizedValue = normalizeChannelValue(args.type, args.value);
  if (!normalizedValue) return;
  const exists = await prisma.contactChannel.findFirst({
    where: { companyId: args.companyId, type: args.type, normalizedValue }, select: { id: true },
  });
  if (exists) return;
  try {
    await prisma.contactChannel.create({ data: { contactId: args.contactId, companyId: args.companyId, type: args.type, value: args.value.trim(), normalizedValue } });
  } catch (e) {
    // Concurrent capture of the same value → unique violation is a benign no-op.
    if (!(e instanceof Error && e.message.includes('Unique'))) throw e;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/__tests__/contacts.service.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/manager/contacts.ts src/__tests__/contacts.service.integration.test.ts
git commit -m "feat(m2): contacts service core — createContact + captureChannel (learn-on-link, idempotent)"
```

---

## Task 5: Rewire inbound attribution → contact-first, write `contactId`

**Files:**
- Modify: `src/lib/services/inbound/resolve.ts` (add contactId to `ResolveResult`, try channel first)
- Modify: `src/lib/services/inbound/ingest.ts` (persist `contactId`)
- Modify test: `src/__tests__/inbound.resolve.test.ts` (contact-first cases)
- Test: extend an inbound ingest integration test (find `src/__tests__/*inbound*ingest*integration*` or `inbound.ingest.integration.test.ts`)

- [ ] **Step 1: Write failing unit tests for contact-first resolution**

Add to `src/__tests__/inbound.resolve.test.ts`:
```ts
it('resolves via ContactChannel first (before User); sets contactId', async () => {
  const d = {
    contactChannel: { findMany: vi.fn(async () => [{ contact: { id: 'k1', organizationId: 'o9', companyId: 'c9', userId: null, isArchived: false } }]) },
    user: { findMany: vi.fn(async () => []) },
  } as any;
  const r = await resolveInboundSender(d, { channel: 'telegram', chatId: 'tg-1' });
  expect(r).toMatchObject({ matchType: 'exact', orgId: 'o9', companyId: 'c9', contactId: 'k1' });
  expect(d.user.findMany).not.toHaveBeenCalled(); // contact hit short-circuits
});
it('falls back to User when no contact channel matches', async () => {
  const d = {
    contactChannel: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } }]) },
  } as any;
  const r = await resolveInboundSender(d, { channel: 'telegram', chatId: 'tg-2' });
  expect(r).toMatchObject({ matchType: 'exact', userId: 'u1', orgId: 'o1', contactId: undefined });
});
```
Update the `db()` helper at the top of the file to also stub `contactChannel.findMany` returning `[]` by default so existing User-path tests keep passing:
```ts
function db(users: any[], leads: any[] = [], channels: any[] = []) {
  return {
    contactChannel: { findMany: vi.fn(async () => channels) },
    user: { findMany: vi.fn(async () => users) },
    lead: { findMany: vi.fn(async () => leads) },
  } as any;
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/inbound.resolve.test.ts`
Expected: FAIL on the two new cases (contactId not yet returned).

- [ ] **Step 3: Add `contactId` to `ResolveResult` and try the channel resolver first**

In `src/lib/services/inbound/resolve.ts`:
```ts
import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';
// ...
export type ResolveResult =
  | { matchType: 'exact'; userId?: string; orgId: string; companyId: string; contactId?: string; orderId?: string; threadId?: string }
  | { matchType: 'unresolved'; userId?: undefined; orgId?: undefined; companyId?: undefined; contactId?: undefined; orderId?: undefined; threadId?: undefined };

const CHANNEL_TYPE: Record<ResolveInput['channel'], ContactChannelType> = {
  telegram: 'telegram', max: 'max', whatsapp: 'whatsapp', email: 'email',
};

export async function resolveInboundSender(prisma: PrismaClient, input: ResolveInput): Promise<ResolveResult> {
  // 1) Contact channel first (M2). Value key mirrors what ingest stores as senderRef.
  const value = input.chatId ?? input.phone ?? input.email;
  if (value) {
    const hit = await resolveContactByChannel(prisma, { type: CHANNEL_TYPE[input.channel], value });
    if (hit && hit.organizationId) {
      return { matchType: 'exact', orgId: hit.organizationId, companyId: hit.companyId, contactId: hit.contactId, ...(hit.userId ? { userId: hit.userId } : {}) };
    }
  }

  // 2) Existing User exact-match fallback (unchanged).
  const where: Record<string, unknown> = {};
  if (input.channel === 'telegram' && input.chatId) where.telegramChatId = input.chatId;
  else if (input.channel === 'max' && input.chatId) where.maxChatId = input.chatId;
  else if (input.channel === 'whatsapp' && input.phone) where.whatsappPhone = normalizePhone(input.phone);
  else if (input.channel === 'email' && input.email) where.email = { equals: input.email.trim(), mode: 'insensitive' };
  else return { matchType: 'unresolved' };

  const users = await prisma.user.findMany({ where, select: { id: true, organization: { select: { id: true, companyId: true } } }, take: 2 });
  if (users.length !== 1) return { matchType: 'unresolved' };
  const u = users[0];
  if (!u.organization?.id || !u.organization.companyId) return { matchType: 'unresolved' };
  return { matchType: 'exact', userId: u.id, orgId: u.organization.id, companyId: u.organization.companyId };
}
```
**Note:** a channel match with `organizationId === null` (org-less contact) intentionally does NOT satisfy inbound binding here (inbound needs an org to bind); it falls through to the User path. Add a unit test asserting an org-less contact hit falls through to User.

- [ ] **Step 4: Persist `contactId` in ingest**

In `src/lib/services/inbound/ingest.ts`, extend the `resolved.matchType === 'exact'` data branch:
```ts
...(resolved.matchType === 'exact'
  ? { resolvedOrgId: resolved.orgId, resolvedUserId: resolved.userId ?? null, contactId: resolved.contactId ?? null, companyId: resolved.companyId, status: 'bound', boundAt: new Date() }
  : { status: 'unresolved' }),
```

- [ ] **Step 5: Run unit + ingest integration — expect PASS**

Run: `npx vitest run src/__tests__/inbound.resolve.test.ts`
Then the inbound ingest integration file (add an assertion that a seeded Contact channel sets `contactId` on the created `InboundMessage`).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/inbound/resolve.ts src/lib/services/inbound/ingest.ts src/__tests__/inbound.resolve.test.ts src/__tests__/<inbound-ingest-integration>.test.ts
git commit -m "feat(m2): inbound attribution resolves ContactChannel first; persists contactId"
```

---

## Task 6: Rewire call attribution → contact-first, write `contactId`

**Files:**
- Modify: `src/lib/services/telephony/resolveCaller.ts` (contact-first, phoneLike; add `contactId`)
- Modify: `src/lib/services/telephony/ingestCall.ts` (persist `contactId` in both `summary` and `call` branches)
- Modify tests: `src/__tests__/telephony.resolveCaller*.test.ts` (find it) + `src/__tests__/telephony.ingestCall.integration.test.ts`

- [ ] **Step 1: Write failing unit test for contact-first caller resolution**

Find the existing resolveCaller unit test (`grep -rl "resolveCaller" src/__tests__`). Add:
```ts
it('resolves via ContactChannel (phone-like) before User.whatsappPhone; sets contactId', async () => {
  const d = {
    contactChannel: { findMany: vi.fn(async () => [{ contact: { id: 'k5', organizationId: 'o5', companyId: 'c5', userId: null, isArchived: false } }]) },
    user: { findMany: vi.fn(async () => []) },
    lead: { findMany: vi.fn(async () => []) },
  } as any;
  const r = await resolveCaller(d, '8 (999) 000-33-33');
  expect(r).toMatchObject({ matchType: 'exact', orgId: 'o5', companyId: 'c5', contactId: 'k5' });
  expect(d.user.findMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/<resolveCaller-test>.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement contact-first in `resolveCaller`**

```ts
// src/lib/services/telephony/resolveCaller.ts
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

export type CallerResolution =
  | { matchType: 'exact'; userId?: string; orgId: string; companyId: string; contactId?: string }
  | { matchType: 'unresolved'; userId?: undefined; orgId?: undefined; companyId?: undefined; contactId?: undefined };

export async function resolveCaller(prisma: PrismaClient, phoneRaw: string): Promise<CallerResolution> {
  const phone = normalizePhoneCanonical(phoneRaw);
  if (!phone || phone === '+') return { matchType: 'unresolved' };

  // 1) Contact channel (phone-like {phone, whatsapp}), M2. Org-less contact → fall through.
  const hit = await resolveContactByChannel(prisma, { type: 'phone', value: phone, phoneLike: true });
  if (hit && hit.organizationId) {
    return { matchType: 'exact', orgId: hit.organizationId, companyId: hit.companyId, contactId: hit.contactId, ...(hit.userId ? { userId: hit.userId } : {}) };
  }

  // 2) User.whatsappPhone (unchanged)
  const users = await prisma.user.findMany({ where: { whatsappPhone: phone }, select: { id: true, organization: { select: { id: true, companyId: true } } }, take: 2 });
  if (users.length === 1 && users[0].organization?.id && users[0].organization.companyId) {
    return { matchType: 'exact', userId: users[0].id, orgId: users[0].organization.id, companyId: users[0].organization.companyId };
  }
  if (users.length > 1) return { matchType: 'unresolved' };

  // 3) Lead.clientContactPhone fallback (unchanged)
  const leads = await prisma.lead.findMany({ where: { clientContactPhone: phone }, select: { organizationId: true, organization: { select: { companyId: true } } }, take: 2 });
  if (leads.length === 1 && leads[0].organizationId && leads[0].organization?.companyId) {
    return { matchType: 'exact', orgId: leads[0].organizationId, companyId: leads[0].organization.companyId };
  }
  return { matchType: 'unresolved' };
}
```
Keep the `canonicalizeRuPhone` alias export from Task 2 for any external callers.

- [ ] **Step 4: Persist `contactId` in `ingestCall.ts`**

In both the `summary` and `call` branches, extend `resolvedFields`:
```ts
const resolvedFields =
  resolved.matchType === 'exact'
    ? { resolvedOrgId: resolved.orgId, resolvedUserId: resolved.userId ?? null, contactId: resolved.contactId ?? null, companyId: resolved.companyId }
    : {};
```

- [ ] **Step 5: Run unit + ingestCall integration — expect PASS**

Add to `src/__tests__/telephony.ingestCall.integration.test.ts` a case seeding a `Contact` + phone channel and asserting the ingested `Call.contactId` is set. Run:
`npx vitest run src/__tests__/<resolveCaller-test>.test.ts src/__tests__/telephony.ingestCall.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/telephony/resolveCaller.ts src/lib/services/telephony/ingestCall.ts src/__tests__/<resolveCaller-test>.test.ts src/__tests__/telephony.ingestCall.integration.test.ts
git commit -m "feat(m2): call attribution resolves ContactChannel first (phone-like); persists contactId"
```

---

## Task 7: Backfill contacts from Users(org) + Leads (idempotent, de-duped)

**Files:**
- Create: `src/lib/services/contacts/backfill.ts`
- Modify: `prisma/seed.ts` (invoke backfill at the end, idempotently)
- Test: `src/__tests__/contacts.backfill.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/contacts.backfill.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { backfillContacts } from '@/lib/services/contacts/backfill';

const prisma = new PrismaClient();
const STAMP = `m2bf${Date.now()}`;
afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: STAMP } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('backfillContacts', () => {
  it('seeds contacts from org-role Users and Leads; dedups by channel; is idempotent', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: co.id } });
    await prisma.user.create({ data: { email: `${STAMP}-u@t.local`, name: `${STAMP}-User`, role: 'organization', organizationId: org.id, whatsappPhone: '+79990007777' } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-p` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-c@t.local`, name: 'C', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({ data: { partnerId: partner.id, createdByUserId: creator.id, organizationId: org.id, clientCompanyName: `${STAMP}-Lead`, clientContactName: `${STAMP}-Контакт`, clientContactPhone: '+79990007777', subject: 's' } });

    const first = await backfillContacts(prisma);
    expect(first.contactsCreated).toBeGreaterThanOrEqual(1);
    // The lead's phone equals the user's whatsapp → deduped to one channel row for that number in this company.
    const chans = await prisma.contactChannel.findMany({ where: { companyId: co.id, normalizedValue: '+79990007777' } });
    expect(chans).toHaveLength(1);

    // Idempotent: second run creates nothing new.
    const second = await backfillContacts(prisma);
    expect(second.contactsCreated).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/contacts.backfill.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `backfillContacts`**

```ts
// src/lib/services/contacts/backfill.ts
import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { normalizeChannelValue } from './resolveContactByChannel';
import { log } from '@/lib/logging';

type ChannelSeed = { type: ContactChannelType; value: string };

/**
 * One-time, idempotent backfill of Contact + ContactChannel from existing data.
 * Sources (spec §2.1): org-role Users (whatsapp/telegram/max/email) and Leads
 * (clientContactPhone/Email). Dedup key: (companyId, type, normalizedValue) — a
 * value already present as a channel is skipped, so re-runs create nothing new.
 */
export async function backfillContacts(prisma: PrismaClient): Promise<{ contactsCreated: number; channelsCreated: number }> {
  let contactsCreated = 0;
  let channelsCreated = 0;
  // seen[company][type][normalized] → contactId, seeded from existing channels so re-runs are no-ops.
  const seen = new Map<string, string>();
  const key = (companyId: string, type: ContactChannelType, nv: string) => `${companyId}|${type}|${nv}`;
  for (const ch of await prisma.contactChannel.findMany({ select: { companyId: true, type: true, normalizedValue: true, contactId: true } })) {
    seen.set(key(ch.companyId, ch.type, ch.normalizedValue), ch.contactId);
  }

  async function ensureChannel(companyId: string, contactId: string, seed: ChannelSeed): Promise<void> {
    const nv = normalizeChannelValue(seed.type, seed.value);
    if (!nv) return;
    if (seen.has(key(companyId, seed.type, nv))) return;
    await prisma.contactChannel.create({ data: { contactId, companyId, type: seed.type, value: seed.value, normalizedValue: nv } });
    seen.set(key(companyId, seed.type, nv), contactId);
    channelsCreated++;
  }

  // 1) Users of role organization, with an org that has a company.
  const users = await prisma.user.findMany({
    where: { role: 'organization', organization: { is: { companyId: { not: null } } } },
    select: { id: true, name: true, whatsappPhone: true, telegramChatId: true, maxChatId: true, email: true, organizationId: true, organization: { select: { companyId: true } } },
  });
  for (const u of users) {
    const companyId = u.organization?.companyId;
    if (!companyId) continue;
    const seeds: ChannelSeed[] = [];
    if (u.whatsappPhone) seeds.push({ type: 'whatsapp', value: u.whatsappPhone });
    if (u.telegramChatId) seeds.push({ type: 'telegram', value: u.telegramChatId });
    if (u.maxChatId) seeds.push({ type: 'max', value: u.maxChatId });
    if (u.email) seeds.push({ type: 'email', value: u.email });
    // Skip if every seed value already indexed (user already backfilled).
    const anyNew = seeds.some((s) => !seen.has(key(companyId, s.type, normalizeChannelValue(s.type, s.value))));
    if (!anyNew) continue;
    const contact = await prisma.contact.create({ data: { companyId, organizationId: u.organizationId, userId: u.id, name: u.name } });
    contactsCreated++;
    for (const s of seeds) await ensureChannel(companyId, contact.id, s);
  }

  // 2) Leads with contact data.
  const leads = await prisma.lead.findMany({
    where: { OR: [{ clientContactPhone: { not: null } }, { clientContactEmail: { not: null } }] },
    select: { id: true, clientContactName: true, clientContactPhone: true, clientContactEmail: true, organizationId: true, organization: { select: { companyId: true } } },
  });
  for (const l of leads) {
    const companyId = l.organization?.companyId;
    if (!companyId) continue; // org-less-company lead: skip (no isolation boundary). Note in log.
    const seeds: ChannelSeed[] = [];
    if (l.clientContactPhone) seeds.push({ type: 'phone', value: l.clientContactPhone });
    if (l.clientContactEmail) seeds.push({ type: 'email', value: l.clientContactEmail });
    const newSeeds = seeds.filter((s) => !seen.has(key(companyId, s.type, normalizeChannelValue(s.type, s.value))));
    if (newSeeds.length === 0) continue; // all channels already exist → deduped, no new contact
    const contact = await prisma.contact.create({ data: { companyId, organizationId: l.organizationId, name: l.clientContactName || 'Контакт' } });
    contactsCreated++;
    for (const s of newSeeds) await ensureChannel(companyId, contact.id, s);
  }

  log.info('[contacts/backfill] complete', { contactsCreated, channelsCreated });
  return { contactsCreated, channelsCreated };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/__tests__/contacts.backfill.integration.test.ts`
Expected: PASS (including idempotency + dedup assertions).

- [ ] **Step 5: Wire into seed idempotently**

At the end of `prisma/seed.ts`, after all other seeding:
```ts
import { backfillContacts } from '@/lib/services/contacts/backfill';
// ... inside the seed main(), last:
const bf = await backfillContacts(prisma);
console.log(`[seed] contacts backfill: +${bf.contactsCreated} contacts, +${bf.channelsCreated} channels`);
```
(If `prisma/seed.ts` cannot use the `@/` alias, use a relative import `../src/lib/services/contacts/backfill`.)

- [ ] **Step 6: Verify seed runs**

Run: `npm run prisma:seed`
Expected: completes; the backfill line prints; a second `npm run prisma:seed` prints `+0 contacts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/contacts/backfill.ts prisma/seed.ts src/__tests__/contacts.backfill.integration.test.ts
git commit -m "feat(m2): idempotent contacts backfill from org Users + Leads (dedup by channel)"
```

---

## Task 8: `contacts` feature flag (opt-in)

**Files:**
- Modify: `src/lib/featureFlags.ts`
- Modify test: `src/__tests__/featureFlags.test.ts` (or wherever the flag list is asserted)

**Note:** PR-A only introduces the flag + opt-in default (for behavioral gating of triage/create actions in Task 9-11). The three §5 route points (middleware prefix, nav item, `notFoundIfDisabled` on `/manager/contacts`) are added in PR-B when that route exists.

- [ ] **Step 1: Add the flag**

In `src/lib/featureFlags.ts`, add `'contacts'` to `FEATURE_FLAGS` (with a comment) and to `OPT_IN_FLAGS`:
```ts
  // M2: справочник контактов + карточки. Route-флаг: три точки (middleware/nav/route)
  // добавляются в PR-B вместе с /manager/contacts. В PR-A гейтит триаж-действия.
  'contacts',
```
and inside `OPT_IN_FLAGS`:
```ts
  'staff_2fa',
  'contacts',
```

- [ ] **Step 2: Update the flag-list test**

If `src/__tests__/featureFlags.test.ts` asserts the exact `FEATURE_FLAGS` array or opt-in set, add `'contacts'` to the expected values. Run: `npx vitest run src/__tests__/featureFlags.test.ts` — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/featureFlags.ts src/__tests__/featureFlags.test.ts
git commit -m "feat(m2): add opt-in 'contacts' feature flag (route gating lands in PR-B)"
```

---

## Task 9: Call triage — `bindCall` service + `bindCallAction` / `createContactFromCallAction`

**Files:**
- Create: `src/lib/services/telephony/bindCall.ts`
- Create: `src/server-actions/contacts.ts`
- Test: `src/__tests__/telephony.bindCall.integration.test.ts`
- Test: `src/__tests__/server-actions.contacts.test.ts`

- [ ] **Step 1: Write the failing service integration test**

```ts
// src/__tests__/telephony.bindCall.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { bindCall } from '@/lib/services/telephony/bindCall';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `m2bc${Date.now()}`;
const session = (companyId: string): SessionPayload => ({ sub: 'mgr1', role: 'manager', companyId, managedOrgIds: [] } as any);
afterAll(async () => {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('bindCall', () => {
  it('binds an unresolved call to an org + contact and captures the number as a channel (learn-on-link)', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: co.id } });
    const contact = await prisma.contact.create({ data: { companyId: co.id, organizationId: org.id, name: `${STAMP}-Ivan` } });
    const call = await prisma.call.create({ data: { provider: 'mango', externalId: `${STAMP}:c1`, direction: 'inbound', callerNumber: '8 (999) 000-88-77', status: 'completed' } });

    const r = await bindCall(prisma, session(co.id), { callId: call.id, organizationId: org.id, contactId: contact.id });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.resolvedOrgId).toBe(org.id);
    expect(row?.companyId).toBe(co.id);
    expect(row?.contactId).toBe(contact.id);
    const chan = await prisma.contactChannel.findFirst({ where: { contactId: contact.id, normalizedValue: '+79990008877' } });
    expect(chan).not.toBeNull(); // learn-on-link captured the caller number
  });

  it('C8: refuses to bind to an org in another company', async () => {
    const coA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
    const coB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
    const orgB = await prisma.organization.create({ data: { name: `${STAMP}-orgB`, companyId: coB.id } });
    const call = await prisma.call.create({ data: { provider: 'mango', externalId: `${STAMP}:c2`, direction: 'inbound', callerNumber: '+79990001111', status: 'completed' } });
    const r = await bindCall(prisma, session(coA.id), { callId: call.id, organizationId: orgB.id });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/telephony.bindCall.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `bindCall` (mirrors `bindInboundMessageAction` scoping)**

```ts
// src/lib/services/telephony/bindCall.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getCompanyTeamVisibility, isOrgInScope } from '@/lib/auth/managerPolicy';
import { captureChannel } from '@/lib/services/manager/contacts';
import { recordAudit } from '@/lib/auth/audit';

export type BindCallArgs = { callId: string; organizationId: string; contactId?: string; orderId?: string };
export type BindCallResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

export async function bindCall(prisma: PrismaClient, session: SessionPayload, args: BindCallArgs): Promise<BindCallResult> {
  const call = await prisma.call.findUnique({ where: { id: args.callId }, select: { id: true, callerNumber: true } });
  if (!call) return { ok: false, error: 'not_found' };

  const org = await prisma.organization.findUnique({ where: { id: args.organizationId }, select: { id: true, companyId: true } });
  if (!org) return { ok: false, error: 'not_found' };

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  if (!session.companyId || org.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
  if (!teamMode && !isOrgInScope(session, args.organizationId)) return { ok: false, error: 'forbidden' };

  // If a contact is given, it must belong to the same company (and org, if it has one).
  let contactId: string | null = null;
  if (args.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: args.contactId }, select: { id: true, companyId: true, organizationId: true } });
    if (!contact || contact.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
    if (contact.organizationId && contact.organizationId !== args.organizationId) return { ok: false, error: 'forbidden' };
    contactId = contact.id;
  }

  // Optional thread link (order must belong to the org).
  let threadId: string | null = null;
  if (args.orderId) {
    const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: { id: true, organizationId: true, companyId: true } });
    if (order && order.organizationId === args.organizationId && (teamMode ? order.companyId === session.companyId : true)) {
      const thread = await prisma.orderThread.findUnique({ where: { orderId_side: { orderId: args.orderId, side: 'org' } }, select: { id: true } });
      threadId = thread?.id ?? null;
    }
  }

  await prisma.call.update({ where: { id: args.callId }, data: { resolvedOrgId: args.organizationId, companyId: org.companyId, contactId, threadId } });

  // Learn-on-link: capture the caller number on the contact so future calls auto-resolve.
  if (contactId && call.callerNumber) {
    await captureChannel(prisma, { contactId, companyId: org.companyId, type: 'phone', value: call.callerNumber });
  }

  await recordAudit(prisma, { action: 'call_bound', entity: 'call', entityId: args.callId, userId: session.sub, after: { organizationId: args.organizationId, contactId, threadId } });
  return { ok: true };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/__tests__/telephony.bindCall.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing server-action test (mocked)**

```ts
// src/__tests__/server-actions.contacts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
const { bindCall } = vi.hoisted(() => ({ bindCall: vi.fn() }));
const { createContact } = vi.hoisted(() => ({ createContact: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/telephony/bindCall', () => ({ bindCall }));
vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn(() => null) }));

import { bindCallAction, createContactFromCallAction } from '@/server-actions/contacts';

describe('contacts server-actions', () => {
  beforeEach(() => { vi.clearAllMocks(); requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'c1' }); });

  it('bindCallAction delegates to bindCall service', async () => {
    bindCall.mockResolvedValue({ ok: true });
    const r = await bindCallAction({ callId: 'call1', organizationId: 'o1', contactId: 'k1' });
    expect(r).toEqual({ ok: true });
    expect(bindCall).toHaveBeenCalledWith({}, { sub: 'm1', role: 'manager', companyId: 'c1' }, { callId: 'call1', organizationId: 'o1', contactId: 'k1' });
  });

  it('createContactFromCallAction creates a contact then binds the call to it', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindCall.mockResolvedValue({ ok: true });
    const r = await createContactFromCallAction({ callId: 'call1', organizationId: 'o1', name: 'Иван', phone: '+79990001122' });
    expect(r).toEqual({ ok: true, contactId: 'k9' });
    expect(createContact).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ name: 'Иван', organizationId: 'o1', channels: [{ type: 'phone', value: '+79990001122' }] }));
    expect(bindCall).toHaveBeenCalledWith({}, expect.anything(), { callId: 'call1', organizationId: 'o1', contactId: 'k9' });
  });
});
```

- [ ] **Step 6: Run — expect FAIL**

Run: `npx vitest run src/__tests__/server-actions.contacts.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement the server-actions**

```ts
// src/server-actions/contacts.ts
'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { bindCall, type BindCallArgs, type BindCallResult } from '@/lib/services/telephony/bindCall';
import { createContact, type CreateContactResult } from '@/lib/services/manager/contacts';

export async function bindCallAction(args: BindCallArgs): Promise<BindCallResult> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  return bindCall(prisma, session, args);
}

export async function createContactFromCallAction(
  args: { callId: string; organizationId: string; name: string; phone: string }
): Promise<CreateContactResult> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  const created = await createContact(prisma, session, { name: args.name, organizationId: args.organizationId, channels: [{ type: 'phone', value: args.phone }] });
  if (!created.ok) return created;
  await bindCall(prisma, session, { callId: args.callId, organizationId: args.organizationId, contactId: created.contactId });
  return created;
}
```

- [ ] **Step 8: Run — expect PASS**

Run: `npx vitest run src/__tests__/server-actions.contacts.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/telephony/bindCall.ts src/server-actions/contacts.ts src/__tests__/telephony.bindCall.integration.test.ts src/__tests__/server-actions.contacts.test.ts
git commit -m "feat(m2): call triage — bindCall service + bindCall/createContactFromCall actions (learn-on-link)"
```

---

## Task 10: Call triage UI on `/manager/calls`

**Files:**
- Read first: `src/app/manager/calls/page.tsx`, `src/components/manager/calls-list.tsx`, `src/lib/services/telephony/listCalls.ts` (to learn the row shape + how unresolved is expressed)
- Create: `src/components/manager/contacts/call-bind-form.tsx` (`'use client'`)
- Modify: `src/components/manager/calls-list.tsx` (render the bind form for unresolved rows when `contacts` flag on)
- Modify: `src/app/manager/calls/page.tsx` (pass `contactsEnabled` + the manager's in-scope orgs for the picker)
- Test: `src/__tests__/components.call-bind-form.test.tsx`

- [ ] **Step 1: Read the three existing files and confirm the `Call` row DTO fields (`id`, `callerNumber`, `resolvedOrgId`, `direction`, `startedAt`).**

No code change. Note whether `listCalls` already returns `resolvedOrgId`/`contactId`; if not, extend its select to include them (narrow select per §13) and its DTO type.

- [ ] **Step 2: Write the failing component test**

```tsx
// src/__tests__/components.call-bind-form.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { bindCallAction, createContactFromCallAction } = vi.hoisted(() => ({ bindCallAction: vi.fn(), createContactFromCallAction: vi.fn() }));
vi.mock('@/server-actions/contacts', () => ({ bindCallAction, createContactFromCallAction }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CallBindForm } from '@/components/manager/contacts/call-bind-form';

const orgs = [{ id: 'o1', name: 'ООО Ромашка' }];

describe('CallBindForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds an unresolved call to a selected org', async () => {
    bindCallAction.mockResolvedValue({ ok: true });
    render(<CallBindForm callId="call1" callerNumber="+79990001122" orgs={orgs} />);
    await userEvent.selectOptions(screen.getByLabelText(/организаци/i), 'o1');
    await userEvent.click(screen.getByRole('button', { name: /привязать/i }));
    expect(bindCallAction).toHaveBeenCalledWith({ callId: 'call1', organizationId: 'o1' });
  });

  it('creates a contact from the caller number and binds', async () => {
    createContactFromCallAction.mockResolvedValue({ ok: true, contactId: 'k1' });
    render(<CallBindForm callId="call1" callerNumber="+79990001122" orgs={orgs} />);
    await userEvent.selectOptions(screen.getByLabelText(/организаци/i), 'o1');
    await userEvent.type(screen.getByLabelText(/имя контакта/i), 'Иван');
    await userEvent.click(screen.getByRole('button', { name: /создать контакт/i }));
    expect(createContactFromCallAction).toHaveBeenCalledWith({ callId: 'call1', organizationId: 'o1', name: 'Иван', phone: '+79990001122' });
  });
});
```

- [ ] **Step 3: Run — expect FAIL (component missing)**

Run: `npx vitest run src/__tests__/components.call-bind-form.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `CallBindForm`**

Build with project UI primitives (`Select`, `Input`, `Button` from `@/components/ui`) and `toast` for feedback. Two actions: "Привязать" (bind to org only) and "Создать контакт" (create-from-number + bind). Russian labels matching the test (`организаци…`, `имя контакта`, button names `привязать`/`создать контакт`). Use `useTransition` for pending state. Keep it presentational; all logic via the mocked server-actions.

```tsx
// src/components/manager/contacts/call-bind-form.tsx
'use client';
import { useState, useTransition } from 'react';
import { Select, Input, Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { bindCallAction, createContactFromCallAction } from '@/server-actions/contacts';

export function CallBindForm({ callId, callerNumber, orgs }: { callId: string; callerNumber: string; orgs: { id: string; name: string }[] }) {
  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  function bind() {
    if (!orgId) { toast.error('Выберите организацию'); return; }
    start(async () => {
      const r = await bindCallAction({ callId, organizationId: orgId });
      r.ok ? toast.success('Звонок привязан') : toast.error('Не удалось привязать');
    });
  }
  function createAndBind() {
    if (!orgId) { toast.error('Выберите организацию'); return; }
    if (!name.trim()) { toast.error('Введите имя контакта'); return; }
    start(async () => {
      const r = await createContactFromCallAction({ callId, organizationId: orgId, name: name.trim(), phone: callerNumber });
      r.ok ? toast.success('Контакт создан и привязан') : toast.error('Не удалось создать контакт');
    });
  }

  return (
    <div>
      <Select aria-label="Организация" value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={pending}>
        <option value="">— организация —</option>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Button onClick={bind} disabled={pending}>Привязать</Button>
      <Input aria-label="Имя контакта" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя контакта" disabled={pending} />
      <Button onClick={createAndBind} disabled={pending}>Создать контакт из номера</Button>
    </div>
  );
}
```
(Confirm the exact `Select`/`Input`/`Button` prop APIs from `src/components/ui/index.ts` and adjust; the test only asserts labels, button names, and the action calls.)

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run src/__tests__/components.call-bind-form.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire into `calls-list.tsx` + `page.tsx`**

In `src/components/manager/calls-list.tsx`, for rows with `resolvedOrgId == null`, render `<CallBindForm callId={row.id} callerNumber={row.callerNumber} orgs={orgs} />` when `contactsEnabled`. In `src/app/manager/calls/page.tsx`, compute `contactsEnabled = isFeatureEnabled('contacts')` and load the manager's in-scope orgs (reuse `listOrganizations`), passing both down. Follow the existing server-component + `renderServerComponent` test conventions; extend the calls page/list tests to cover the new branch (flag on vs off).

- [ ] **Step 7: Run the calls page/list suites + typecheck**

Run: `npm run typecheck && npx vitest run src/__tests__/ -t "calls"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/manager/contacts/call-bind-form.tsx src/components/manager/calls-list.tsx src/app/manager/calls/page.tsx src/lib/services/telephony/listCalls.ts src/__tests__/components.call-bind-form.test.tsx src/__tests__/<calls-page-list-tests>
git commit -m "feat(m2): call triage UI — bind unresolved calls / create contact from number"
```

---

## Task 11: Enhance inbox bind with contact attach/create + learn-on-link

**Files:**
- Modify: `src/server-actions/inbound.ts` (`BindInboundMessageArgs` gains optional `contactId` / new-contact fields; capture senderRef as a channel)
- Modify: `src/components/manager/inbox-bind-form.tsx` (optional contact picker/create)
- Modify tests: `src/__tests__/<inbound bind action test>` + inbox-bind-form component test

- [ ] **Step 1: Write the failing action test**

Extend the existing bind action test (find it: `grep -rl "bindInboundMessageAction" src/__tests__`) with a case: binding with a `contactId` sets `InboundMessage.contactId` and captures the `senderRef` as a channel of the right type for the message's channel. Assert `captureChannel` is invoked (mock `@/lib/services/manager/contacts`).

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/<inbound-bind-action-test>.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/server-actions/inbound.ts`, extend `BindInboundMessageArgs` with `contactId?: string`. After the existing `inboundMessage.update`, if `contactId` is provided: validate the contact belongs to `session.companyId` (and org, if it has one), set `data.contactId`, and call `captureChannel(prisma, { contactId, companyId, type: channelTypeFor(message.channel), value: message.senderRef })`. `channelTypeFor` maps `'telegram'|'max'|'whatsapp'|'email'` → the matching `ContactChannelType` (whatsapp→`whatsapp`). Load `message.channel`/`senderRef` in the initial `findUnique` select.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/__tests__/<inbound-bind-action-test>.test.ts`
Expected: PASS.

- [ ] **Step 5: UI + component test**

Add an optional contact selector/"create" to `inbox-bind-form.tsx` (gated on `contacts` flag, passed from the inbox page). Update its component test for the new control. Keep the free-text order-id input as-is (out of scope to replace here).

- [ ] **Step 6: Run typecheck + affected suites**

Run: `npm run typecheck && npx vitest run src/__tests__/ -t "inbox"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/inbound.ts src/components/manager/inbox-bind-form.tsx src/__tests__/<inbound-bind + inbox-form tests>
git commit -m "feat(m2): inbox bind attaches/creates a contact + captures channel (learn-on-link)"
```

---

## Task 12: Source click-to-call's internal number from `User.internalPhone`

**Files:**
- Modify: `src/server-actions/deal-activity.ts` (`initiateCallAction` drops the client `fromInternal`, derives it server-side)
- Modify: `src/lib/services/telephony/initiateCall.ts` (`error` union gains `'no_internal_phone'`)
- Modify: the M1 deal-activity UI component that calls `initiateCallAction` (stop sending `fromInternal`)
- Modify tests: `src/__tests__/<deal-activity server-action test>` + the initiateCall service test

- [ ] **Step 1: Write the failing action test**

In the existing deal-activity action test (find: `grep -rl "initiateCallAction" src/__tests__`), change expectations: `initiateCallAction({ orderId, toNumber })` (no `fromInternal`) looks up the caller's `User.internalPhone` and passes it to `initiateOutboundCall`; when the user has no `internalPhone`, it returns `{ ok: false, error: 'no_internal_phone' }` and does NOT call the service.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/__tests__/<deal-activity-action-test>.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement server-side sourcing**

```ts
// src/server-actions/deal-activity.ts — replace initiateCallAction
export async function initiateCallAction(args: { orderId: string; toNumber: string }): Promise<InitiateCallResult> {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return { ok: false, error: 'disabled' };
  const session = await requireManager();
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { internalPhone: true } });
  if (!me?.internalPhone) return { ok: false, error: 'no_internal_phone' };
  return initiateOutboundCall(prisma, session, { orderId: args.orderId, toNumber: args.toNumber, fromInternal: me.internalPhone });
}
```
In `src/lib/services/telephony/initiateCall.ts` extend the result type:
```ts
export type InitiateCallResult =
  | { ok: true; callId: string }
  | { ok: false; error: 'disabled' | 'not_found' | 'call_failed' | 'no_internal_phone' };
```

- [ ] **Step 4: Update the deal-activity UI caller**

Find the client component that calls `initiateCallAction` (M1 `a94be79` deal activity thread). Remove the `fromInternal` argument from the call site; surface `no_internal_phone` as a toast ("Укажите внутренний номер в настройках"). Update its component test.

- [ ] **Step 5: Run — expect PASS**

Run: `npm run typecheck && npx vitest run src/__tests__/<deal-activity tests>`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-actions/deal-activity.ts src/lib/services/telephony/initiateCall.ts src/components/manager/<deal-activity component> src/__tests__/<deal-activity tests>
git commit -m "feat(m2): click-to-call sources internal number from User.internalPhone (drops client-supplied fromInternal)"
```

---

## Task 13: PR-A green gate

**Files:** none (verification).

- [ ] **Step 1: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Full unit + integration**

Run: `npm test` (mode-agnostic — both layers; requires Postgres). Do NOT run in parallel with anything else (CLAUDE.md §6).
Expected: all green.

- [ ] **Step 3: Coverage on the new logical files**

Run: `npm run test:coverage`
Expected: 100% on `src/lib/phone/**`, `src/lib/services/contacts/**`, `src/lib/services/manager/contacts.ts`, `src/lib/services/telephony/bindCall.ts`, `src/server-actions/contacts.ts`, and the touched attribution/ingest files. Add targeted tests for any uncovered branch; any `/* v8 ignore */` must carry a reason comment.

- [ ] **Step 4: Migration status**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!" and the new migration listed as applied.

- [ ] **Step 5: PR-A close-out**

Create `docs/superpowers/plans/2026-07-14-m2-contacts-pr-a-foundation-DONE.md` summarizing what shipped vs the plan (what was built, any deltas, follow-ups deferred to PR-B). Commit.

---

## Self-Review (author checklist — done at plan-write time)

**Spec coverage (PR-A slice):** model + per-company channel uniqueness (T1) ✓; unified normalizer / 8→+7 fix (T2) ✓; channel resolver + phone-like (T3) ✓; contact core + learn-on-link (T4, T9, T11) ✓; inbound rewire + contactId (T5) ✓; call rewire + contactId (T6) ✓; backfill from Users+Leads, dedup, idempotent (T7) ✓; `contacts` flag (T8) ✓; **call triage — the missing bind UI** (T9, T10) ✓; internalPhone / M1 open-Q#2 (T12) ✓. Deferred to **PR-B** (tracked, not dropped): directory route + 3-point flag gating, contact card, org-card "People" tab, deal-card contact block + `setOrderPrimaryContact`, lead-promotion `primaryContact` wiring, `manager_contacts_list`/`view` PII contexts (PR-A adds no new staff PII *read* surface — triage reuses `calls_list`/`inbox_list` logging).

**Placeholder scan:** No "TBD"/"add error handling". A few steps say "find the existing test file via grep" with the exact grep — that's a locate instruction, not a content gap; the code/assertions to add are fully specified.

**Type consistency:** `normalizeChannelValue`/`normalizePhoneCanonical` names stable across T2–T7; `resolveContactByChannel` return shape (`contactId`/`organizationId`/`companyId`/`userId?`) consistent in T3/T5/T6; `ContactChannelType` values `phone|email|telegram|whatsapp|max` consistent; `bindCall`/`captureChannel`/`createContact` signatures consistent across T4/T9/T11; `InitiateCallResult` extended once (T12) and used in T12 only.
