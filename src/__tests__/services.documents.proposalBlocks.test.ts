import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { dealScopeWhere } = vi.hoisted(() => ({ dealScopeWhere: vi.fn() }));
vi.mock('@/lib/services/deals/board', () => ({ dealScopeWhere }));

import {
  listDealProposals,
  listOrganizationProposals,
} from '@/lib/services/documents/proposalBlocks';

/**
 * `У-166` (этап 7) — блоки «Коммерческие предложения» на карточках сделки и
 * организации.
 *
 * Проверяем не «список пришёл», а три вещи, из-за которых блок опасен: чужая
 * сделка, чужая компания и заменённые перевыпуском версии, у которых тот же
 * номер.
 */
const MGR = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

const DOC = {
  id: 'kp-1',
  type: 'commercial_proposal',
  number: 'КП-2026-4',
  status: 'sent',
  amountGross: { toFixed: (n: number) => (12000).toFixed(n) },
  sentAt: new Date('2026-09-01T10:00:00.000Z'),
  validUntil: new Date('2026-09-15T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T09:00:00.000Z'),
};

function makePrisma(over: { deal?: unknown | null; docs?: unknown[] } = {}) {
  const documentFindMany = vi.fn(async (args: { where?: unknown }) => {
    void args;
    return over.docs ?? [DOC];
  });
  const prisma = {
    // `?? ` здесь нельзя: `null` — это и есть проверяемый случай «сделки нет».
    deal: {
      findFirst: vi.fn(async () => ('deal' in over ? over.deal : { id: 'deal-1' })),
    },
    document: { findMany: documentFindMany },
  } as unknown as PrismaClient;
  return { prisma, documentFindMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  dealScopeWhere.mockReturnValue({ companyId: 'co-A' });
});

describe('listDealProposals', () => {
  it('клиентские роли не проходят: цены и скидки — не для посредника и не для клиента', async () => {
    for (const role of ['partner', 'organization', 'student']) {
      const { prisma } = makePrisma();
      expect(
        await listDealProposals(prisma, { sub: 'x', role } as unknown as SessionPayload, {
          dealId: 'deal-1',
        }),
        role
      ).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('сделка сверяется СКОУПОМ сотрудника, а не берётся по идентификатору', async () => {
    // Иначе блок отдал бы чужие переговоры тому, кто знает лишь id сделки.
    const { prisma } = makePrisma({ deal: null });
    expect(await listDealProposals(prisma, MGR(), { dealId: 'чужая' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(dealScopeWhere).toHaveBeenCalled();
  });

  it('заменённые версии не показываются: у них тот же номер', async () => {
    const { prisma, documentFindMany } = makePrisma();
    await listDealProposals(prisma, MGR(), { dealId: 'deal-1' });
    expect(documentFindMany.mock.calls[0]![0].where).toEqual({
      dealId: 'deal-1',
      type: 'commercial_proposal',
      supersededAt: null,
    });
  });

  it('сумма уезжает СТРОКОЙ: Decimal через границу server→client не проходит', async () => {
    const { prisma } = makePrisma();
    const res = await listDealProposals(prisma, MGR(), { dealId: 'deal-1' });
    expect(res.ok && res.rows[0]!.amountGross).toBe('12000.00');
  });

  it('истёкшее показывается истёкшим сразу, не дожидаясь ночной задачи', async () => {
    const { prisma } = makePrisma();
    const res = await listDealProposals(
      prisma,
      MGR(),
      { dealId: 'deal-1' },
      new Date('2026-09-16T09:00:00.000Z')
    );
    expect(res.ok && res.rows[0]!.status).toBe('expired');
  });
});

describe('listOrganizationProposals', () => {
  it('граница компании берётся у ДОКУМЕНТА', async () => {
    // У организации поле компании необязательное; у документа — обязательное.
    const { prisma, documentFindMany } = makePrisma();
    await listOrganizationProposals(prisma, MGR(), { organizationId: 'org-1' });
    expect(documentFindMany.mock.calls[0]![0].where).toMatchObject({
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      type: 'commercial_proposal',
      supersededAt: null,
      companyId: 'co-A',
    });
  });

  it('администратор видит всё: компании в его сессии может не быть вовсе', async () => {
    const { prisma, documentFindMany } = makePrisma();
    await listOrganizationProposals(
      prisma,
      { sub: 'a', role: 'admin' } as unknown as SessionPayload,
      { organizationId: 'org-1' }
    );
    expect(documentFindMany.mock.calls[0]![0].where).not.toHaveProperty('companyId');
  });

  it('клиентские роли не проходят', async () => {
    const { prisma } = makePrisma();
    expect(
      await listOrganizationProposals(
        prisma,
        { sub: 'p', role: 'partner' } as unknown as SessionPayload,
        { organizationId: 'org-1' }
      )
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});
