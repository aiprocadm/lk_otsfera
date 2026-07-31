import type { Deal, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { dealScopeWhere } from './board';

export type DealInput = {
  title?: string | null;
  amount?: string | null;
  organizationId?: string | null;
  managerId?: string | null;
  expectedCloseAt?: string | null;
};

export type DealCrudResult =
  | { ok: true; deal: Deal }
  | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] };

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

type ParsedInput = {
  title: string;
  amount: string | null;
  expectedCloseAt: Date | null;
};

function parseInput(
  input: DealInput
): { ok: true; values: ParsedInput } | { ok: false; messages: string[] } {
  const messages: string[] = [];
  const title = input.title?.trim() ?? '';
  if (!title) messages.push('Укажите название сделки');

  let amount: string | null = null;
  const rawAmount = input.amount?.trim();
  if (rawAmount) {
    const normalized = rawAmount.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalized))
      messages.push('Сумма — число, до двух знаков после запятой');
    else amount = normalized;
  }

  let expectedCloseAt: Date | null = null;
  const rawDate = input.expectedCloseAt?.trim();
  if (rawDate) {
    const parsed = new Date(`${rawDate}T00:00:00.000Z`);
    // Формат + реальная календарная дата: «2026-13-99» проходит регулярку,
    // но даёт Invalid Date — тоже отклоняем сообщением, а не падением вставки.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || Number.isNaN(parsed.getTime())) {
      messages.push('Некорректная дата закрытия');
    } else {
      expectedCloseAt = parsed;
    }
  }

  if (messages.length) return { ok: false, messages };
  return { ok: true, values: { title, amount, expectedCloseAt } };
}

/** Организация обязана быть из компании сессии (C8); admin — любая. */
async function resolveOrganizationId(
  prisma: PrismaClient,
  session: SessionPayload,
  raw: string | null | undefined
): Promise<{ ok: true; organizationId: string | null } | { ok: false }> {
  const organizationId = raw?.trim() || null;
  if (!organizationId) return { ok: true, organizationId: null };
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { companyId: true },
  });
  if (!org) return { ok: false };
  if (session.role !== 'admin' && org.companyId !== session.companyId) return { ok: false };
  return { ok: true, organizationId };
}

/** Ответственный: менеджер своей компании; admin — любой активный менеджер. */
async function resolveManagerId(
  prisma: PrismaClient,
  session: SessionPayload,
  raw: string | null | undefined
): Promise<{ ok: true; managerId: string } | { ok: false }> {
  const managerId = raw?.trim() || session.sub;
  if (managerId === session.sub) return { ok: true, managerId };
  const candidate = await prisma.user.findUnique({
    where: { id: managerId },
    select: { role: true, isActive: true, companyId: true },
  });
  if (!candidate || candidate.role !== 'manager' || !candidate.isActive) return { ok: false };
  if (session.role !== 'admin' && candidate.companyId !== session.companyId) return { ok: false };
  return { ok: true, managerId };
}

/**
 * Этап 6 — создание/редактирование сделки (внутренний контур). Компания —
 * из сессии (admin без companyId создавать не может — сделке нужна граница C8).
 */
export async function createDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  input: DealInput
): Promise<DealCrudResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const parsed = parseInput(input);
  if (!parsed.ok) return { ok: false, error: 'validation', messages: parsed.messages };

  const org = await resolveOrganizationId(prisma, session, input.organizationId);
  if (!org.ok) return { ok: false, error: 'forbidden' };
  const manager = await resolveManagerId(prisma, session, input.managerId);
  if (!manager.ok)
    return { ok: false, error: 'validation', messages: ['Ответственный менеджер не найден'] };

  const deal = await prisma.deal.create({
    data: {
      companyId: session.companyId,
      title: parsed.values.title,
      amount: parsed.values.amount,
      expectedCloseAt: parsed.values.expectedCloseAt,
      organizationId: org.organizationId,
      managerId: manager.managerId,
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'deal_created',
    entity: 'deal',
    entityId: deal.id,
    after: { organizationId: org.organizationId, managerId: manager.managerId },
  });

  return { ok: true, deal };
}

export async function updateDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string } & DealInput
): Promise<DealCrudResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };

  const existing = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.status !== 'open')
    return {
      ok: false,
      error: 'validation',
      messages: ['Завершённую сделку нельзя редактировать'],
    };

  const parsed = parseInput(args);
  if (!parsed.ok) return { ok: false, error: 'validation', messages: parsed.messages };

  const org = await resolveOrganizationId(prisma, session, args.organizationId);
  if (!org.ok) return { ok: false, error: 'forbidden' };
  const manager = await resolveManagerId(prisma, session, args.managerId);
  if (!manager.ok)
    return { ok: false, error: 'validation', messages: ['Ответственный менеджер не найден'] };

  const deal = await prisma.deal.update({
    where: { id: existing.id },
    data: {
      title: parsed.values.title,
      amount: parsed.values.amount,
      expectedCloseAt: parsed.values.expectedCloseAt,
      organizationId: org.organizationId,
      managerId: manager.managerId,
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'deal_updated',
    entity: 'deal',
    entityId: deal.id,
    after: { organizationId: org.organizationId, managerId: manager.managerId },
  });

  return { ok: true, deal };
}
