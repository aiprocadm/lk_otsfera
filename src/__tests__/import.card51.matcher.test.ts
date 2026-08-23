import { describe, it, expect, vi } from 'vitest';
import { matchRow } from '@/lib/services/import/oneCAccountCard/matcher';
import type { ParsedRow } from '@/lib/services/import/oneCAccountCard/types';

function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    rowIndex: 1,
    kind: 'payment',
    externalId: '0000-1',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: 14800,
    isRefund: false,
    purpose: 'Оплата',
    paymentOrderNumber: '0000-1',
    accountCandidates: [],
    counterpartyName: null,
    counterpartyInn: null,
    vatAmount: null,
    rawRow: [],
    ...over,
  };
}

function db(overrides: Record<string, unknown>) {
  return {
    order: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    ...overrides,
  } as never;
}

describe('matchRow', () => {
  it('exact by account number → order (with externalId) → dto.orderExternalId', async () => {
    const prisma = db({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'o1',
          externalId: 'EXT-1',
          organizationId: 'org1',
          organization: { inn: '7700000000' },
        }),
      },
      organization: { findFirst: vi.fn() },
    });
    const out = await matchRow(prisma, row({ accountCandidates: ['260509-1905'] }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.orderExternalId).toBe('EXT-1');
  });

  it('account matches order without externalId → falls back to org-level (organizationInn)', async () => {
    const prisma = db({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'o1',
          externalId: null,
          organizationId: 'org1',
          organization: { inn: '7700000000' },
        }),
      },
    });
    const out = await matchRow(prisma, row({ accountCandidates: ['260509-1905'] }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') {
      expect(out.dto.orderExternalId).toBeUndefined();
      expect(out.dto.organizationInn).toBe('7700000000');
    }
  });

  it('no account, exact by INN → org-level dto', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org2', inn: '9909676723' }) },
    });
    const out = await matchRow(prisma, row({ counterpartyInn: '9909676723' }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.organizationInn).toBe('9909676723');
  });

  it('no account, no INN, fuzzy name hit → queue with candidate', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org3', name: 'ХОЛДИНГ ГЕФЕСТ ООО' }),
      },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'Холдинг Гефест' }));
    expect(out.route).toBe('queue');
    if (out.route === 'queue') {
      expect(out.candidateOrgId).toBe('org3');
      expect(out.matchMethod).toBe('name_fuzzy');
    }
  });

  it('nothing matches → queue with matchMethod none', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'НЕИЗВЕСТНО' }));
    expect(out.route).toBe('queue');
    if (out.route === 'queue') expect(out.matchMethod).toBe('none');
  });

  // `У-55` (этап 7): прежний страж утверждал, что автосоздание организаций
  // ЗАПРЕЩЕНО (решение владельца №5). Решение `Р-2` действующего ТЗ это
  // отменило, поэтому страж переписан под новое правило, а не «починен»
  // откатом кода (ловушка 4 в CLAUDE.md §14).
  //
  // Разделение обязанностей осталось прежним: матчер — ЧИСТЫЙ поиск, он ничего
  // не создаёт. Организации заводит импорт (`auto-create.ts`) ДО сопоставления,
  // и матчер потом находит их обычной веткой «ИНН → организация».
  it('У-55: матчер сам ничего не создаёт — новый ИНН уходит в очередь', async () => {
    const orgFindFirst = vi.fn().mockResolvedValue(null); // организации с таким ИНН нет
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: orgFindFirst, findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const out = await matchRow(prisma, {
      externalId: 'p-new-inn',
      paidAt: '2026-08-07T00:00:00Z',
      amount: 100,
      isRefund: false,
      purpose: null,
      counterpartyName: 'ООО Новая',
      counterpartyInn: '7707083893',
      accountCandidates: [],
      paymentOrderNumber: null,
      vatAmount: null,
    } as never);
    expect(out.route).toBe('queue');
    // Мок призмы вообще не имеет organization.create — попытка создать упала бы TypeError.
    expect(orgFindFirst).toHaveBeenCalled();
  });

  it('У-49: как только организация с таким ИНН появилась — матчер привязывает платёж к ней', async () => {
    // Ровно этим пользуется автосоздание: создать организацию, а привязку
    // отдать штатному матчеру, не заводя второй ветки.
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-new', inn: '7707083893' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never;
    const out = await matchRow(prisma, {
      externalId: 'p-new-inn',
      paidAt: '2026-08-07T00:00:00Z',
      amount: 100,
      isRefund: false,
      purpose: null,
      counterpartyName: 'ООО Новая',
      counterpartyInn: '7707083893',
      accountCandidates: [],
      paymentOrderNumber: null,
      vatAmount: null,
    } as never);
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.organizationInn).toBe('7707083893');
  });
});

/**
 * `У-88`: ступень «ключ названия → организация» между ИНН и fuzzy. Мок
 * `organization.findFirst` отвечает по форме `where`: ступень ИНН (`where.inn`),
 * ступень ключа (`where.nameKey`), fuzzy (`where.name`).
 */
function orgStages(byStage: { inn?: unknown; nameKey?: unknown; name?: unknown }) {
  const findFirst = vi.fn(async (arg: { where: Record<string, unknown> }) => {
    if ('inn' in arg.where) return byStage.inn ?? null;
    if ('nameKey' in arg.where) return byStage.nameKey ?? null;
    return byStage.name ?? null;
  });
  return { prisma: db({ organization: { findFirst } }), findFirst };
}

describe('matchRow: ступень «ключ названия → организация» (У-88)', () => {
  it('то же название с другой орг-формой → exact по организации', async () => {
    const { prisma, findFirst } = orgStages({
      nameKey: { id: 'org-1', inn: null, companyId: 'co-1' },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'РОМАШКА АО' }), {
      companyId: 'co-1',
    });
    expect(out.route).toBe('exact');
    if (out.route === 'exact') {
      // Организация без ИНН адресуется локальным id — иначе writer её не найдёт.
      expect(out.dto.organizationId).toBe('org-1');
    }
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1', nameKey: 'РОМАШКА' } })
    );
  });

  it('название в кавычках и без — один и тот же ключ', async () => {
    const { prisma, findFirst } = orgStages({
      nameKey: { id: 'org-1', inn: null, companyId: 'co-1' },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'ООО «Ромашка»' }), {
      companyId: 'co-1',
    });
    expect(out.route).toBe('exact');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1', nameKey: 'РОМАШКА' } })
    );
  });

  it('похожее, но другое название → очередь (ключ не совпал)', async () => {
    // Ключа нет, но fuzzy по первому слову находит кандидата — это очередь.
    const { prisma } = orgStages({ nameKey: null, name: { id: 'org-cand' } });
    const out = await matchRow(prisma, row({ counterpartyName: 'РОМАШКА-СЕРВИС ООО' }), {
      companyId: 'co-1',
    });
    expect(out.route).toBe('queue');
    if (out.route === 'queue') {
      expect(out.candidateOrgId).toBe('org-cand');
      expect(out.matchMethod).toBe('name_fuzzy');
    }
  });

  it('организация другой компании по ключу не матчится (C8)', async () => {
    // Скоуп зашит в `where`: findFirst с чужой компанией ничего не вернёт.
    const { prisma, findFirst } = orgStages({ nameKey: null, name: null });
    const out = await matchRow(prisma, row({ counterpartyName: 'ООО «Ромашка»' }), {
      companyId: 'co-mine',
    });
    expect(out.route).toBe('queue');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-mine', nameKey: 'РОМАШКА' } })
    );
  });

  it('компания не определена → ступень пропускается (матчить «во всех» нельзя)', async () => {
    const { prisma, findFirst } = orgStages({ name: null });
    await matchRow(prisma, row({ counterpartyName: 'ООО «Ромашка»' }));
    const stages = findFirst.mock.calls.map((c) => Object.keys(c[0].where));
    expect(stages.some((keys) => keys.includes('nameKey'))).toBe(false);
  });

  it('ИНН важнее ключа: ступень ключа не запускается', async () => {
    const { prisma, findFirst } = orgStages({
      inn: { id: 'org-inn', inn: '7707083893' },
      nameKey: { id: 'org-key', inn: null, companyId: 'co-1' },
    });
    const out = await matchRow(
      prisma,
      row({ counterpartyInn: '7707083893', counterpartyName: 'ООО «Ромашка»' }),
      { companyId: 'co-1' }
    );
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.organizationInn).toBe('7707083893');
    const stages = findFirst.mock.calls.map((c) => Object.keys(c[0].where));
    expect(stages.some((keys) => keys.includes('nameKey'))).toBe(false);
  });

  it('пустой ключ (название из одной орг-формы) ступень не запускает', async () => {
    const { prisma, findFirst } = orgStages({ name: null });
    await matchRow(prisma, row({ counterpartyName: 'ООО' }), { companyId: 'co-1' });
    const stages = findFirst.mock.calls.map((c) => Object.keys(c[0].where));
    expect(stages.some((keys) => keys.includes('nameKey'))).toBe(false);
  });
});

// Ступень ИНН искала СЫРОЕ значение из файла, а автосоздание кладёт в базу
// нормализованное (`normalizeInn` восстанавливает ведущие нули). На
// 11-значном ИНН это расходилось: организация создана с `0…`, а ре-матч по
// сырому её не находил — строка оставалась в очереди при созданной компании.
describe('matchRow: ступень ИНН нормализует значение из файла', () => {
  it('11 цифр из файла ищутся как 12 с ведущим нулём', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'org-1', inn: '012345678901' });
    const prisma = db({ organization: { findFirst } });
    const out = await matchRow(prisma, row({ counterpartyInn: '12345678901' }));
    expect(out.route).toBe('exact');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inn: '012345678901' } })
    );
  });
});
