import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import type { DealStageView } from '@/lib/services/deals/stages';

/**
 * Этап 6 (ФТ-4.2) — CRUD настраиваемых стадий сделок: клон access/funnelStages.
 * Company-scoped (IDOR: чужая стадия → not_found), роль-гейт (admin |
 * manager-leader), аудит. `@@unique([companyId, position])` → position_taken.
 */

export type DealStageErrorCode = 'forbidden' | 'not_found' | 'validation' | 'position_taken';

const anchorSchema = z.enum(['open', 'won', 'lost']);

const inputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  position: z.number().int().min(0),
  statusAnchor: anchorSchema,
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  isTerminal: z.boolean().optional()
});
export type DealStageInput = z.input<typeof inputSchema>;

class DealStageError extends Error {
  readonly code: 'not_found';
  constructor(code: 'not_found') {
    super(code);
    this.code = code;
    this.name = 'DealStageError';
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
    // Терминальность выводим и из якоря: won/lost-стадия терминальна всегда.
    isTerminal: (input.isTerminal ?? false) || input.statusAnchor !== 'open'
  };
}
function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function listDealStages(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; rows: DealStageView[] } | { ok: false; error: DealStageErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const rows = await prisma.dealStage.findMany({ where: { companyId: g.companyId }, orderBy: { position: 'asc' } });
  return {
    ok: true,
    rows: rows.map((s) => ({
      id: s.id, name: s.name, position: s.position, statusAnchor: s.statusAnchor, isTerminal: s.isTerminal, color: s.color
    }))
  };
}

export async function createDealStage(
  prisma: PrismaClient,
  session: SessionPayload,
  input: DealStageInput
): Promise<{ ok: true; id: string } | { ok: false; error: DealStageErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    const columns = toColumns(parsed.data);
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.dealStage.create({ data: { companyId: g.companyId, ...columns } });
      await recordAudit(tx, {
        userId: session.sub, action: 'deal_stage_created', entity: 'deal_stage', entityId: created.id, after: columns
      });
      return created;
    });
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: 'position_taken' };
    throw e;
  }
}

export async function updateDealStage(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: DealStageInput
): Promise<{ ok: true } | { ok: false; error: DealStageErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.dealStage.findUnique({
        where: { id },
        select: { companyId: true, name: true, position: true, statusAnchor: true, color: true, isTerminal: true }
      });
      if (!before || before.companyId !== g.companyId) throw new DealStageError('not_found');
      const columns = toColumns(parsed.data);
      await tx.dealStage.update({ where: { id }, data: columns });
      await recordAudit(tx, {
        userId: session.sub, action: 'deal_stage_updated', entity: 'deal_stage', entityId: id,
        before: { ...before, companyId: undefined }, after: columns
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof DealStageError) return { ok: false, error: e.code };
    if (isUnique(e)) return { ok: false, error: 'position_taken' };
    throw e;
  }
}

export async function deleteDealStage(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: DealStageErrorCode }> {
  const g = gate(session);
  if ('error' in g) return { ok: false, error: g.error };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.dealStage.findUnique({ where: { id }, select: { companyId: true, name: true } });
      if (!before || before.companyId !== g.companyId) throw new DealStageError('not_found');
      // Deal.stageId FK = ON DELETE SET NULL → сделки откатываются к дефолту по якорю.
      await tx.dealStage.delete({ where: { id } });
      await recordAudit(tx, {
        userId: session.sub, action: 'deal_stage_deleted', entity: 'deal_stage', entityId: id, before: { name: before.name }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof DealStageError) return { ok: false, error: e.code };
    throw e;
  }
}
