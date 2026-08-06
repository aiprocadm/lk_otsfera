import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression for the C8 broken-tenant-isolation follow-up to PR #192: the org and
// document writers of the full 1C sync must honour the SAME company floor that
// #192 applied to the order/payment writers. Stage 6 (Т-41/Т-43) changed the
// creation contract: a brand-new org no longer mints a Company — it is attached
// to an existing one, and for a company-scoped leader that is ALWAYS their own
// company (createCompanyId cannot override it). So creation is now allowed for
// admin (global), the unscoped worker and the leader (inside their tenant), and
// still denied for an orgs-scoped plain manager (it would silently widen their
// assigned-orgs scope). Updates/documents keep the same company floor as before.
// Mirrors the shape of security.import-leader-scope.test.ts.

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
    partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'org-new' }),
    },
    ...over,
  } as never;
}
function docDb(over: Record<string, unknown> = {}) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue({
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

describe('C8: mayCreateOrg — creation no longer mints a Company (stage 6, Т-43)', () => {
  it('allows an unscoped (worker) actor', () => {
    expect(mayCreateOrg(undefined)).toBe(true);
  });
  it('allows admin (global)', () => {
    expect(mayCreateOrg(globalScope)).toBe(true);
    expect(mayCreateOrg({ kind: 'global' } as ImportScope)).toBe(true);
  });
  it('allows a manager-leader (company-scoped): the org is created INSIDE their company', () => {
    expect(mayCreateOrg(companyScope)).toBe(true);
  });
  it('denies a plain manager (org-scoped): creating would widen their assigned-orgs scope', () => {
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

  it('leader CAN create a brand-new org — ONLY in their own company, createCompanyId cannot override (Т-41)', async () => {
    const d = orgDb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, {
      mode: 'live',
      notify: true,
      scope: companyScope,
      createCompanyId: 'companyB', // попытка подсунуть чужую компанию
    });
    const create = (d as { organization: { create: ReturnType<typeof vi.fn> } }).organization
      .create;
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'companyA' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });

  it('plain manager (org-scoped) CANNOT create (skip out_of_scope, no write)', async () => {
    const d = orgDb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, {
      mode: 'live',
      notify: true,
      scope: importScope(plainMgrA),
      createCompanyId: 'companyA',
    });
    expect(
      (d as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create
    ).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('admin (global) CAN create a brand-new org in the passed company — no Company is minted', async () => {
    const d = orgDb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, {
      mode: 'live',
      notify: true,
      scope: globalScope,
      createCompanyId: 'companyA',
    });
    const create = (d as { organization: { create: ReturnType<typeof vi.fn> } }).organization
      .create;
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'companyA' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
});

describe('C8: upsertDocumentRecord honours the company floor (by the order’s companyId)', () => {
  it('leader CANNOT attach a document to another company’s order (skip out_of_scope, no fetch/create)', async () => {
    const d = docDb({
      order: {
        findUnique: vi.fn().mockResolvedValue({
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
