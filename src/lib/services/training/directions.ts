import type { PrismaClient, TrainingDirection } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

type DirectionsError = 'forbidden' | 'validation' | 'not_found';
type Result<T> = ({ ok: true } & T) | { ok: false; error: DirectionsError };

/** admin или руководитель (manager+managerRole='leader') настраивают справочники (§10/§11). */
function canManageSettings(session: SessionPayload): boolean {
  return (
    session.role === 'admin' || (session.role === 'manager' && session.managerRole === 'leader')
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
