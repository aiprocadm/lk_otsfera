/**
 * Unit-тесты этапа 6 PR-2 для воронки: ветка `promoted_to_deal` в
 * moveFunnelLead (src/lib/services/funnel/board.ts) диспетчеризует в
 * convertLeadToDeal (мокается модуль '@/lib/services/deals/convert'), плюс
 * канон DEFAULT_FUNNEL_STAGES из 6 стадий с «Передан в сделку».
 *
 *   - перенос в стадию с якорем promoted_to_deal зовёт convertLeadToDeal
 *     с (prisma, session, { leadId });
 *   - его forbidden → forbidden, lifecycle_violation → lifecycle_violation
 *     (funnelStageId не трогаем);
 *   - успех → funnelStageId персистится (кастомный cuid) / null (default:*).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { convertLeadToDeal } = vi.hoisted(() => ({ convertLeadToDeal: vi.fn() }));
vi.mock('@/lib/services/deals/convert', () => ({ convertLeadToDeal }));

import { moveFunnelLead } from '@/lib/services/funnel/board';
import { DEFAULT_FUNNEL_STAGES } from '@/lib/funnel/stages';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };

/** Кастомный словарь воронки c1: рабочая стадия + «в сделку» (реальные cuid-подобные id). */
const CUSTOM_STAGES = [
  {
    id: 'fs-work',
    companyId: 'c1',
    name: 'В работе',
    position: 0,
    statusAnchor: 'qualified',
    isTerminal: false,
    color: null,
  },
  {
    id: 'fs-deal',
    companyId: 'c1',
    name: 'В сделку',
    position: 1,
    statusAnchor: 'promoted_to_deal',
    isTerminal: true,
    color: null,
  },
];

function makeLead(over: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    status: 'qualified',
    funnelStageId: null,
    organizationId: 'org-1',
    assignedManagerId: 'm-1',
    ...over,
  };
}

function makePrisma(opts: { stages?: unknown[]; lead?: unknown } = {}) {
  const stageFindMany = vi.fn().mockResolvedValue(opts.stages ?? []);
  const leadFindUnique = vi.fn().mockResolvedValue(opts.lead ?? null);
  const leadUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    funnelStage: { findMany: stageFindMany },
    lead: { findUnique: leadFindUnique, update: leadUpdate },
  } as unknown as PrismaClient;
  return { prisma, stageFindMany, leadFindUnique, leadUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  convertLeadToDeal.mockResolvedValue({ ok: true, deal: { id: 'deal-new' }, lead: {} });
});

// ─── moveFunnelLead → convertLeadToDeal ───────────────────────────────────────

describe('moveFunnelLead — якорь promoted_to_deal', () => {
  it('дефолтная стадия default:promoted_to_deal: конверсия вызвана, funnelStageId → null', async () => {
    const { prisma, leadUpdate } = makePrisma({ lead: makeLead() }); // без кастомных → дефолты
    const res = await moveFunnelLead(prisma, MGR, {
      leadId: 'l-1',
      toStageId: 'default:promoted_to_deal',
    });
    expect(res).toEqual({ ok: true });
    expect(convertLeadToDeal).toHaveBeenCalledTimes(1);
    expect(convertLeadToDeal).toHaveBeenCalledWith(prisma, MGR, { leadId: 'l-1' });
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { funnelStageId: null },
    });
  });

  it('кастомная стадия с якорем promoted_to_deal: funnelStageId персистится (cuid)', async () => {
    const { prisma, leadUpdate } = makePrisma({ stages: CUSTOM_STAGES, lead: makeLead() });
    const res = await moveFunnelLead(prisma, MGR, { leadId: 'l-1', toStageId: 'fs-deal' });
    expect(res).toEqual({ ok: true });
    expect(convertLeadToDeal).toHaveBeenCalledTimes(1);
    expect(convertLeadToDeal).toHaveBeenCalledWith(prisma, MGR, { leadId: 'l-1' });
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { funnelStageId: 'fs-deal' },
    });
  });

  it('forbidden из convertLeadToDeal пробрасывается как forbidden, стадия не персистится', async () => {
    convertLeadToDeal.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { prisma, leadUpdate } = makePrisma({ stages: CUSTOM_STAGES, lead: makeLead() });
    expect(await moveFunnelLead(prisma, MGR, { leadId: 'l-1', toStageId: 'fs-deal' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('lifecycle_violation из convertLeadToDeal пробрасывается, стадия не персистится', async () => {
    convertLeadToDeal.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const { prisma, leadUpdate } = makePrisma({ lead: makeLead() });
    expect(
      await moveFunnelLead(prisma, MGR, { leadId: 'l-1', toStageId: 'default:promoted_to_deal' })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it('лид уже в якоре promoted_to_deal → перестановка без повторной конверсии', async () => {
    const { prisma, leadUpdate } = makePrisma({
      stages: CUSTOM_STAGES,
      lead: makeLead({ status: 'promoted_to_deal' }),
    });
    expect(await moveFunnelLead(prisma, MGR, { leadId: 'l-1', toStageId: 'fs-deal' })).toEqual({
      ok: true,
    });
    expect(convertLeadToDeal).not.toHaveBeenCalled();
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { funnelStageId: 'fs-deal' },
    });
  });
});

// ─── DEFAULT_FUNNEL_STAGES ────────────────────────────────────────────────────

describe('DEFAULT_FUNNEL_STAGES — канон 6 стадий этапа 6', () => {
  it('ровно 6 стадий с каноническими id и позициями 0..5', () => {
    expect(DEFAULT_FUNNEL_STAGES).toHaveLength(6);
    expect(DEFAULT_FUNNEL_STAGES.map((s) => s.id)).toEqual([
      'default:new',
      'default:in_review',
      'default:qualified',
      'default:promoted_to_order',
      'default:promoted_to_deal',
      'default:rejected',
    ]);
    expect(DEFAULT_FUNNEL_STAGES.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('«Передан в сделку»: позиция 4, терминальная, якорь promoted_to_deal', () => {
    expect(DEFAULT_FUNNEL_STAGES[4]).toEqual({
      id: 'default:promoted_to_deal',
      name: 'Передан в сделку',
      position: 4,
      statusAnchor: 'promoted_to_deal',
      isTerminal: true,
      color: null,
    });
  });

  it('терминальность: 3 рабочих + 3 терминальных стадии', () => {
    expect(DEFAULT_FUNNEL_STAGES.map((s) => s.isTerminal)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
