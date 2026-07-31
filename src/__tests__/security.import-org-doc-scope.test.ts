import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression for the C8 broken-tenant-isolation follow-up to PR #192: the org and
// document writers of the full 1C sync must honour the SAME company floor that
// #192 applied to the order/payment writers. #192 left them out of scope because
// today only the headless worker reaches them (scope=undefined → global). This
// test locks in the invariant so that if the org/document writers are ever wired
// onto a session-scoped path (the file adapter already exposes pullOrganizations/
// pullDocuments), a manager-leader cannot mint/mutate a Company-B org, mint a new
// Company, or attribute a document to another company's order. Only admin (global)
// / the unscoped worker may create brand-new orgs. Mirrors the shape of
// security.import-leader-scope.test.ts.

const { resolveOrganizationRef } = vi.hoisted(() => ({ resolveOrganizationRef: vi.fn() }));
const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({
  notifyOrgUsers: vi.fn(),
  notifyManagers: vi.fn(),
}));
const { fetchAndStore1CDocument } = vi.hoisted(() => ({ fetchAndStore1CDocument: vi.fn() }));
const { getQueue } = vi.hoisted(() => ({ getQueue: vi.fn() }));
vi.mock('@/lib/services/oneCSync/resolve-org', () => ({ resolveOrganizationRef }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({ fetchAndStore1CDocument }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { importScope, type ImportScope } from '@/lib/services/oneCSync/scope';
import {
  orgInScope,
  mayCreateOrg,
  upsertOrgRecord,
  upsertDocumentRecord,
} from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import type { SessionPayload } from '@/lib/auth/jwt';

const leaderA = {
  sub: 'L',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'companyA',
  managedOrgIds: [],
} as unknown as SessionPayload;
const adminA = { sub: 'a', role: 'admin', companyId: 'companyA' } as unknown as SessionPayload;
const plainMgrA = {
  sub: 'm',
  role: 'manager',
  companyId: 'companyA',
  managedOrgIds: ['orgA'],
} as unknown as SessionPayload;

const companyScope = importScope(leaderA); // { kind: 'company', companyId: 'companyA' }
const globalScope = importScope(adminA); // { kind: 'global' }

const orgDto = {
  externalId: 'ORG-1',
  name: 'Acme',
  inn: '77',
  kpp: '01',
  partnerExternalId: 'acme-partner',
  updatedAt: '2026-04-01T00:00:00Z',
} as never;
const docDto = {
  externalId: 'D-1',
  orderExternalId: 'O-1',
  type: 'contract',
  name: 'Договор',
  mimeType: 'application/pdf',
  size: 10,
  downloadUrl: 'https://1c/d1',
  updatedAt: '2026-04-01T00:00:00Z',
} as never;

function orgDb(over: Record<string, unknown> = {}) {
  return {
    partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        company: { create: vi.fn().mockResolvedValue({ id: 'co-new' }) },
        organization: { create: vi.fn() },
      })
    ),
    ...over,
  } as never;
}
function docDb(over: Record<string, unknown> = {}) {
  return {
    order: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'ord1',
          organizationId: 'orgA',
          companyId: 'companyA',
          orderNumber: 'O-1',
          title: 't',
        }),
    },
    document: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'doc1' }),
      update: vi.fn(),
    },
    ...over,
  } as never;
}

beforeEach(() => {
  resolveOrganizationRef.mockReset();
  notifyOrgUsers.mockReset();
  notifyManagers.mockReset();
  fetchAndStore1CDocument.mockReset();
  fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
  getQueue.mockReset();
  getQueue.mockReturnValue({ add: vi.fn() });
});

describe('C8: mayCreateOrg — only admin/unscoped-worker may mint a brand-new org+company', () => {
  it('allows an unscoped (worker) actor', () => {
    expect(mayCreateOrg(undefined)).toBe(true);
  });
  it('allows admin (global)', () => {
    expect(mayCreateOrg(globalScope)).toBe(true);
    expect(mayCreateOrg({ kind: 'global' } as ImportScope)).toBe(true);
  });
  it('denies a manager-leader (company-scoped)', () => {
    expect(mayCreateOrg(companyScope)).toBe(false);
  });
  it('denies a plain manager (org-scoped)', () => {
    expect(mayCreateOrg(importScope(plainMgrA))).toBe(false);
    expect(mayCreateOrg({ kind: 'orgs', allowedOrgIds: [] } as ImportScope)).toBe(false);
  });
});

describe('C8: upsertOrgRecord honours the company floor', () => {
  it('leader CANNOT update an org in ANOTHER company (skip out_of_scope, no write)', async () => {
    const d = orgDb({
      organization: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'orgB', companyId: 'companyB', externalId: 'ORG-1' }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: true, scope: companyScope });
    expect(
      (d as { organization: { update: ReturnType<typeof vi.fn> } }).organization.update
    ).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('leader CAN update an org in their OWN company', async () => {
    const d = orgDb({
      organization: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'orgA', companyId: 'companyA', externalId: 'ORG-1' }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: true, scope: companyScope });
    expect(
      (d as { organization: { update: ReturnType<typeof vi.fn> } }).organization.update
    ).toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });

  it('leader CANNOT create a brand-new org (would mint a new Company — skip out_of_scope, no $transaction)', async () => {
    const d = orgDb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: true, scope: companyScope });
    expect((d as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('admin (global) CAN create a brand-new org+company', async () => {
    const d = orgDb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: true, scope: globalScope });
    expect((d as { $transaction: ReturnType<typeof vi.fn> }).$transaction).toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
});

describe('C8: upsertDocumentRecord honours the company floor (by the order’s companyId)', () => {
  it('leader CANNOT attach a document to another company’s order (skip out_of_scope, no fetch/create)', async () => {
    const d = docDb({
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'ord1',
            organizationId: 'orgB',
            companyId: 'companyB',
            orderNumber: 'O-1',
            title: 't',
          }),
      },
    });
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true, scope: companyScope });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    expect(
      (d as { document: { create: ReturnType<typeof vi.fn> } }).document.create
    ).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('leader CAN attach a document to an order in their OWN company', async () => {
    const d = docDb(); // order is companyA by default
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, {
      mode: 'live',
      notify: false,
      scope: companyScope,
    });
    expect(fetchAndStore1CDocument).toHaveBeenCalled();
    expect(
      (d as { document: { create: ReturnType<typeof vi.fn> } }).document.create
    ).toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
});

describe('C8: orgInScope target-shape sanity for org/doc writers', () => {
  it('denies a leader an org-writer target in another company', () => {
    expect(orgInScope(companyScope, { id: 'orgB', companyId: 'companyB' })).toBe(false);
  });
  it('allows a leader a doc-writer target (order) in their own company', () => {
    expect(orgInScope(companyScope, { id: 'orgA', companyId: 'companyA' })).toBe(true);
  });
});
