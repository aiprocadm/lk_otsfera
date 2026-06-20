/**
 * Unit tests for src/lib/services/manager/uploads.ts
 * Covers branches not fully hit by the existing test:
 *   - createCounterpartyDocument: teamMode=ON skips comment count,
 *     org scope path (inOrgScope=true skips comment count)
 *   - createManagerOrderLessDocument: file validation failures,
 *     persisted.ok=false pass-through
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  orderFindUnique,
  commentCount,
  documentCreate,
  auditCreate,
  storageUpload,
  queueAdd,
  notifyOrgUsersMock,
  notifyPartnerUsersMock,
  listManagerCounterpartiesMock,
  companyFindUnique
} = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  commentCount: vi.fn().mockResolvedValue(0),
  documentCreate: vi.fn(),
  auditCreate: vi.fn(),
  storageUpload: vi.fn(),
  queueAdd: vi.fn(),
  notifyOrgUsersMock: vi.fn(),
  notifyPartnerUsersMock: vi.fn(),
  listManagerCounterpartiesMock: vi.fn(),
  companyFindUnique: vi.fn()
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: storageUpload, createSignedUrl: vi.fn(), remove: vi.fn(), download: vi.fn() }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: queueAdd }),
  QUEUE_NAMES: ['docs.scanDocument']
}));
vi.mock('@/lib/notifications', () => ({
  notifyOrgUsers: notifyOrgUsersMock,
  notifyPartnerUsers: notifyPartnerUsersMock
}));
vi.mock('@/lib/services/manager/counterparties', () => ({
  listManagerCounterparties: listManagerCounterpartiesMock
}));

import { createCounterpartyDocument, createManagerOrderLessDocument } from '@/lib/services/manager/uploads';
import type { SessionPayload } from '@/lib/auth/jwt';

function session(opts: { sub?: string; managedOrgIds?: string[]; companyId?: string } = {}): SessionPayload {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    managedOrgIds: opts.managedOrgIds ?? [],
    companyId: opts.companyId ?? 'co-1'
  };
}

function pdf(overrides: Partial<{ size: number; mimeType: string }> = {}) {
  return {
    name: 'invoice.pdf',
    size: overrides.size ?? 1024,
    mimeType: overrides.mimeType ?? 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 minimal')
  };
}

function prismaMock() {
  return {
    order: { findUnique: orderFindUnique },
    comment: { count: commentCount },
    document: { create: documentCreate },
    auditLog: { create: auditCreate },
    company: { findUnique: companyFindUnique }
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageUpload.mockResolvedValue(undefined);
  queueAdd.mockResolvedValue(undefined);
  documentCreate.mockResolvedValue({ id: 'doc-1' });
  notifyOrgUsersMock.mockResolvedValue({ recipientsNotified: 1 });
  notifyPartnerUsersMock.mockResolvedValue({ recipientsNotified: 1 });
  commentCount.mockResolvedValue(0);
  listManagerCounterpartiesMock.mockResolvedValue({
    organizations: [{ id: 'o1', name: 'O' }],
    partners: []
  });
  companyFindUnique.mockResolvedValue({ managerTeamVisibility: false });
});

// ─── createCounterpartyDocument — additional branches ─────────────────────────

describe('createCounterpartyDocument — teamMode and scope branches', () => {
  it('teamMode=ON: skips comment count even when managerId differs', async () => {
    // In teamMode=ON, the order.companyId check inside canSeeOrder decides.
    // We simulate: getCompanyTeamVisibility returns true via company.findUnique
    companyFindUnique.mockResolvedValue({ managerTeamVisibility: true });
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'someone-else',
      organizationId: 'org-foreign',
      partnerId: null,
      companyId: 'co-1',
      orderNumber: 'O-TM',
      title: 'TeamMode'
    });

    await createCounterpartyDocument(
      prismaMock(),
      session({ sub: 'u-mgr-1', managedOrgIds: [] }),
      { orderId: 'ord-1', recipient: 'organization', docType: 'contract', file: pdf() }
    );
    // comment.count should NOT be called in teamMode=ON
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('skips comment count when managerId matches session.sub', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1', // matches session.sub
      organizationId: 'org-foreign',
      partnerId: null,
      companyId: 'co-1',
      orderNumber: 'O-Manager',
      title: 'MyOrder'
    });

    await createCounterpartyDocument(
      prismaMock(),
      session({ sub: 'u-mgr-1', managedOrgIds: [] }),
      { orderId: 'ord-1', recipient: 'organization', docType: 'contract', file: pdf() }
    );
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('skips comment count when organizationId is in managedOrgIds (inOrgScope=true)', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'someone-else',
      organizationId: 'org-a',
      partnerId: null,
      companyId: 'co-1',
      orderNumber: 'O-OrgScope',
      title: 'OrgScopeOrder'
    });

    await createCounterpartyDocument(
      prismaMock(),
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      { orderId: 'ord-1', recipient: 'organization', docType: 'contract', file: pdf() }
    );
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('recipient=organization with null organizationId still sets counterparty to null-org', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: null,
      partnerId: null,
      companyId: 'co-1',
      orderNumber: 'O-NoOrg',
      title: 'NoOrgOrder'
    });
    // counterparty = { type: 'organization', id: null }
    // canReadOrderLessDocument won't be called for order docs
    // The counterparty is not null (organization path always creates one with id=organizationId)
    // But organizationId=null means counterparty.id=null which is a valid (if odd) case
    const r = await createCounterpartyDocument(
      prismaMock(),
      session({ sub: 'u-mgr-1' }),
      { orderId: 'ord-1', recipient: 'organization', docType: 'contract', file: pdf() }
    );
    // This should succeed (counterparty = { type: 'organization', id: null }) → not null → proceeds
    // The document is created with counterpartyId=null
    expect(r.ok).toBe(true);
  });
});

// ─── createManagerOrderLessDocument — persisted failure path ──────────────────

describe('createManagerOrderLessDocument — failure paths', () => {
  it('returns too_large before any DB call', async () => {
    const sess = session({ companyId: 'co-1' });
    const r = await createManagerOrderLessDocument(
      prismaMock(),
      sess,
      {
        counterparty: { type: 'organization', id: 'o1' },
        docType: 'other',
        file: pdf({ size: 20 * 1024 * 1024 + 1 })
      }
    );
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns invalid_mime before any DB call', async () => {
    const sess = session({ companyId: 'co-1' });
    const r = await createManagerOrderLessDocument(
      prismaMock(),
      sess,
      {
        counterparty: { type: 'organization', id: 'o1' },
        docType: 'other',
        file: pdf({ mimeType: 'application/x-msdownload' })
      }
    );
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('propagates storage error from persistUploadedDocument', async () => {
    storageUpload.mockRejectedValue(new Error('bucket down'));
    const sess = session({ companyId: 'co-1', managedOrgIds: ['o1'] });
    const r = await createManagerOrderLessDocument(
      prismaMock(),
      sess,
      {
        counterparty: { type: 'organization', id: 'o1' },
        docType: 'other',
        file: pdf()
      }
    );
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(documentCreate).not.toHaveBeenCalled();
  });

  it('swallows non-Error throw in notify catch (String(err) branch for order-less)', async () => {
    // notifyOrgUsers throws a non-Error (plain string) — covers String(err) in catch
    notifyOrgUsersMock.mockRejectedValueOnce('network-gone');
    const sess = session({ companyId: 'co-1', managedOrgIds: ['o1'] });
    documentCreate.mockResolvedValue({ id: 'doc-ok' });
    const r = await createManagerOrderLessDocument(
      prismaMock(),
      sess,
      {
        counterparty: { type: 'organization', id: 'o1' },
        docType: 'other',
        file: pdf()
      }
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-ok' });
  });
});

describe('createCounterpartyDocument — notify non-Error catch branch', () => {
  it('swallows non-Error throw in notify catch (String(err) branch for order-level)', async () => {
    // notifyOrgUsers throws a string — covers String(err) in the order-level catch
    notifyOrgUsersMock.mockRejectedValueOnce('smtp-gone');
    orderFindUnique.mockResolvedValue({
      id: 'ord-2',
      managerId: 'u-mgr-1',
      organizationId: 'org-1',
      partnerId: null,
      companyId: 'co-1',
      orderNumber: 'O-NE',
      title: 'NonError test'
    });
    documentCreate.mockResolvedValue({ id: 'doc-ne' });
    const r = await createCounterpartyDocument(
      prismaMock(),
      session({ sub: 'u-mgr-1' }),
      { orderId: 'ord-2', recipient: 'organization', docType: 'contract', file: pdf() }
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-ne' });
  });
});
