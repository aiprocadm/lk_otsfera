import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import type { TaskColumnView } from '@/lib/tasks/columns';

/**
 * Трек G3 — CRUD настраиваемых колонок канбана задач (по образцу
 * access/funnelStages.ts). Company-scoped (IDOR: чужая колонка → not_found),
 * роль-гейт (admin | manager-leader — руководитель конфигурирует), аудит.
 * `@@unique([companyId, position])` → дубль позиции = position_taken.
 */

export type TaskColumnErrorCode = 'forbidden' | 'not_found' | 'validation' | 'position_taken';

const anchorSchema = z.enum(['todo', 'in_progress', 'review', 'done']);

const inputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  position: z.number().int().min(0),
  statusAnchor: anchorSchema,
  // Строгий #RRGGBB (пикер шлёт только такие; '' экшен уже смаппил в null).
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  isDoneColumn: z.boolean().optional(),
});
export type TaskColumnInput = z.input<typeof inputSchema>;

class TaskColumnError extends Error {
  readonly code: 'not_found';
  constructor(code: 'not_found') {
    super(code);
    this.code = code;
    this.name = 'TaskColumnError';
  }
}

function canManage(session: SessionPayload): boolean {
  if (session.role === 'admin') return true;
  return session.role === 'manager' && session.managerRole === 'leader';
}
function gate(session: SessionPayload): { companyId: string } | { error: 'forbidden' } {
  if (!canManage(session) || !session.companyId) return { error: 'forbidden' };
  return { companyId: session.companyId };
}
function toColumns(input: z.infer<typeof inputSchema>) {
  return {
    name: input.name.trim(),
    position: input.position,
    statusAnchor: input.statusAnchor,
    color: input.color ?? null,
    isDoneColumn: input.isDoneColumn ?? false,
  };
}
function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function listTaskColumns(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; rows: TaskColumnView[] } | { ok: false; error: TaskColumnErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const rows = await prisma.taskColumn.findMany({
    where: { companyId: g.companyId },
    orderBy: { position: 'asc' },
  });
  return {
    ok: true,
    rows: rows.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      statusAnchor: c.statusAnchor,
      isDoneColumn: c.isDoneColumn,
      color: c.color,
    })),
  };
}

export async function createTaskColumn(
  prisma: PrismaClient,
  session: SessionPayload,
  input: TaskColumnInput
): Promise<{ ok: true; id: string } | { ok: false; error: TaskColumnErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    const columns = toColumns(parsed.data);
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.taskColumn.create({ data: { companyId: g.companyId, ...columns } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_column_created',
        entity: 'task_column',
        entityId: created.id,
        after: columns,
      });
      return created;
    });
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: 'position_taken' };
    throw e;
  }
}

export async function updateTaskColumn(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: TaskColumnInput
): Promise<{ ok: true } | { ok: false; error: TaskColumnErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.taskColumn.findUnique({
        where: { id },
        select: {
          companyId: true,
          name: true,
          position: true,
          statusAnchor: true,
          color: true,
          isDoneColumn: true,
        },
      });
      if (!before || before.companyId !== g.companyId) throw new TaskColumnError('not_found');
      const columns = toColumns(parsed.data);
      await tx.taskColumn.update({ where: { id }, data: columns });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_column_updated',
        entity: 'task_column',
        entityId: id,
        before: { ...before, companyId: undefined },
        after: columns,
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskColumnError) return { ok: false, error: e.code };
    if (isUnique(e)) return { ok: false, error: 'position_taken' };
    throw e;
  }
}

export async function deleteTaskColumn(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: TaskColumnErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.taskColumn.findUnique({
        where: { id },
        select: { companyId: true, name: true },
      });
      if (!before || before.companyId !== g.companyId) throw new TaskColumnError('not_found');
      // Task.columnId FK = ON DELETE SET NULL → задачи откатываются к дефолту по status-якорю.
      await tx.taskColumn.delete({ where: { id } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_column_deleted',
        entity: 'task_column',
        entityId: id,
        before: { name: before.name },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskColumnError) return { ok: false, error: e.code };
    throw e;
  }
}
