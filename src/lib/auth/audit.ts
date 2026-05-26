import type { PrismaClient, Prisma } from '@prisma/client';

export type AuditEntity =
  | 'user'
  | 'partner'
  | 'organization'
  | 'organization_user'
  | 'order'
  | 'commission_statement'
  | 'lead'
  | 'lead_attachment'
  | 'document'
  | 'partner_user'
  | 'student_bridge';

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

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function recordAudit(prisma: PrismaLike, rec: AuditRecord): Promise<void> {
  const meta: Prisma.JsonObject = {
    status: rec.status ?? 'success',
  };
  if (rec.before !== undefined) meta.before = rec.before as Prisma.JsonObject;
  if (rec.after !== undefined) meta.after = rec.after as Prisma.JsonObject;
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
