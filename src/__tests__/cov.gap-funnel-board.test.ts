/**
 * Добор покрытия для src/lib/services/funnel/board.ts — гонка «лид исчез».
 *
 * `moveFunnelLead` сначала сам читает лид (`prisma.lead.findUnique`), а потом
 * зовёт lifecycle-функцию. Между этими двумя шагами строку могут удалить
 * (параллельная сессия/уборка), и тогда внутренний вызов вернёт `not_found`.
 * Диспетчер обязан пробросить именно `not_found` (а не свалить всё в
 * `lifecycle_violation`) и НЕ персистить `funnelStageId` — иначе стадия
 * «переехала бы» у несуществующего лида.
 *
 * Ветка `r.error === 'not_found' ? …` есть во всех четырёх якорях
 * (promoteLead / convertLeadToDeal / rejectLead / setLeadStatus); каждый из
 * них проверяем отдельно — мапперы независимы и разъезжаются при правках.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { promoteLead, rejectLead, setLeadStatus } = vi.hoisted(() => ({
  promoteLead: vi.fn(),
  rejectLead: vi.fn(),
  setLeadStatus: vi.fn(),
}));
vi.mock('@/lib/services/manager/leadLifecycle', () => ({
  promoteLead,
  rejectLead,
  setLeadStatus,
}));

const { convertLeadToDeal } = vi.hoisted(() => ({ convertLeadToDeal: vi.fn() }));
vi.mock('@/lib/services/deals/convert', () => ({ convertLeadToDeal }));

import { moveFunnelLead } from '@/lib/services/funnel/board';

const MGR: SessionPayload = { sub: 'm-race', role: 'manager', companyId: 'co-race' };

/** Лид «до гонки»: квалифицирован, с организацией (иначе якорь заказа даст org_required). */
const LEAD_BEFORE = {
  id: 'lead-race',
  status: 'qualified',
  funnelStageId: null,
  organizationId: 'org-race',
  assignedManagerId: 'm-race',
};

/** Прайма без кастомных стадий → resolveFunnelStages вернёт DEFAULT_FUNNEL_STAGES. */
function makePrisma() {
  const leadUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    funnelStage: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findUnique: vi.fn().mockResolvedValue(LEAD_BEFORE), update: leadUpdate },
  } as unknown as PrismaClient;
  return { prisma, leadUpdate };
}

const RACE = { ok: false as const, error: 'not_found' as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('moveFunnelLead — лид исчез между проверкой и lifecycle-вызовом', () => {
  it('promoteLead вернул not_found → not_found, стадия не персистится', async () => {
    promoteLead.mockResolvedValue(RACE);
    const { prisma, leadUpdate } = makePrisma();

    const res = await moveFunnelLead(prisma, MGR, {
      leadId: 'lead-race',
      toStageId: 'default:promoted_to_order',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(promoteLead).toHaveBeenCalledWith(prisma, { leadId: 'lead-race', managerId: 'm-race' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('convertLeadToDeal вернул not_found → not_found, стадия не персистится', async () => {
    convertLeadToDeal.mockResolvedValue(RACE);
    const { prisma, leadUpdate } = makePrisma();

    const res = await moveFunnelLead(prisma, MGR, {
      leadId: 'lead-race',
      toStageId: 'default:promoted_to_deal',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(convertLeadToDeal).toHaveBeenCalledWith(prisma, MGR, { leadId: 'lead-race' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('rejectLead вернул not_found → not_found (причина указана), стадия не персистится', async () => {
    rejectLead.mockResolvedValue(RACE);
    const { prisma, leadUpdate } = makePrisma();

    const res = await moveFunnelLead(prisma, MGR, {
      leadId: 'lead-race',
      toStageId: 'default:rejected',
      reason: 'клиент передумал',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(rejectLead).toHaveBeenCalledWith(prisma, {
      leadId: 'lead-race',
      managerId: 'm-race',
      reason: 'клиент передумал',
    });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('setLeadStatus вернул not_found → not_found, стадия не персистится', async () => {
    setLeadStatus.mockResolvedValue(RACE);
    const { prisma, leadUpdate } = makePrisma();

    const res = await moveFunnelLead(prisma, MGR, {
      leadId: 'lead-race',
      toStageId: 'default:in_review',
    });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(setLeadStatus).toHaveBeenCalledWith(prisma, {
      leadId: 'lead-race',
      managerId: 'm-race',
      status: 'in_review',
    });
    expect(leadUpdate).not.toHaveBeenCalled();
  });
});

/**
 * Зеркало гонки: тот же маппер, но lifecycle-функция отказала по бизнес-правилу.
 * Тогда наружу идёт `lifecycle_violation` — код, по которому UI показывает
 * «переход запрещён», а не «лид не найден». Обе половины тернарника должны
 * жить, иначе ошибка гонки замаскируется под нарушение правил (и наоборот).
 */
describe('moveFunnelLead — lifecycle-функция отказала по правилам перехода', () => {
  const DENY = { ok: false as const, error: 'lifecycle_violation' as const };

  it('promoteLead → lifecycle_violation, стадия не персистится', async () => {
    promoteLead.mockResolvedValue(DENY);
    const { prisma, leadUpdate } = makePrisma();

    expect(
      await moveFunnelLead(prisma, MGR, {
        leadId: 'lead-race',
        toStageId: 'default:promoted_to_order',
      })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('rejectLead → lifecycle_violation, стадия не персистится', async () => {
    rejectLead.mockResolvedValue(DENY);
    const { prisma, leadUpdate } = makePrisma();

    expect(
      await moveFunnelLead(prisma, MGR, {
        leadId: 'lead-race',
        toStageId: 'default:rejected',
        reason: 'дубль',
      })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('setLeadStatus → lifecycle_violation, стадия не персистится', async () => {
    setLeadStatus.mockResolvedValue(DENY);
    const { prisma, leadUpdate } = makePrisma();

    expect(
      await moveFunnelLead(prisma, MGR, { leadId: 'lead-race', toStageId: 'default:in_review' })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });
});
