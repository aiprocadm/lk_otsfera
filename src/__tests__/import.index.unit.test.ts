/**
 * Unit tests for import/index.ts — covers the missing branches:
 * - previewImport/commitImport forbidden arm
 * - previewImport empty arm
 * - commitImport audit failure (non-blocking)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const { recordAudit, runRecordBatch, FileOneCAdapter, importScope } = vi.hoisted(() => {
  const runRecordBatch = vi.fn();
  const importScope = vi.fn().mockReturnValue({});
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  const FileOneCAdapter = vi.fn().mockImplementation(() => ({
    pullOrders: vi.fn().mockResolvedValue([]),
    pullPayments: vi.fn().mockResolvedValue([]),
  }));
  return { recordAudit, runRecordBatch, FileOneCAdapter, importScope };
});

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/oneCSync/record-batch', () => ({ runRecordBatch }));
vi.mock('@/lib/services/oneCSync/adapter-file', () => ({ FileOneCAdapter }));
vi.mock('@/lib/services/oneCSync/scope', () => ({ importScope }));
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrderRecord: vi.fn(),
  upsertPaymentRecord: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/schemas', () => ({
  OneCOrderSchema: {},
  OneCPaymentSchema: {},
}));

import { previewImport, commitImport } from '@/lib/services/import/index';

const adminSession = { sub: 'u-admin', role: 'admin', companyId: 'c1' } as never;
const partnerSession = { sub: 'u-partner', role: 'partner' } as never;

const fileBuffer = Buffer.from('fake-excel');
const fakePrisma = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: successful batch run with 1 order
  runRecordBatch
    .mockResolvedValueOnce({ pulled: 1, inserted: 1, updated: 0, errors: 0 })
    .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 });
});

describe('previewImport', () => {
  it('returns forbidden for non-staff roles (partner)', async () => {
    const result = await previewImport(fakePrisma, partnerSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden for organization role', async () => {
    const orgSession = { sub: 'u-org', role: 'organization' } as never;
    const result = await previewImport(fakePrisma, orgSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns parse_failed when adapter throws', async () => {
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrders: vi.fn().mockRejectedValue(new Error('corrupt file')),
      pullPayments: vi.fn().mockResolvedValue([]),
    }));
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'parse_failed' });
  });

  it('returns empty when both orders and payments pulled = 0', async () => {
    runRecordBatch
      .mockReset()
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 })
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 });
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'empty' });
  });

  it('returns ok:true with report when orders > 0', async () => {
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({
      ok: true,
      report: {
        orders: { pulled: 1, inserted: 1, updated: 0, errors: 0 },
        payments: { pulled: 0, inserted: 0, updated: 0, errors: 0 },
      },
    });
  });

  it('returns ok:true when only payments > 0', async () => {
    runRecordBatch
      .mockReset()
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 })
      .mockResolvedValueOnce({ pulled: 2, inserted: 2, updated: 0, errors: 0 });
    const result = await previewImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
  });

  it('runs in shadow mode (no writes to DB)', async () => {
    await previewImport(fakePrisma, adminSession, { fileBuffer });
    // importScope called once
    expect(importScope).toHaveBeenCalledWith(adminSession);
    // runRecordBatch called twice (orders + payments)
    expect(runRecordBatch).toHaveBeenCalledTimes(2);
    // No audit in preview
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('commitImport', () => {
  it('returns forbidden for non-staff roles', async () => {
    const result = await commitImport(fakePrisma, partnerSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns parse_failed when run throws', async () => {
    FileOneCAdapter.mockImplementationOnce(() => ({
      pullOrders: vi.fn().mockRejectedValue(new Error('bad')),
      pullPayments: vi.fn().mockResolvedValue([]),
    }));
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toEqual({ ok: false, error: 'parse_failed' });
  });

  it('returns ok:true and writes audit log on success', async () => {
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      userId: 'u-admin',
      action: 'one_c_import.commit',
    });
    // Audit entity ID = companyId (when defined)
    expect(recordAudit.mock.calls[0][1].entityId).toBe('c1');
  });

  it('uses session.sub as entityId when companyId is null', async () => {
    // Branch: session.companyId ?? session.sub — covers null/undefined companyId case
    runRecordBatch
      .mockReset()
      .mockResolvedValueOnce({ pulled: 1, inserted: 1, updated: 0, errors: 0 })
      .mockResolvedValueOnce({ pulled: 0, inserted: 0, updated: 0, errors: 0 });
    const sessionNoCompany = { sub: 'u-mgr', role: 'manager', companyId: null } as never;
    const result = await commitImport(fakePrisma, sessionNoCompany, { fileBuffer });
    expect(result).toMatchObject({ ok: true });
    expect(recordAudit.mock.calls[0][1].entityId).toBe('u-mgr');
  });

  it('does NOT throw when audit recordAudit fails (non-blocking)', async () => {
    recordAudit.mockRejectedValueOnce(new Error('audit DB down'));
    const result = await commitImport(fakePrisma, adminSession, { fileBuffer });
    // Should still return ok:true — audit failure is swallowed
    expect(result).toMatchObject({ ok: true });
  });
});
