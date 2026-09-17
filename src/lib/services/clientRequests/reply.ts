import type { ClientRequest, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canTriageClientRequests } from './policy';
import { clientRequestScopeWhere } from './list';
import { notifySubmitterClientRequestStatus } from './notify';

/**
 * Ответ сотрудника на обращение (этап 6 ТЗ 12.09.2026, `У-238`, решение `Р-Э6-4`).
 *
 * До этапа обращение умело только менять статус, и клиент видел «отклонено»
 * без слов. Ответ — отдельно от статуса: его можно дать вместе со сменой
 * статуса, отдельно и даже после `converted`. Статус ответ не трогает.
 *
 * Клиент и партнёр видят ответ дословно в карточке обращения и в письме
 * (`notifySubmitterClientRequestStatus`, событие `reply`).
 */

export const CLIENT_REQUEST_REPLY_MAX = 4000;

type ReplyFailure = {
  ok: false;
  error: 'forbidden' | 'not_found' | 'validation';
};

export async function replyToClientRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; text: string }
): Promise<{ ok: true; request: ClientRequest } | ReplyFailure> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };
  const text = args.text.trim();
  if (text.length === 0 || text.length > CLIENT_REQUEST_REPLY_MAX) {
    return { ok: false, error: 'validation' };
  }
  const r = await prisma.clientRequest.findFirst({
    where: { AND: [{ id: args.id }, clientRequestScopeWhere(session)] },
    select: { id: true, staffReply: true },
  });
  if (!r) return { ok: false, error: 'not_found' };

  const updated = await prisma.clientRequest.update({
    where: { id: r.id },
    data: { staffReply: text, staffRepliedAt: new Date(), staffRepliedById: session.sub },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'client_request_replied',
    entity: 'client_request',
    entityId: r.id,
    ...(r.staffReply ? { before: { staffReply: r.staffReply } } : {}),
    after: { staffReply: text },
  });
  await notifySubmitterClientRequestStatus(prisma, updated, { event: 'reply' });
  return { ok: true, request: updated };
}
