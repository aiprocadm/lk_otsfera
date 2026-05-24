import type { PrismaClient } from '@prisma/client';

export type AuditEntity =
  | 'user'
  | 'partner'
  | 'organization'
  | 'order'
  | 'commission_statement'
  | 'lead'
  | 'document';

export type AuditRecord = {
  userId: string;
  action: string;
  entity: AuditEntity;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  status?: 'success' | 'denied';
  reason?: string;
};

export async function recordAudit(prisma: PrismaClient, rec: AuditRecord): Promise<void> {
  const meta: Record<string, unknown> = {
    status: rec.status ?? 'success',
  };
  if (rec.before !== undefined) meta.before = rec.before;
  if (rec.after !== undefined) meta.after = rec.after;
  if (rec.reason !== undefined) meta.reason = rec.reason;

  await prisma.auditLog.create({
    data: {
      userId: rec.userId,
      action: rec.action,
      entity: rec.entity,
      entityId: rec.entityId,
      meta,
    },
  });
}
