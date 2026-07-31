/**
 * §10 ТЗ v0.5 (этап 2) — справочник рабочих статусов заявки.
 *
 * Настраивают администратор и руководитель (§4 ТЗ) — тот же гейт, что и у
 * настраиваемых полей §11.
 *
 * Два инварианта, которые здесь охраняются:
 *   1. **Системные семь статусов нельзя удалить и деактивировать.** §10 говорит
 *      «использованный статус нельзя удалить физически»; семёрка используется
 *      всегда, поэтому у неё нет и деактивации.
 *   2. **Якорь уникален.** Якорь связывает статус с производным фактом (оплата,
 *      выдача документов, подпись бухгалтерии, закрытие). Два статуса с одним
 *      якорем сделали бы автоперевод неоднозначным.
 */

import type { PrismaClient, OrderStatusDefinition, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isManagerLeader } from '@/lib/auth/managerPolicy';

export type StatusDefinitionsError =
  'forbidden' | 'not_found' | 'invalid_key' | 'duplicate_key' | 'system_protected' | 'anchor_taken';

type Result<T> = ({ ok: true } & T) | { ok: false; error: StatusDefinitionsError };

/** Якоря — производные факты, к которым привязан статус. */
export const STATUS_ANCHORS = ['paid', 'documents_issued', 'accounting_signed', 'closed'] as const;
export type StatusAnchor = (typeof STATUS_ANCHORS)[number];

export function isStatusAnchor(value: string): value is StatusAnchor {
  return (STATUS_ANCHORS as readonly string[]).includes(value);
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

/** §4 ТЗ: «Настройка полей и статусов» — администратор ИЛИ руководитель. */
function requireStatusAdmin(session: SessionPayload): { ok: false; error: 'forbidden' } | null {
  if (session.role === 'admin') return null;
  if (isManagerLeader(session)) return null;
  return { ok: false, error: 'forbidden' };
}

/** Весь справочник по порядку: активные и деактивированные. */
export async function listStatusDefinitions(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<Result<{ rows: OrderStatusDefinition[] }>> {
  const denied = requireStatusAdmin(session);
  if (denied) return denied;
  return { ok: true, rows: await getOrderedStatuses(prisma) };
}

/**
 * Статусы по порядку — без гейта: используется карточкой заявки и сервисом
 * переходов, куда попадают уже авторизованные вызовы.
 */
export async function getOrderedStatuses(prisma: PrismaClient): Promise<OrderStatusDefinition[]> {
  return prisma.orderStatusDefinition.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Начальный статус новой заявки — «Черновик заявки».
 *
 * Возвращает id или null, если справочник почему-то пуст: создание заявки не
 * должно падать из-за настройки статусов (fail-open §3 CLAUDE.md), заявка
 * просто останется без рабочего статуса и будет видна как «Черновик» по
 * старому полю.
 */
export async function getInitialStatusId(
  prisma: Pick<PrismaClient, 'orderStatusDefinition'>
): Promise<string | null> {
  const draft = await prisma.orderStatusDefinition.findFirst({
    where: { key: 'draft', companyId: null },
    select: { id: true },
  });
  return draft?.id ?? null;
}

/** Статус по якорю (для автоперевода при наступлении факта). */
export async function findByAnchor(
  prisma: PrismaClient,
  anchor: StatusAnchor
): Promise<OrderStatusDefinition | null> {
  return prisma.orderStatusDefinition.findFirst({ where: { anchor, isActive: true } });
}

export type CreateStatusArgs = {
  key: string;
  label: string;
  sortOrder?: number;
  isTerminal?: boolean;
  anchor?: string | null;
};

export async function createStatusDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateStatusArgs
): Promise<Result<{ definition: OrderStatusDefinition }>> {
  const denied = requireStatusAdmin(session);
  if (denied) return denied;

  if (!KEY_RE.test(args.key)) return { ok: false, error: 'invalid_key' };

  const anchor = args.anchor ?? null;
  if (anchor !== null) {
    if (!isStatusAnchor(anchor)) return { ok: false, error: 'invalid_key' };
    const taken = await prisma.orderStatusDefinition.findFirst({ where: { anchor } });
    if (taken) return { ok: false, error: 'anchor_taken' };
  }

  try {
    const definition = await prisma.orderStatusDefinition.create({
      data: {
        key: args.key,
        label: args.label,
        sortOrder: args.sortOrder ?? 0,
        isTerminal: args.isTerminal ?? false,
        anchor,
      },
    });

    await recordAudit(prisma, {
      userId: session.sub,
      action: 'order_status_definition_create',
      entity: 'order_status_definition',
      entityId: definition.id,
      after: { key: definition.key, label: definition.label },
    });

    return { ok: true, definition };
  } catch (err) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr?.code === 'P2002') return { ok: false, error: 'duplicate_key' };
    throw err;
  }
}

export type UpdateStatusPatch = {
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
};

/**
 * Переименование, перестановка и деактивация.
 *
 * Ключ, якорь и терминальность после создания не меняются: на них завязаны
 * автопереходы и миграция, а «переименовать» §10 требует только названия.
 */
export async function updateStatusDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  patch: UpdateStatusPatch
): Promise<Result<{ definition: OrderStatusDefinition }>> {
  const denied = requireStatusAdmin(session);
  if (denied) return denied;

  const existing = await prisma.orderStatusDefinition.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'not_found' };

  // Системную строку переименовать и подвинуть можно, выключить — нет.
  if (existing.isSystem && patch.isActive === false) {
    return { ok: false, error: 'system_protected' };
  }

  const data: Prisma.OrderStatusDefinitionUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const definition = await prisma.orderStatusDefinition.update({ where: { id }, data });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_status_definition_update',
    entity: 'order_status_definition',
    entityId: definition.id,
    after: patch as Record<string, unknown>,
  });

  return { ok: true, definition };
}

/**
 * Физическое удаление — только для несистемной строки, которой никто не
 * пользуется. §10: использованный статус удалить нельзя, только деактивировать.
 */
export async function deleteStatusDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: StatusDefinitionsError }> {
  const denied = requireStatusAdmin(session);
  if (denied) return denied;

  const existing = await prisma.orderStatusDefinition.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.isSystem) return { ok: false, error: 'system_protected' };

  const usedByOrder = await prisma.order.findFirst({
    where: { statusId: id },
    select: { id: true },
  });
  const usedInHistory = await prisma.orderStatusChange.findFirst({
    where: { OR: [{ toId: id }, { fromId: id }] },
    select: { id: true },
  });
  if (usedByOrder || usedInHistory) return { ok: false, error: 'system_protected' };

  await prisma.orderStatusDefinition.delete({ where: { id } });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_status_definition_delete',
    entity: 'order_status_definition',
    entityId: id,
  });

  return { ok: true };
}
