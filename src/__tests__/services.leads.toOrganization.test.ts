import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { resolveLeadIssueScope, recordAudit, logError } = vi.hoisted(() => ({
  resolveLeadIssueScope: vi.fn(),
  recordAudit: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/services/documents/issueScope', () => ({ resolveLeadIssueScope }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import { createOrganizationFromLead } from '@/lib/services/leads/toOrganization';

/**
 * `У-161` (этап 7) — «Создать организацию из лида» с переносом коммерческих
 * предложений.
 *
 * Проверяем не «создалось», а границы, из-за которых это действие вообще
 * опасно: чужая организация, чужая компания, чужие бумаги на том же лиде и
 * ограничения целостности, которые база проверит уже после нас.
 */
const MGR = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

const LEAD = {
  id: 'lead-1',
  clientCompanyName: 'ООО «Ромашка»',
  clientContactName: 'Иван',
  organizationId: null as string | null,
  assignedManagerId: 'm1',
  status: 'new' as const,
};

function makePrisma(over: { twin?: unknown; moved?: number } = {}) {
  /**
   * Аргумент объявлен и ИСПОЛЬЗУЕТСЯ (возвращается в ответе), а не помечен
   * подчёркиванием: без объявленного параметра `mock.calls` получает пустой
   * кортеж, и обращение к `calls[0][0]` не собирается.
   */
  type AnyArgs = { data?: any; where?: any };
  const orgCreate = vi.fn(async (args: AnyArgs) => ({ id: 'org-new', args }));
  const leadUpdate = vi.fn(async (args: AnyArgs) => args);
  const dealUpdateMany = vi.fn(async (args: AnyArgs) => ({ count: 1, args }));
  const documentUpdateMany = vi.fn(async (args: AnyArgs) => ({
    count: over.moved ?? 2,
    args,
  }));
  const tx = {
    organization: { create: orgCreate },
    lead: { update: leadUpdate },
    deal: { updateMany: dealUpdateMany },
    document: { updateMany: documentUpdateMany },
  };
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => over.twin ?? null),
      findFirst: vi.fn(async () => over.twin ?? null),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, orgCreate, leadUpdate, dealUpdateMany, documentUpdateMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveLeadIssueScope.mockResolvedValue({ ok: true, companyId: 'co-A', lead: LEAD });
  recordAudit.mockResolvedValue(undefined);
});

describe('createOrganizationFromLead — гейт', () => {
  it('отказ гейта отдаётся как есть: правило про лида живёт в одном месте', async () => {
    // Гейт общий с выпуском КП. Заведи здесь второе правило — оно разъедется
    // с первым, и «можно выставить, но нельзя завести» станет вопросом удачи.
    for (const error of ['forbidden', 'not_found', 'no_company', 'lead_not_active'] as const) {
      resolveLeadIssueScope.mockResolvedValue({ ok: false, error });
      const { prisma, orgCreate } = makePrisma();
      expect(await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' }), error).toEqual({
        ok: false,
        error,
      });
      expect(orgCreate, error).not.toHaveBeenCalled();
    }
  });

  it('у лида уже есть организация — отказ, а не второй дубль клиента', async () => {
    resolveLeadIssueScope.mockResolvedValue({
      ok: true,
      companyId: 'co-A',
      lead: { ...LEAD, organizationId: 'org-old' },
    });
    const { prisma, orgCreate } = makePrisma();
    expect(await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' })).toEqual({
      ok: false,
      error: 'already_linked',
    });
    expect(orgCreate).not.toHaveBeenCalled();
  });

  it('пустое название клиента — отказ: организацию некому назвать', async () => {
    resolveLeadIssueScope.mockResolvedValue({
      ok: true,
      companyId: 'co-A',
      lead: { ...LEAD, clientCompanyName: '   ' },
    });
    const { prisma } = makePrisma();
    expect(await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' })).toEqual({
      ok: false,
      error: 'name_required',
    });
  });
});

describe('createOrganizationFromLead — тёзка по ИНН', () => {
  it('тёзка в СВОЕЙ компании привязывается, а не дублируется', async () => {
    // Это тот же клиент, просто заведённый раньше. Второй карточкой мы
    // раздвоили бы его историю: часть бумаг в одной, часть в другой.
    const { prisma, orgCreate, documentUpdateMany } = makePrisma({
      twin: { id: 'org-old', companyId: 'co-A' },
    });
    const res = await createOrganizationFromLead(prisma, MGR(), {
      leadId: 'lead-1',
      inn: '7707083893',
    });
    expect(res).toEqual({ ok: true, organizationId: 'org-old', created: false, transferred: 2 });
    expect(orgCreate).not.toHaveBeenCalled();
    // Бумаги всё равно переезжают — ради этого действие и затевалось.
    expect(documentUpdateMany).toHaveBeenCalled();
  });

  it('тёзка в ЧУЖОЙ компании — отказ: это не наш клиент', async () => {
    // ИНН у организации уникален ГЛОБАЛЬНО, поэтому тёзка может жить в
    // соседней компании-исполнителе. Привязать её значило бы отдать чужому
    // клиенту наши бумаги: канал видимости строится по контрагенту и про
    // компанию ничего не знает.
    const { prisma, orgCreate, documentUpdateMany } = makePrisma({
      twin: { id: 'org-foreign', companyId: 'co-B' },
    });
    expect(
      await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1', inn: '7707083893' })
    ).toEqual({ ok: false, error: 'org_in_other_company' });
    expect(orgCreate).not.toHaveBeenCalled();
    expect(documentUpdateMany).not.toHaveBeenCalled();
  });

  it('без ИНН дубль ищется по названию в пределах СВОЕЙ компании', async () => {
    const { prisma } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    const call = (prisma.organization.findFirst as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.companyId).toBe('co-A');
    expect(call.where.nameKey).toBeTruthy();
  });
});

describe('createOrganizationFromLead — перенос предложений', () => {
  it('организация заводится в компании СОТРУДНИКА, а не в новой', async () => {
    // Образец из админского экрана заводит `Company` на каждую организацию —
    // с ним организация сразу оказалась бы «чужой компании», и перенос отказал
    // бы сам себе.
    const { prisma, orgCreate } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(orgCreate.mock.calls[0]![0].data.companyId).toBe('co-A');
    expect(orgCreate.mock.calls[0]![0].data.name).toBe('ООО «Ромашка»');
  });

  it('переносятся только предложения СВОЕЙ компании', async () => {
    // Лиды в проекте single-tenant, и на одном лиде могут висеть предложения
    // РАЗНЫХ компаний-исполнителей. Без фильтра бумага чужого учебного центра
    // уехала бы к нашему клиенту.
    const { prisma, documentUpdateMany } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(documentUpdateMany.mock.calls[0]![0].where).toEqual({
      leadId: 'lead-1',
      type: 'commercial_proposal',
      companyId: 'co-A',
    });
  });

  it('контрагент проставляется ОДНИМ оператором и целиком', async () => {
    // Половина контрагента нарушает `Document_counterparty_both_or_none`, а
    // двумя запросами промежуточное состояние неизбежно.
    const { prisma, documentUpdateMany } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(documentUpdateMany.mock.calls[0]![0].data).toEqual({
      counterpartyType: 'organization',
      counterpartyId: 'org-new',
    });
  });

  it('связь с лидом, состояние и компания документа НЕ трогаются', async () => {
    // `leadId` обнулять нельзя (`Document_proposal_needs_lead`), состояние —
    // не событие переноса, а `companyId` держит уникальность номера.
    const { prisma, documentUpdateMany } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    const data = documentUpdateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('leadId');
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('companyId');
  });

  it('состояние предложения в фильтр НЕ входит: переезжают все, включая отправленные', async () => {
    // Оставить отправленное на лиде значило бы сказать клиенту «мы вам ничего
    // не предлагали», и принять его в кабинете стало бы нечем.
    const { prisma, documentUpdateMany } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(documentUpdateMany.mock.calls[0]![0].where).not.toHaveProperty('status');
    expect(documentUpdateMany.mock.calls[0]![0].where).not.toHaveProperty('supersededAt');
  });

  it('лид и его сделка получают организацию — иначе выигрыш сделки упрётся в «нужна организация»', async () => {
    const { prisma, leadUpdate, dealUpdateMany } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { organizationId: 'org-new' },
    });
    expect(dealUpdateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1' },
      data: { organizationId: 'org-new' },
    });
  });

  it('всё делается ОДНОЙ транзакцией: половина переноса хуже, чем ничего', async () => {
    const { prisma } = makePrisma();
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('createOrganizationFromLead — журнал', () => {
  it('создание и привязка существующей — РАЗНЫЕ события', async () => {
    const fresh = makePrisma();
    await createOrganizationFromLead(fresh.prisma, MGR(), { leadId: 'lead-1' });
    expect(recordAudit.mock.calls[0]![1].action).toBe('organization_created_manual');

    vi.clearAllMocks();
    resolveLeadIssueScope.mockResolvedValue({ ok: true, companyId: 'co-A', lead: LEAD });
    const linked = makePrisma({ twin: { id: 'org-old', companyId: 'co-A' } });
    await createOrganizationFromLead(linked.prisma, MGR(), { leadId: 'lead-1', inn: '7707083893' });
    expect(recordAudit.mock.calls[0]![1].action).toBe('lead_organization_linked');
  });

  it('в журнале видно, сколько бумаг переехало', async () => {
    const { prisma } = makePrisma({ moved: 3 });
    await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(recordAudit.mock.calls[0]![1].after).toEqual({
      leadId: 'lead-1',
      transferredProposals: 3,
    });
  });

  it('сбой журнала не отменяет уже сделанного', async () => {
    // Организация создана, бумаги переехали. Откатывать это ради записи в
    // аудит хуже, чем остаться без записи (§3).
    recordAudit.mockRejectedValue(new Error('журнал недоступен'));
    const { prisma } = makePrisma();
    const res = await createOrganizationFromLead(prisma, MGR(), { leadId: 'lead-1' });
    expect(res).toMatchObject({ ok: true, organizationId: 'org-new' });
    expect(logError).toHaveBeenCalled();
  });
});
