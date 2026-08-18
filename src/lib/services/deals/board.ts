import type { Prisma, PrismaClient } from '@prisma/client';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { resolveDealStages, stageForDeal, type DealStageView } from './stages';

/**
 * Этап 6 (ФТ-4.3) — доска сделок (канбан). Клон funnel/board с упрощённым
 * скоупом PR-1: менеджер видит СВОИ сделки (`managerId == sub`), leader/admin —
 * компанию (+ фильтр по менеджеру); клиентские роли — пустая доска/forbidden
 * (внутренний контур, staff-гейт на service-слое поверх middleware/nav/page).
 * Перенос в терминальную стадию: won → status=won + wonAt (создание заказа —
 * PR-2), lost → обязательная причина + lostAt. Из терминальной — запрещено.
 */

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

function isLeaderOrAdmin(session: SessionPayload): boolean {
  return (
    session.role === 'admin' || isManagerLeader(session)
  );
}

/** C8-скоуп PR-1: company-floor; рядовой менеджер дополнительно пришпилен к своим. */
export function dealScopeWhere(
  session: SessionPayload,
  opts: { managerId?: string | null } = {}
): Prisma.DealWhereInput {
  const companyId = session.companyId ?? '__none__';
  if (session.role === 'admin') {
    return opts.managerId ? { managerId: opts.managerId } : {};
  }
  if (isLeaderOrAdmin(session)) {
    return { companyId, ...(opts.managerId ? { managerId: opts.managerId } : {}) };
  }
  return { companyId, managerId: session.sub };
}

export type DealCard = {
  id: string;
  title: string;
  amount: string | null;
  organizationId: string | null;
  organizationName: string | null;
  managerId: string | null;
  managerName: string | null;
  status: 'open' | 'won' | 'lost';
  /** PR-2: заказ, созданный из выигранной сделки (ссылка в диалоге). */
  orderId: string | null;
  expectedCloseAt: Date | null;
  createdAt: Date;
};

export type DealColumn = { stage: DealStageView; cards: DealCard[] };
export type DealBoard = { stages: DealStageView[]; columns: DealColumn[] };

export async function getDealBoard(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { managerId?: string | null } = {}
): Promise<DealBoard> {
  // Клиентская роль → пустая доска (не раскрываем ни сделки, ни словарь стадий).
  if (!isStaff(session)) return { stages: [], columns: [] };
  const stages = await resolveDealStages(prisma, session.companyId ?? '');

  const deals = await prisma.deal.findMany({
    where: dealScopeWhere(session, opts),
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      title: true,
      amount: true,
      status: true,
      stageId: true,
      orderId: true,
      expectedCloseAt: true,
      createdAt: true,
      organizationId: true,
      managerId: true,
      organization: { select: { name: true } },
      manager: { select: { name: true } },
    },
  });

  const columns: DealColumn[] = stages.map((stage) => ({ stage, cards: [] }));
  const byStageId = new Map(columns.map((c) => [c.stage.id, c]));

  for (const d of deals) {
    const stage = stageForDeal(stages, d);
    if (!stage) continue; // якорь без стадии — карточку не показываем
    byStageId.get(stage.id)?.cards.push({
      id: d.id,
      title: d.title,
      amount: d.amount ? d.amount.toFixed(2) : null,
      organizationId: d.organizationId,
      organizationName: d.organization?.name ?? null,
      managerId: d.managerId,
      managerName: d.manager?.name ?? null,
      status: d.status,
      orderId: d.orderId,
      expectedCloseAt: d.expectedCloseAt,
      createdAt: d.createdAt,
    });
  }

  return { stages, columns };
}

export type MoveDealError =
  | 'not_found'
  | 'forbidden'
  | 'invalid_stage'
  | 'lifecycle_violation'
  | 'reason_required'
  | 'won_requires_order';

export async function moveDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string; toStageId: string; lostReason?: string }
): Promise<{ ok: true } | { ok: false; error: MoveDealError }> {
  if (!isStaff(session) || (session.role !== 'admin' && !session.companyId)) {
    return { ok: false, error: 'forbidden' };
  }

  const deal = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: { id: true, status: true, stageId: true, companyId: true },
  });
  // Скоуп в выборке: чужая сделка неотличима от несуществующей.
  if (!deal) return { ok: false, error: 'not_found' };
  if (deal.status !== 'open') return { ok: false, error: 'lifecycle_violation' };

  // Стадии — компании СДЕЛКИ (не сессии): admin (Model A, скоуп «всё») иначе
  // мог бы перевести сделку компании B в кастомную стадию компании A.
  const stages = await resolveDealStages(prisma, deal.companyId);
  const target = stages.find((s) => s.id === args.toStageId);
  if (!target) return { ok: false, error: 'invalid_stage' };

  // Синтетический дефолт-id не FK — stageId остаётся null (позиция из якоря).
  const persistStageId = args.toStageId.startsWith('default:') ? null : args.toStageId;

  if (target.statusAnchor === 'open') {
    await prisma.deal.update({ where: { id: deal.id }, data: { stageId: persistStageId } });
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'deal_stage_changed',
      entity: 'deal',
      entityId: deal.id,
      after: { toStageId: args.toStageId },
    });
    return { ok: true };
  }

  if (target.statusAnchor === 'lost') {
    const reason = (args.lostReason ?? '').trim();
    if (!reason) return { ok: false, error: 'reason_required' };
    await prisma.deal.update({
      where: { id: deal.id },
      data: { status: 'lost', lostAt: new Date(), lostReason: reason, stageId: persistStageId },
    });
  } else {
    // PR-2 (инвариант «выигрыш = заказ», решение §9-3): won-стадия достижима
    // только через winDeal (создаёт заказ) — обычным перемещением сделку
    // «выиграть без заказа» нельзя, в т.ч. прямым вызовом action.
    return { ok: false, error: 'won_requires_order' };
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'deal_stage_changed',
    entity: 'deal',
    entityId: deal.id,
    after: { toStageId: args.toStageId, statusAnchor: target.statusAnchor },
  });
  return { ok: true };
}
