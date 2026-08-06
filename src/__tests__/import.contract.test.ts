import { describe, it, expect, vi } from 'vitest';

// Mock FileOneCAdapter so we control what pullOrders/pullPayments return
const { FileOneCAdapter } = vi.hoisted(() => ({
  FileOneCAdapter: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/adapter-file', () => ({ FileOneCAdapter }));

// Mock runRecordBatch to control what the batch runner produces
const { runRecordBatch } = vi.hoisted(() => ({ runRecordBatch: vi.fn() }));
vi.mock('@/lib/services/oneCSync/record-batch', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/oneCSync/record-batch')>();
  return { ...original, runRecordBatch };
});

// Mock writers so shadow mode truly writes nothing
const { upsertOrderRecord, upsertPaymentRecord } = vi.hoisted(() => ({
  upsertOrderRecord: vi.fn(),
  upsertPaymentRecord: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/writers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/oneCSync/writers')>();
  return { ...original, upsertOrderRecord, upsertPaymentRecord };
});

// Mock audit so commit tests don't require a real DB
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { previewImport, commitImport } from '@/lib/services/import';

// A minimal prisma mock with the methods resolveOrganizationRef + writers call
function makePrisma() {
  return {
    // Т-41: admin (глобальный скоуп) резолвит компанию для новых организаций;
    // одна компания в системе → берётся по умолчанию без параметра.
    company: {
      findUnique: vi.fn().mockResolvedValue({ id: 'co-1' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'co-1' }]),
    },
    organization: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'org-1', partnerId: 'p-1', companyId: 'co-1', externalId: null }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'order-new' }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'pay-new' }),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    partner: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as any;
}

const DIAGNOSTICS = {
  sheetsFound: ['Контрагенты', 'Реализации', 'Поступления'],
  sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
  // Ключи — распознанные листы; пустые ключи означали бы sheets_not_recognized.
  unmatchedHeaders: { Контрагенты: [], Реализации: [], Поступления: [] },
  missingColumns: {},
  duplicateSheets: {},
};

function makeAdapter(orders: unknown[], payments: unknown[]) {
  return {
    pullOrders: vi.fn().mockResolvedValue(orders),
    pullPayments: vi.fn().mockResolvedValue(payments),
    pullOrganizations: vi.fn().mockResolvedValue([]),
    pullDocuments: vi.fn().mockResolvedValue([]),
    pushLead: vi.fn().mockRejectedValue(new Error('read-only')),
    // Т-3: файловый адаптер отдаёт сервису диагностику разбора книги.
    diagnostics: vi.fn().mockResolvedValue(DIAGNOSTICS),
  };
}

const managerSession = {
  sub: 'u1',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'co-1',
} as any;
const adminSession = { sub: 'admin1', role: 'admin', companyId: 'co-1' } as any;

const EMPTY_SUMMARY = () => ({
  pulled: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  invalid: 0,
  failed: 0,
  skips: [],
  invalids: [],
  failures: [],
});

describe('previewImport', () => {
  it('rejects non-staff roles', async () => {
    const res = await previewImport({} as any, { role: 'partner' } as any, {
      fileBuffer: Buffer.from(''),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('rejects organization role', async () => {
    const res = await previewImport({} as any, { role: 'organization' } as any, {
      fileBuffer: Buffer.from(''),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns empty when no rows are pulled', async () => {
    const adapter = makeAdapter([], []);
    FileOneCAdapter.mockImplementation(() => adapter);
    runRecordBatch.mockResolvedValue(EMPTY_SUMMARY());
    const prisma = makePrisma();
    const res = await previewImport(prisma, managerSession, { fileBuffer: Buffer.from('x') });
    expect(res).toEqual({ ok: false, error: 'empty', diagnostics: DIAGNOSTICS });
  });

  it('returns ok with report for one order, does NOT call order.create (shadow mode)', async () => {
    const orderDto = {
      externalId: 'O-1',
      title: 'Test Order',
      organizationInn: '7700001234',
      totalAmount: 1000,
      paidAmount: 1000,
      vatIncluded: true,
      executionStatus: 'pending',
      financialStatus: 'paid',
      productMix: [],
      updatedAt: new Date(0).toISOString(),
    };
    const adapter = makeAdapter([orderDto], []);
    FileOneCAdapter.mockImplementation(() => adapter);

    // runRecordBatch returns a summary with created=1 pulled=1 for orders, empty for payments
    const orgSummary = EMPTY_SUMMARY();
    const orderSummary = { ...EMPTY_SUMMARY(), pulled: 1, created: 1 };
    const paymentSummary = EMPTY_SUMMARY();
    runRecordBatch
      .mockResolvedValueOnce(orgSummary) // orgs (Т-17: первым)
      .mockResolvedValueOnce(orderSummary) // orders
      .mockResolvedValueOnce(paymentSummary); // payments

    const prisma = makePrisma();
    const res = await previewImport(prisma, managerSession, { fileBuffer: Buffer.from('x') });

    expect(res).toEqual({
      ok: true,
      report: {
        orgs: orgSummary,
        orders: orderSummary,
        payments: paymentSummary,
        diagnostics: DIAGNOSTICS,
      },
    });
    if (res.ok) {
      expect(res.report.orders.created).toBe(1);
    }
    // Shadow mode: order.create should NOT be called (runRecordBatch is mocked, not the real writers)
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('returns parse_failed when adapter throws', async () => {
    FileOneCAdapter.mockImplementation(() => {
      throw new Error('bad xlsx');
    });
    const prisma = makePrisma();
    const res = await previewImport(prisma, managerSession, { fileBuffer: Buffer.from('bad') });
    expect(res).toEqual({ ok: false, error: 'parse_failed' });
  });
});

describe('commitImport', () => {
  it('rejects non-staff roles', async () => {
    const res = await commitImport({} as any, { role: 'partner' } as any, {
      fileBuffer: Buffer.from(''),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('writes data (live mode) and calls audit', async () => {
    const adapter = makeAdapter([{ externalId: 'O-2' }], []);
    FileOneCAdapter.mockImplementation(() => adapter);

    const orgSummary = EMPTY_SUMMARY();
    const orderSummary = { ...EMPTY_SUMMARY(), pulled: 1, created: 1 };
    const paymentSummary = EMPTY_SUMMARY();
    runRecordBatch
      .mockResolvedValueOnce(orgSummary)
      .mockResolvedValueOnce(orderSummary)
      .mockResolvedValueOnce(paymentSummary);

    recordAudit.mockResolvedValue(undefined);

    const prisma = makePrisma();
    const res = await commitImport(prisma, adminSession, { fileBuffer: Buffer.from('x') });

    expect(res).toEqual({
      ok: true,
      report: {
        orgs: orgSummary,
        orders: orderSummary,
        payments: paymentSummary,
        diagnostics: DIAGNOSTICS,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'one_c_import.commit', entity: 'one_c_import' })
    );
  });

  it('returns ok even if audit throws (non-blocking)', async () => {
    const adapter = makeAdapter([{ externalId: 'O-3' }], []);
    FileOneCAdapter.mockImplementation(() => adapter);

    const orgSummary = EMPTY_SUMMARY();
    const orderSummary = { ...EMPTY_SUMMARY(), pulled: 1, updated: 1 };
    const paymentSummary = EMPTY_SUMMARY();
    runRecordBatch
      .mockResolvedValueOnce(orgSummary)
      .mockResolvedValueOnce(orderSummary)
      .mockResolvedValueOnce(paymentSummary);

    recordAudit.mockRejectedValue(new Error('audit db down'));

    const prisma = makePrisma();
    const res = await commitImport(prisma, adminSession, { fileBuffer: Buffer.from('x') });
    expect(res.ok).toBe(true);
  });
});
