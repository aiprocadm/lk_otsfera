import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';
import { PII_CONTEXTS, type PiiContextKey } from './contexts';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** meta события — только счётчики/флаги. Сырые поисковые строки ЗАПРЕЩЕНЫ
 *  (могут содержать ФИО/email — журнал не должен сам копить ПДн). */
type PiiAccessMeta = { take?: number; hasQuery?: boolean; cursor?: boolean };

export type PiiAccessArgs = {
  session: SessionPayload;
  context: PiiContextKey;
  /** id строк выдачи (Student.id, Call.id, ...) — НЕ сами ПДн. */
  subjectIds: string[];
  meta?: PiiAccessMeta;
};

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

function roleSnapshot(session: SessionPayload): string {
  return session.role === 'manager' && session.managerRole === 'leader' ? 'leader' : session.role;
}

function toRow(args: PiiAccessArgs) {
  const ctx = PII_CONTEXTS[args.context];
  const meta: Prisma.JsonObject = {};
  if (args.meta?.take !== undefined) meta.take = args.meta.take;
  if (args.meta?.hasQuery !== undefined) meta.hasQuery = args.meta.hasQuery;
  if (args.meta?.cursor !== undefined) meta.cursor = args.meta.cursor;
  return {
    userId: args.session.sub,
    userRole: roleSnapshot(args.session),
    companyId: args.session.companyId ?? null,
    context: args.context,
    action: ctx.action,
    subjectType: ctx.subjectType,
    subjectIds: args.subjectIds,
    subjectCount: args.subjectIds.length,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

/**
 * §25.7: запись события доступа к ПДн. Awaited и never-throws (fail-open §3):
 * сбой журнала логируется алертным log.error и НЕ блокирует выдачу данных.
 * No-op при выключенном флаге, не-staff сессии или пустой выдаче.
 */
export async function recordPiiAccess(prisma: PrismaLike, args: PiiAccessArgs): Promise<void> {
  await recordPiiAccessMany(prisma, [args]);
}

/** Пакетная запись (напр. organizationCard: inbound + calls) одним round-trip. */
export async function recordPiiAccessMany(
  prisma: PrismaLike,
  argsList: PiiAccessArgs[]
): Promise<void> {
  if (!isFeatureEnabled('pii_access_log')) return;
  const rows = argsList.filter((a) => isStaff(a.session) && a.subjectIds.length > 0).map(toRow);
  if (rows.length === 0) return;
  try {
    if (rows.length === 1) {
      await prisma.piiAccessEvent.create({ data: rows[0]! }); // длина проверена условием
    } else {
      await prisma.piiAccessEvent.createMany({ data: rows });
    }
  } catch (e) {
    log.error('pii_access_log_write_failed', {
      contexts: rows.map((r) => r.context),
      count: rows.length,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
