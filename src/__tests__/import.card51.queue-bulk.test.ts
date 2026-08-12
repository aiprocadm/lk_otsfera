import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Пакетное создание организаций из очереди (`У-53`, решение `Р-10`).
 *
 * Проверяем именно то, ради чего действие двухшаговое: список считается
 * заново на подтверждении, снятая галочка исключает контрагента, а строки
 * того же ИНН привязываются к созданной организации — иначе человек получил
 * бы организацию и всё равно ручную работу по её же платежам.
 */
const { createOrgFromQueueRow } = vi.hoisted(() => ({ createOrgFromQueueRow: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard/create-org', () => ({ createOrgFromQueueRow }));

const { resolveQueueRow } = vi.hoisted(() => ({ resolveQueueRow: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard/resolve-queue', () => ({ resolveQueueRow }));

const { mayImportOneC } = vi.hoisted(() => ({ mayImportOneC: vi.fn(() => true) }));
vi.mock('@/lib/auth/managerPolicy', () => ({ mayImportOneC }));

const { importScope } = vi.hoisted(() => ({
  importScope: vi.fn((): { kind: string; companyId?: string } => ({ kind: 'global' })),
}));
vi.mock('@/lib/services/oneCSync/scope', () => ({ importScope }));

import {
  planQueueOrgCreation,
  createOrgsFromQueueRows,
} from '@/lib/services/import/oneCAccountCard/queue-bulk';

const SESSION = { sub: 'u1', role: 'admin' } as never;
const INN_A = '7707083893';
const INN_B = '7736207543';

function db(rows: Array<Record<string, unknown>>, existingInns: string[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const orgFindMany = vi.fn().mockResolvedValue(existingInns.map((inn) => ({ inn })));
  return {
    prisma: {
      paymentImportRow: { findMany },
      organization: { findMany: orgFindMany },
    } as never,
    findMany,
    orgFindMany,
  };
}

beforeEach(() => {
  mayImportOneC.mockReturnValue(true);
  importScope.mockReturnValue({ kind: 'global' });
  createOrgFromQueueRow.mockReset();
  resolveQueueRow.mockReset();
});

describe('planQueueOrgCreation — шаг 1 (Р-10)', () => {
  it('строки одного ИНН схлопываются, невалидные и существующие отсеиваются', async () => {
    const { prisma } = db(
      [
        { id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
        { id: 'r2', counterpartyName: 'ООО «Альфа»', counterpartyInn: ` ${INN_A} ` },
        { id: 'r3', counterpartyName: 'ООО «Бета»', counterpartyInn: INN_B },
        { id: 'r4', counterpartyName: 'ООО «Кривой»', counterpartyInn: '1234567890' },
        { id: 'r5', counterpartyName: 'Без ИНН', counterpartyInn: null },
      ],
      [INN_B] // организация с этим ИНН уже есть
    );
    const res = await planQueueOrgCreation(prisma, SESSION);
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates).toEqual([{ rowId: 'r1', name: 'ООО «Альфа»', inn: INN_A, alsoRows: 1 }]);
  });

  it('без права импорта — forbidden, обычному менеджеру — not_allowed', async () => {
    mayImportOneC.mockReturnValue(false);
    const { prisma, findMany } = db([]);
    expect(await planQueueOrgCreation(prisma, SESSION)).toEqual({ ok: false, error: 'forbidden' });
    expect(findMany).not.toHaveBeenCalled();

    mayImportOneC.mockReturnValue(true);
    importScope.mockReturnValue({ kind: 'orgs' });
    expect(await planQueueOrgCreation(prisma, SESSION)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });

  it('руководитель видит только строки своей компании', async () => {
    importScope.mockReturnValue({ kind: 'company', companyId: 'co-1' });
    const { prisma, findMany } = db([]);
    await planQueueOrgCreation(prisma, SESSION);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ batch: { companyId: 'co-1' } });
  });

  it('ни одного валидного ИНН — пустой список, в организации не ходим', async () => {
    const { prisma, orgFindMany } = db([
      { id: 'r1', counterpartyName: 'X', counterpartyInn: null },
    ]);
    const res = await planQueueOrgCreation(prisma, SESSION);
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates).toEqual([]);
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('организация без ИНН в базе не мешает сравнению', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A }]);
    const prisma = {
      paymentImportRow: { findMany },
      organization: { findMany: vi.fn().mockResolvedValue([{ inn: null }]) },
    } as never;
    const res = await planQueueOrgCreation(prisma, SESSION);
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates).toHaveLength(1);
  });
});

describe('createOrgsFromQueueRows — шаг 2', () => {
  it('создаёт только отмеченные строки и привязывает остальные строки того же ИНН', async () => {
    const { prisma } = db([
      { id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
      { id: 'r2', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
      { id: 'r3', counterpartyName: 'ООО «Бета»', counterpartyInn: INN_B },
    ]);
    createOrgFromQueueRow.mockResolvedValue({ ok: true, organizationId: 'org-1', paymentId: 'p1' });
    resolveQueueRow.mockResolvedValue({ ok: true, paymentId: 'p2' });

    const res = await createOrgsFromQueueRows(prisma, SESSION, {
      rowIds: ['r1'], // «Бета» снята галочкой
      companyId: 'co-7',
    });
    if (!res.ok) throw new Error('expected ok');

    expect(createOrgFromQueueRow).toHaveBeenCalledTimes(1);
    expect(createOrgFromQueueRow.mock.calls[0]![2]).toMatchObject({
      rowId: 'r1',
      inn: INN_A,
      companyId: 'co-7',
    });
    // Вторая строка того же контрагента привязана, а не оставлена в очереди.
    expect(resolveQueueRow).toHaveBeenCalledTimes(2);
    expect(res.result).toMatchObject({ created: 1, bound: 2, failed: [] });
  });

  it('отказ создания попадает в список неудач и не роняет остальные', async () => {
    const { prisma } = db([
      { id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
      { id: 'r3', counterpartyName: 'ООО «Бета»', counterpartyInn: INN_B },
    ]);
    createOrgFromQueueRow
      .mockResolvedValueOnce({ ok: false, error: 'company_required' })
      .mockResolvedValueOnce({ ok: true, organizationId: 'org-2', paymentId: null });

    const res = await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1', 'r3'] });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result.created).toBe(1);
    expect(res.result.failed).toEqual([{ inn: INN_A, error: 'company_required' }]);
  });

  it('право проверяется и на втором шаге — id строк подделать бесполезно', async () => {
    mayImportOneC.mockReturnValue(false);
    const { prisma } = db([]);
    expect(await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1'] })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(createOrgFromQueueRow).not.toHaveBeenCalled();
  });

  it('строка, исчезнувшая из плана между шагами, не создаётся', async () => {
    // Организацию завели вручную, пока оператор смотрел список.
    const { prisma } = db(
      [{ id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A }],
      [INN_A]
    );
    const res = await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1'] });
    if (!res.ok) throw new Error('expected ok');
    expect(res.result).toMatchObject({ created: 0, bound: 0 });
    expect(createOrgFromQueueRow).not.toHaveBeenCalled();
  });

  it('контрагент без названия получает опознаваемое имя, а привязка-неудача не ломает счёт', async () => {
    const { prisma } = db([
      { id: 'r1', counterpartyName: null, counterpartyInn: INN_A },
      { id: 'r2', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
    ]);
    createOrgFromQueueRow.mockResolvedValue({ ok: true, organizationId: 'org-1', paymentId: 'p1' });
    // Одна из привязок не удалась — счётчик её не считает, но и не падает.
    resolveQueueRow
      .mockResolvedValueOnce({ ok: true, paymentId: 'p2' })
      .mockResolvedValueOnce({ ok: false, error: 'write_skipped' });

    const res = await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1'] });
    if (!res.ok) throw new Error('expected ok');
    // Имя подтянулось из второй строки того же ИНН — первая была пустой.
    expect(createOrgFromQueueRow.mock.calls[0]![2].name).toBe('ООО «Альфа»');
    expect(res.result).toMatchObject({ created: 1, bound: 1 });
  });

  it('контрагент без названия во всех строках получает имя по ИНН', async () => {
    const { prisma } = db([{ id: 'r1', counterpartyName: null, counterpartyInn: INN_A }]);
    createOrgFromQueueRow.mockResolvedValue({ ok: true, organizationId: 'org-1', paymentId: null });

    const res = await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1'] });
    if (!res.ok) throw new Error('expected ok');
    expect(createOrgFromQueueRow.mock.calls[0]![2].name).toBe(`Организация по ИНН ${INN_A}`);
    // Единственная строка контрагента — довязывать нечего.
    expect(resolveQueueRow).not.toHaveBeenCalled();
  });

  it('руководитель довязывает только строки своей компании, строки без ИНН не мешают', async () => {
    importScope.mockReturnValue({ kind: 'company', companyId: 'co-1' });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'r1', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
        { id: 'r2', counterpartyName: 'ООО «Альфа»', counterpartyInn: INN_A },
      ])
      // Второй вызов — поиск «остальных строк того же ИНН»; среди них попадаются
      // строки без ИНН вовсе, и они не должны ломать сравнение.
      .mockResolvedValueOnce([
        { id: 'r1', counterpartyInn: INN_A },
        { id: 'r2', counterpartyInn: INN_A },
        { id: 'r9', counterpartyInn: null },
      ]);
    const prisma = {
      paymentImportRow: { findMany },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    createOrgFromQueueRow.mockResolvedValue({ ok: true, organizationId: 'org-1', paymentId: 'p1' });
    resolveQueueRow.mockResolvedValue({ ok: true, paymentId: 'p2' });

    const res = await createOrgsFromQueueRows(prisma, SESSION, { rowIds: ['r1'] });
    if (!res.ok) throw new Error('expected ok');
    // Довязка ограничена компанией руководителя.
    expect(findMany.mock.calls[1]![0].where).toMatchObject({ batch: { companyId: 'co-1' } });
    expect(res.result.bound).toBe(2);
  });
});
