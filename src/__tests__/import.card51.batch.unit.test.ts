import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));
const { matchRow } = vi.hoisted(() => ({ matchRow: vi.fn() }));
const { readSpreadsheet } = vi.hoisted(() => ({ readSpreadsheet: vi.fn() }));
const { parseAccountCard } = vi.hoisted(() => ({ parseAccountCard: vi.fn() }));

vi.mock('@/lib/services/oneCSync/writers', () => ({ upsertPaymentRecord, orgInScope: () => true }));
vi.mock('@/lib/services/import/oneCAccountCard/matcher', () => ({ matchRow }));
vi.mock('@/lib/services/import/oneCAccountCard/read-spreadsheet', () => ({
  readSpreadsheet,
  sniffFormat: () => 'xlsx',
}));
vi.mock('@/lib/services/import/oneCAccountCard/parser', () => ({ parseAccountCard }));

import {
  previewPaymentImport,
  commitPaymentImport,
} from '@/lib/services/import/oneCAccountCard/import-batch';

const session = { sub: 'u1', role: 'admin', companyId: 'c1' } as never;

function parsed() {
  return [
    {
      kind: 'payment',
      externalId: '0000-1',
      amount: 100,
      paidAt: '2026-06-01T00:00:00.000Z',
      isRefund: false,
      accountCandidates: [],
      counterpartyName: 'A',
      counterpartyInn: null,
      vatAmount: null,
      purpose: 'x',
      paymentOrderNumber: '0000-1',
      rawRow: [],
      rowIndex: 1,
    },
    {
      kind: 'payment',
      externalId: '0000-2',
      amount: 200,
      paidAt: '2026-06-02T00:00:00.000Z',
      isRefund: false,
      accountCandidates: [],
      counterpartyName: 'B',
      counterpartyInn: null,
      vatAmount: null,
      purpose: 'y',
      paymentOrderNumber: '0000-2',
      rawRow: [],
      rowIndex: 2,
    },
    {
      kind: 'excluded',
      excludeReason: 'supplier',
      externalId: '0000-3',
      amount: 50,
      paidAt: '2026-06-03T00:00:00.000Z',
      isRefund: false,
      accountCandidates: [],
      counterpartyName: null,
      counterpartyInn: null,
      vatAmount: null,
      purpose: null,
      paymentOrderNumber: null,
      rawRow: [],
      rowIndex: 3,
    },
  ];
}

/** Разбор теперь отдаёт { rows, diagnostics } — мок обязан повторять контракт. */
function emptyDiagnostics() {
  return {
    columnSource: 'headers' as const,
    headerRow: 0,
    matchedColumns: {},
    startMarkerFound: true,
    rowsScanned: 0,
    parseErrorsByReason: {},
    samples: [],
    notes: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSpreadsheet.mockResolvedValue([['Сальдо на начало'], ['Обороты за период']]);
  parseAccountCard.mockReturnValue({ rows: parsed(), diagnostics: emptyDiagnostics() });
  matchRow.mockImplementation(async (_p: unknown, r: { externalId: string }) =>
    r.externalId === '0000-1'
      ? {
          route: 'exact',
          dto: {
            externalId: '0000-1',
            organizationInn: '77',
            amount: 100,
            paidAt: '2026-06-01T00:00:00.000Z',
            isRefund: false,
            updatedAt: new Date(0).toISOString(),
          },
        }
      : { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' }
  );
});

describe('previewPaymentImport', () => {
  it('counts exact/queued/excluded without writing', async () => {
    const prisma = {} as never;
    const res = await previewPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.counts.imported).toBe(1); // 0000-1 exact
      expect(res.plan.counts.queued).toBe(1); // 0000-2 queue
      expect(res.plan.counts.excluded).toBe(1); // 0000-3
      expect(res.plan.counts.excludedByReason.supplier).toBe(1);
    }
    expect(upsertPaymentRecord).not.toHaveBeenCalled(); // shadow mode
  });

  it('returns empty when no operation rows', async () => {
    parseAccountCard.mockReturnValue({ rows: [], diagnostics: emptyDiagnostics() });
    const res = await previewPaymentImport({} as never, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    // У-58: вместе с отказом отдаётся то, что система увидела в файле.
    expect(res).toMatchObject({ ok: false, error: 'empty' });
    expect((res as { diagnostics?: unknown }).diagnostics).toBeDefined();
  });
});

describe('commitPaymentImport', () => {
  it('writes exact via writer, queue rows via paymentImportRow, creates batch', async () => {
    const tx = {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
      paymentImportWrite: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;
    upsertPaymentRecord.mockImplementation(
      async (_db: unknown, _dto: unknown, sum: { created: number }) => {
        sum.created += 1;
      }
    );

    const res = await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res.ok).toBe(true);
    expect(upsertPaymentRecord).toHaveBeenCalledTimes(1); // only exact
    expect(tx.paymentImportRow.upsert).toHaveBeenCalledTimes(1); // only queue
    expect(tx.paymentImportBatch.create).toHaveBeenCalledTimes(1);
  });

  // `У-59`: без следа записи откатывать нечего — до этого writer возвращал
  // и id, и снимок «до», а импорт выписки их выбрасывал.
  it('созданный платёж попадает в след записи батча', async () => {
    const tx = {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
      paymentImportWrite: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;
    upsertPaymentRecord.mockResolvedValue({ entityId: 'pay-1', action: 'created' });

    await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(tx.paymentImportWrite.create).toHaveBeenCalledTimes(1);
    expect(tx.paymentImportWrite.create.mock.calls[0]![0].data).toMatchObject({
      batchId: 'batch1',
      entity: 'payment',
      entityId: 'pay-1',
      action: 'created',
    });
  });

  it('обновлённый платёж кладёт в след снимок «до» — иначе откат нечего восстанавливать', async () => {
    const tx = {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
      paymentImportWrite: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;
    const before = { amount: '100.00', paidAt: '2026-06-01T00:00:00.000Z', purpose: 'старое' };
    upsertPaymentRecord.mockResolvedValue({ entityId: 'pay-1', action: 'updated', before });

    await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(tx.paymentImportWrite.create.mock.calls[0]![0].data).toMatchObject({
      action: 'updated',
      before,
    });
  });

  it('пропущенная writer-ом строка следа не оставляет', async () => {
    // `undefined` от writer = «не записал» (не в скоупе, заказа нет).
    const tx = {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
      paymentImportWrite: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;
    upsertPaymentRecord.mockResolvedValue(undefined);

    await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(tx.paymentImportWrite.create).not.toHaveBeenCalled();
  });
});

/**
 * `У-49`/`У-50` (этап 7, PR-3): импорт заводит организации сам.
 *
 * Здесь проверяется решающая часть — ЧТО происходит с файлом, где есть
 * контрагент с валидным ИНН, которого нет в системе. Само создание покрыто в
 * `import.card51.auto-create`, живая цепочка — в интеграционном тесте.
 */
describe('автосоздание организаций при импорте (У-49, У-50)', () => {
  const INN = '7707083893';

  function rowWithInn() {
    return {
      kind: 'payment',
      externalId: '0000-9',
      amount: 500,
      paidAt: '2026-06-03T00:00:00.000Z',
      isRefund: false,
      accountCandidates: [],
      counterpartyName: 'ООО «Новая»',
      counterpartyInn: INN,
      vatAmount: null,
      purpose: 'оплата',
      paymentOrderNumber: '0000-9',
      rawRow: [],
      rowIndex: 9,
    };
  }

  // Организация «появляется» ровно в момент её создания — дальше матчер обязан
  // находить её по ИНН, как любую другую.
  let orgExists = false;

  function tx() {
    return {
      paymentImportBatch: { create: vi.fn().mockResolvedValue({ id: 'batch1' }), update: vi.fn() },
      paymentImportRow: { upsert: vi.fn(), updateMany: vi.fn() },
      paymentImportWrite: { create: vi.fn() },
      organization: {
        create: vi.fn().mockImplementation(async () => {
          orgExists = true;
          return { id: 'org-new' };
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      auditLog: { create: vi.fn() },
    };
  }

  function prismaFor(t: ReturnType<typeof tx>) {
    return {
      $transaction: vi.fn(async (fn: (x: typeof t) => Promise<unknown>) => fn(t)),
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;
  }

  beforeEach(() => {
    parseAccountCard.mockReturnValue({ rows: [rowWithInn()], diagnostics: emptyDiagnostics() });
    orgExists = false;
    // Матчер: до создания организации — очередь, после — точная привязка.
    matchRow.mockImplementation(async () =>
      orgExists
        ? {
            route: 'exact',
            dto: {
              externalId: '0000-9',
              amount: 500,
              paidAt: '2026-06-03T00:00:00.000Z',
              isRefund: false,
              organizationInn: INN,
              updatedAt: new Date(0).toISOString(),
            },
          }
        : { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' }
    );
    upsertPaymentRecord.mockResolvedValue({ entityId: 'pay-9', action: 'created' });
  });

  it('организация создаётся, а строка перестаёт быть очередью', async () => {
    const t = tx();
    const res = await commitPaymentImport(prismaFor(t), session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
      companyId: 'co-7',
    });

    expect(res.ok).toBe(true);
    expect(t.organization.create).toHaveBeenCalledTimes(1);
    if (res.ok) {
      expect(res.result.counts.orgsCreated).toBe(1);
      // Строка ушла из очереди в импортированные — иначе человек увидел бы
      // «создали организацию, но платёж всё равно в очереди».
      expect(res.result.counts.imported).toBe(1);
      expect(res.result.counts.queued).toBe(0);
      expect(res.result.counts.queuedByReason.none).toBeUndefined();
    }
    expect(t.paymentImportRow.upsert).not.toHaveBeenCalled();
    // Итоговые счётчики дописываются в батч: он создавался ДО автосоздания.
    expect(t.paymentImportBatch.update).toHaveBeenCalled();
  });

  it('администратор без выбранной компании получает company_required и НИЧЕГО не записано', async () => {
    const t = tx();
    const prisma = prismaFor(t);
    const res = await commitPaymentImport(prisma, { sub: 'u1', role: 'admin' } as never, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res).toEqual({ ok: false, error: 'company_required' });
    expect(t.paymentImportBatch.create).not.toHaveBeenCalled();
  });

  it('обычному менеджеру импорт не отказывает — его строки просто уходят в очередь', async () => {
    const t = tx();
    const manager = { sub: 'u2', role: 'manager', companyId: null, managedOrgIds: ['o1'] } as never;
    const res = await commitPaymentImport(prismaFor(t), manager, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res.ok).toBe(true);
    expect(t.organization.create).not.toHaveBeenCalled();
    expect(t.paymentImportRow.upsert).toHaveBeenCalledTimes(1);
  });

  it('админ без компании, но и без новых контрагентов — импорт работает как прежде', async () => {
    // Отказ `company_required` уместен только когда создавать действительно
    // нужно: иначе мы сломали бы обычный импорт в системе с одной компанией.
    parseAccountCard.mockReturnValue({
      rows: [{ ...rowWithInn(), counterpartyInn: null }],
      diagnostics: emptyDiagnostics(),
    });
    const t = tx();
    const res = await commitPaymentImport(prismaFor(t), { sub: 'u1', role: 'admin' } as never, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res.ok).toBe(true);
    expect(t.organization.create).not.toHaveBeenCalled();
  });

  it('две строки одной причины: после автосоздания причина не исчезает целиком', async () => {
    // Счётчик «в очередь — почему» должен уменьшаться, а не обнуляться:
    // иначе оставшаяся строка потеряла бы объяснение.
    const second = { ...rowWithInn(), externalId: '0000-10', counterpartyInn: '7736207543' };
    parseAccountCard.mockReturnValue({
      rows: [rowWithInn(), second],
      diagnostics: emptyDiagnostics(),
    });
    const t = tx();
    // Организация появляется только для первого ИНН.
    matchRow.mockImplementation(async (_db: unknown, r: { counterpartyInn: string }) =>
      orgExists && r.counterpartyInn === INN
        ? {
            route: 'exact',
            dto: {
              externalId: r.counterpartyInn,
              amount: 1,
              paidAt: '2026-06-03T00:00:00.000Z',
              isRefund: false,
              organizationInn: INN,
              updatedAt: new Date(0).toISOString(),
            },
          }
        : { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' }
    );
    const prisma = {
      $transaction: vi.fn(async (fn: (x: typeof t) => Promise<unknown>) => fn(t)),
      // В системе уже есть организация со вторым ИНН — создаём только первую.
      organization: { findMany: vi.fn().mockResolvedValue([{ inn: '7736207543' }]) },
      paymentImportBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
      syncLog: { create: vi.fn() },
    } as never;

    const res = await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
      companyId: 'co-7',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.counts.orgsCreated).toBe(1);
      expect(res.result.counts.queued).toBe(1);
      expect(res.result.counts.queuedByReason.none).toBe(1);
    }
  });

  it('возврат тоже привязывается к созданной организации и считается возвратом', async () => {
    parseAccountCard.mockReturnValue({
      rows: [{ ...rowWithInn(), isRefund: true }],
      diagnostics: emptyDiagnostics(),
    });
    const t = tx();
    const res = await commitPaymentImport(prismaFor(t), session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
      companyId: 'co-7',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.counts.orgsCreated).toBe(1);
      expect(res.result.counts.refunds).toBe(1);
    }
  });

  it('две строки с одной причиной складываются в счётчике очереди', async () => {
    // Иначе «в очередь: 2» показывало бы причину для одной строки из двух.
    const a = { ...rowWithInn(), counterpartyInn: null, externalId: '0000-21' };
    const b = { ...rowWithInn(), counterpartyInn: null, externalId: '0000-22' };
    parseAccountCard.mockReturnValue({ rows: [a, b], diagnostics: emptyDiagnostics() });
    matchRow.mockResolvedValue({
      route: 'queue',
      candidateOrgId: null,
      candidateOrderId: null,
      matchMethod: 'none',
    });
    const prisma = { organization: { findMany: vi.fn().mockResolvedValue([]) } } as never;

    const res = await previewPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(''),
      fileName: 'c.xlsx',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.counts.queuedByReason.none).toBe(2);
  });
});
