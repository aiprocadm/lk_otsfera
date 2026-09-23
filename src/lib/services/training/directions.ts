import type { PrismaClient, TrainingDirection } from '@prisma/client';
import { isManagerLeader } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isUniqueViolationOn } from '@/lib/db/uniqueViolation';

type DirectionsError = 'forbidden' | 'validation' | 'not_found' | 'slug_taken';
type Result<T> = ({ ok: true } & T) | { ok: false; error: DirectionsError };

/**
 * Прогон сопровождения №37: запись по id, которого нет (`P2025`), — это
 * «не найдено», а не падение сервера. Без разбора PATCH/DELETE по удалённому
 * направлению отвечали 500 вместо 404.
 */
function isRecordMissing(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2025';
}

/** admin или руководитель (role='leader') настраивают справочники (§10/§11). */
function canManageSettings(session: SessionPayload): boolean {
  return session.role === 'admin' || isManagerLeader(session);
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

/**
 * ВСЕ направления, включая неактивные, — для сопоставления Excel-импорта
 * каталога по имени (`У-137`): позиция может ссылаться на направление,
 * деактивированное после экспорта, и round-trip не должен ломаться.
 */
export async function listAllDirectionOptions(prisma: PrismaClient): Promise<DirectionOption[]> {
  return prisma.trainingDirection.findMany({
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
  try {
    const direction = await prisma.trainingDirection.create({
      data: { name, slug: args.slug?.trim() || null, sortOrder: args.sortOrder ?? 0 },
    });
    return { ok: true, direction };
  } catch (e) {
    // Прогон сопровождения №37: slug уникален, и занятый код раньше доходил до
    // человека как 500. Чужое ограничение не прячем — пробрасываем.
    if (isUniqueViolationOn(e, 'slug')) return { ok: false, error: 'slug_taken' };
    throw e;
  }
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
  try {
    const direction = await prisma.trainingDirection.update({ where: { id: args.id }, data });
    return { ok: true, direction };
  } catch (e) {
    if (isRecordMissing(e)) return { ok: false, error: 'not_found' };
    throw e;
  }
}

export async function deactivateDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<Result<{ direction: TrainingDirection }>> {
  if (!canManageSettings(session)) return { ok: false, error: 'forbidden' };
  try {
    const direction = await prisma.trainingDirection.update({
      where: { id: args.id },
      data: { isActive: false },
    });
    return { ok: true, direction };
  } catch (e) {
    if (isRecordMissing(e)) return { ok: false, error: 'not_found' };
    throw e;
  }
}
