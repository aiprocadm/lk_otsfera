import type { PrismaClient, TrainingDirection } from '@prisma/client';
import { isManagerLeader } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';

type DirectionsError = 'forbidden' | 'validation' | 'not_found';
type Result<T> = ({ ok: true } & T) | { ok: false; error: DirectionsError };

/** admin или руководитель (manager+managerRole='leader') настраивают справочники (§10/§11). */
function canManageSettings(session: SessionPayload): boolean {
  return (
    session.role === 'admin' || isManagerLeader(session)
  );
}

export async function listDirections(
  prisma: PrismaClient,
  _session: SessionPayload,
  opts?: { includeInactive?: boolean }
): Promise<Result<{ directions: TrainingDirection[] }>> {
  const directions = await prisma.trainingDirection.findMany({
    where: opts?.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return { ok: true, directions };
}

/**
 * Узкая строка справочника направлений для селектов и фильтров UI: ровно
 * id+name, без служебных полей TrainingDirection.
 */
export type DirectionOption = { id: string; name: string };

/**
 * Активные направления для селектов форм (мастер заявки на обучение). Порядок —
 * как у `listDirections` (sortOrder → name). Без Result-обёртки: у справочника
 * нет доменных отказов, читает его любой, кто уже прошёл гард страницы.
 */
export async function listDirectionOptions(prisma: PrismaClient): Promise<DirectionOption[]> {
  return prisma.trainingDirection.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
}

/**
 * Активные направления для фильтра реестров удостоверений (ФТ-6.1/6.2).
 * Отличие от `listDirectionOptions` — порядок только по sortOrder;
 * исторический порядок реестров сохранён намеренно, оба варианта пиннятся
 * тестами.
 */
export async function listDirectionFilterOptions(prisma: PrismaClient): Promise<DirectionOption[]> {
  return prisma.trainingDirection.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });
}

export async function createDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { name: string; slug?: string; sortOrder?: number }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const name = args.name?.trim();
  if (!name) return { ok: false, error: 'validation' };
  const direction = await prisma.trainingDirection.create({
    data: { name, slug: args.slug?.trim() || null, sortOrder: args.sortOrder ?? 0 },
  });
  return { ok: true, direction };
}

export async function updateDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; name?: string; sortOrder?: number }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const data: { name?: string; sortOrder?: number } = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) return { ok: false, error: 'validation' };
    data.name = name;
  }
  if (args.sortOrder !== undefined) data.sortOrder = args.sortOrder;
  const direction = await prisma.trainingDirection.update({ where: { id: args.id }, data });
  return { ok: true, direction };
}

export async function deactivateDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  const direction = await prisma.trainingDirection.update({
    where: { id: args.id },
    data: { isActive: false },
  });
  return { ok: true, direction };
}
