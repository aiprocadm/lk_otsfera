import { describe, expect, it, vi, beforeEach } from 'vitest';

const { enrichInnByName } = vi.hoisted(() => ({ enrichInnByName: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard/dadata-inn', () => ({ enrichInnByName }));

import { collectNewCounterparties } from '@/lib/services/import/oneCAccountCard/new-counterparties';

const VALID_A = '7707083893';
const VALID_B = '7736207543';

function row(inn: string | null, name: string | null) {
  return { counterpartyName: name, counterpartyInn: inn };
}

function db(over: Record<string, unknown> = {}) {
  return {
    organization: { findMany: vi.fn().mockResolvedValue([]) },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  enrichInnByName.mockResolvedValue({ byKey: new Map(), used: true });
});

// `У-86`: контрагент без ИНН больше не выпадает молча — он такой же кандидат,
// просто без реквизита. Группировка идёт по ключу названия (`У-83`).
describe('collectNewCounterparties: кандидаты без ИНН (У-86)', () => {
  it('строки без ИНН становятся кандидатом, ИНН = null', async () => {
    const res = await collectNewCounterparties(db(), [
      row(null, 'ООО «Ромашка»'),
      row(null, 'РОМАШКА, ООО'),
    ]);
    expect(res.candidates).toEqual([
      expect.objectContaining({ key: 'РОМАШКА', name: 'ООО «Ромашка»', inn: null, rows: 2 }),
    ]);
  });

  it('строки одного ключа схлопываются, даже если написаны по-разному', async () => {
    const res = await collectNewCounterparties(db(), [
      row(null, 'ООО «Ромашка»'),
      row(null, 'ромашка ооо'),
      row(null, 'АО «Вектор»'),
    ]);
    expect(res.candidates.map((c) => c.key).sort()).toEqual(['ВЕКТОР', 'РОМАШКА']);
  });

  it('ИНН из файла остаётся источником file', async () => {
    const res = await collectNewCounterparties(db(), [row(VALID_A, 'ООО «Ромашка»')]);
    expect(res.candidates[0]).toMatchObject({ inn: VALID_A, innSource: 'file' });
  });

  it('невалидный ИНН из файла отбрасывается, кандидат остаётся по названию', async () => {
    const res = await collectNewCounterparties(db(), [row('1234567890', 'ООО «Ромашка»')]);
    expect(res.candidates[0]).toMatchObject({ inn: null, innSource: null });
  });

  it('строка без названия и без ИНН — не кандидат, а причина в диагностике', async () => {
    const res = await collectNewCounterparties(db(), [row(null, null), row(null, '   ')]);
    expect(res.candidates).toEqual([]);
    expect(res.reasons.no_name).toBe(2);
  });

  it('ИНН из ЕГРЮЛ подставляется кандидату без ИНН (источник dadata)', async () => {
    enrichInnByName.mockResolvedValue({
      byKey: new Map([['РОМАШКА', { inn: VALID_A, egrulName: 'ООО «Ромашка»' }]]),
      used: true,
    });
    const res = await collectNewCounterparties(db(), [row(null, 'Ромашка ООО')]);
    expect(res.candidates[0]).toMatchObject({
      inn: VALID_A,
      innSource: 'dadata',
      egrulName: 'ООО «Ромашка»',
    });
    expect(res.dadata).toMatchObject({ used: true });
  });
});

describe('collectNewCounterparties: дедупликация (У-86)', () => {
  it('организация с таким ИНН уже есть в этой компании → привязка, не создание', async () => {
    const prisma = db({
      organization: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'org-1', inn: VALID_A, nameKey: 'РОМАШКА', companyId: 'co-1' }])
          .mockResolvedValue([]),
      },
    });
    const res = await collectNewCounterparties(prisma, [row(VALID_A, 'ООО «Ромашка»')], {
      companyId: 'co-1',
    });
    expect(res.candidates).toEqual([]);
    expect(res.existing).toEqual([
      expect.objectContaining({ key: 'РОМАШКА', organizationId: 'org-1', reason: 'inn' }),
    ]);
  });

  it('тот же ИНН в ЧУЖОЙ компании → не создаём и не привязываем, причина в диагностике', async () => {
    const prisma = db({
      organization: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { id: 'org-x', inn: VALID_A, nameKey: 'РОМАШКА', companyId: 'co-foreign' },
          ])
          .mockResolvedValue([]),
      },
    });
    const res = await collectNewCounterparties(prisma, [row(VALID_A, 'ООО «Ромашка»')], {
      companyId: 'co-1',
    });
    expect(res.candidates).toEqual([]);
    expect(res.existing).toEqual([]);
    expect(res.reasons.inn_other_company).toBe(1);
  });

  it('организация той же компании с совпавшим ключом → привязка по названию', async () => {
    // ИНН у кандидата нет — запроса по ИНН не будет вовсе, единственный
    // запрос ищет по ключу названия.
    const prisma = db({
      organization: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'org-2', inn: null, nameKey: 'РОМАШКА', companyId: 'co-1' }]),
      },
    });
    const res = await collectNewCounterparties(prisma, [row(null, 'ООО «Ромашка»')], {
      companyId: 'co-1',
    });
    expect(res.candidates).toEqual([]);
    expect(res.existing).toEqual([
      expect.objectContaining({ key: 'РОМАШКА', organizationId: 'org-2', reason: 'name' }),
    ]);
  });

  it('без компании поиск по ключу не выполняется (матчить «во всех» нельзя)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const res = await collectNewCounterparties(db({ organization: { findMany } }), [
      row(null, 'ООО «Ромашка»'),
    ]);
    // Единственный запрос — по ИНН (а ИНН тут нет), значит в базу не ходили.
    expect(findMany).not.toHaveBeenCalled();
    expect(res.candidates).toHaveLength(1);
  });
});

describe('collectNewCounterparties: правки предпросмотра (У-87)', () => {
  it('снятая галочка убирает кандидата из создания', async () => {
    const res = await collectNewCounterparties(db(), [row(null, 'ООО «Ромашка»')], {
      overrides: [{ key: 'РОМАШКА', create: false }],
    });
    expect(res.candidates).toEqual([]);
    expect(res.reasons.skipped_by_user).toBe(1);
  });

  it('вписанный вручную ИНН принимается с источником manual', async () => {
    const res = await collectNewCounterparties(db(), [row(null, 'ООО «Ромашка»')], {
      overrides: [{ key: 'РОМАШКА', inn: VALID_B }],
    });
    expect(res.candidates[0]).toMatchObject({ inn: VALID_B, innSource: 'manual' });
  });

  it('невалидный ручной ИНН — ошибка до записи, а не молчаливое игнорирование', async () => {
    const res = await collectNewCounterparties(db(), [row(null, 'ООО «Ромашка»')], {
      overrides: [{ key: 'РОМАШКА', inn: '123' }],
    });
    expect(res.badOverrides).toEqual(['РОМАШКА']);
  });

  it('правка с неизвестным ключом игнорируется', async () => {
    const res = await collectNewCounterparties(db(), [row(null, 'ООО «Ромашка»')], {
      overrides: [{ key: 'НЕТ-ТАКОГО', create: false }],
    });
    expect(res.candidates).toHaveLength(1);
    expect(res.badOverrides).toEqual([]);
  });
});
