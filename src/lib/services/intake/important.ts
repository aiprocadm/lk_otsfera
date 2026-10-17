import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canTriageClientRequests } from '@/lib/services/clientRequests/policy';
import { inboxScopeWhere } from '@/lib/services/inbound/scope';
import { log } from '@/lib/logging';

/**
 * Пометка «Важное» во «Входящих обращениях» (этап 7 ТЗ 13.10.2026, `У-318`,
 * `Р-7-6`): сообщение или звонок, который нельзя потерять, остаётся на виду —
 * важные идут первыми, есть отбор «Только важные». Раньше ради этого сообщение
 * приходилось превращать в обращение.
 *
 * Охват — тот же, что у очереди: сообщение — по `inboxScopeWhere`, звонок — по
 * компании (ничейный звонок без компании виден и помечается, как в очереди).
 */
export type SetImportantResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

export async function setIntakeImportant(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { type: 'inbound' | 'call'; id: string; important: boolean }
): Promise<SetImportantResult> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };
  const data = args.important
    ? { importantAt: new Date(), importantById: session.sub }
    : { importantAt: null, importantById: null };
  const { count } =
    args.type === 'inbound'
      ? await prisma.inboundMessage.updateMany({
          where: { AND: [inboxScopeWhere(session), { id: args.id }] },
          data,
        })
      : await prisma.call.updateMany({
          where: {
            id: args.id,
            OR: [{ companyId: session.companyId ?? '__no_company__' }, { companyId: null }],
          },
          data,
        });
  if (count === 0) return { ok: false, error: 'not_found' };
  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: args.important ? 'intake_marked_important' : 'intake_unmarked_important',
      entity: args.type === 'inbound' ? 'inbound_message' : 'call',
      entityId: args.id,
    });
  } catch (err) {
    // Пометка уже стоит — сбой журнала её не отменяет (§3).
    log.warn('[intake/important] audit failed', {
      id: args.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { ok: true };
}
