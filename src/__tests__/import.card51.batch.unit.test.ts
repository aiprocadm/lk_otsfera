import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));
const { matchRow } = vi.hoisted(() => ({ matchRow: vi.fn() }));
const { readSpreadsheet } = vi.hoisted(() => ({ readSpreadsheet: vi.fn() }));
const { parseAccountCard } = vi.hoisted(() => ({ parseAccountCard: vi.fn() }));

vi.mock('@/lib/services/oneCSync/writers', () => ({ upsertPaymentRecord, orgInScope: () => true }));
vi.mock('@/lib/services/import/oneCAccountCard/matcher', () => ({ matchRow }));
vi.mock('@/lib/services/import/oneCAccountCard/read-spreadsheet', () => ({ readSpreadsheet, sniffFormat: () => 'xlsx' }));
vi.mock('@/lib/services/import/oneCAccountCard/parser', () => ({ parseAccountCard }));

import { previewPaymentImport, commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';

const session = { sub: 'u1', role: 'admin', companyId: 'c1' } as never;

function parsed() {
  return [
    { kind: 'payment', externalId: '0000-1', amount: 100, paidAt: '2026-06-01T00:00:00.000Z', isRefund: false, accountCandidates: [], counterpartyName: 'A', counterpartyInn: null, vatAmount: null, purpose: 'x', paymentOrderNumber: '0000-1', rawRow: [], rowIndex: 1 },
    { kind: 'payment', externalId: '0000-2', amount: 200, paidAt: '2026-06-02T00:00:00.000Z', isRefund: false, accountCandidates: [], counterpartyName: 'B', counterpartyInn: null, vatAmount: null, purpose: 'y', paymentOrderNumber: '0000-2', rawRow: [], rowIndex: 2 },
    { kind: 'excluded', excludeReason: 'supplier', externalId: '0000-3', amount: 50, paidAt: '2026-06-03T00:00:00.000Z', isRefund: false, accountCandidates: [], counterpartyName: null, counterpartyInn: null, vatAmount: null, purpose: null, paymentOrderNumber: null, rawRow: [], rowIndex: 3 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  readSpreadsheet.mockResolvedValue([['Сальдо на начало'], ['Обороты за период']]);
  parseAccountCard.mockReturnValue(parsed());
  matchRow.mockImplementation(async (_p: unknown, r: { externalId: string }) =>
    r.externalId === '0000-1'
      ? { route: 'exact', dto: { externalId: '0000-1', organizationInn: '77', amount: 100, paidAt: '2026-06-01T00:00:00.000Z', isRefund: false, updatedAt: new Date(0).toISOString() } }
      : { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' });
});

describe('previewPaymentImport', () => {
  it('counts exact/queued/excluded without writing', async () => {
    const prisma = {} as never;
    const res = await previewPaymentImport(prisma, session, { fileBuffer: Buffer.from(''), fileName: 'c.xlsx' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.counts.imported).toBe(1);     // 0000-1 exact
      expect(res.plan.counts.queued).toBe(1);       // 0000-2 queue
      expect(res.plan.counts.excluded).toBe(1);     // 0000-3
      expect(res.plan.counts.excludedByReason.supplier).toBe(1);
    }
    expect(upsertPaymentRecord).not.toHaveBeenCalled();   // shadow mode
  });

  it('returns empty when no operation rows', async () => {
    parseAccountCard.mockReturnValue([]);
    const res = await previewPaymentImport({} as never, session, { fileBuffer: Buffer.from(''), fileName: 'c.xlsx' });
    expect(res).toEqual({ ok: false, error: 'empty' });
  });
});

describe('commitPaymentImport', () => {
  it('writes exact via writer, queue rows via paymentImportRow, creates batch', async () => {
    const tx = {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() }, syncLog: { create: vi.fn() },
    } as never;
    upsertPaymentRecord.mockImplementation(async (_db: unknown, _dto: unknown, sum: { created: number }) => { sum.created += 1; });

    const res = await commitPaymentImport(prisma, session, { fileBuffer: Buffer.from(''), fileName: 'c.xlsx' });
    expect(res.ok).toBe(true);
    expect(upsertPaymentRecord).toHaveBeenCalledTimes(1);                 // only exact
    expect(tx.paymentImportRow.upsert).toHaveBeenCalledTimes(1);          // only queue
    expect(tx.paymentImportBatch.create).toHaveBeenCalledTimes(1);
  });
});
