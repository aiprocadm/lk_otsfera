import type { ClientRequest, Lead, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canTriageClientRequests } from './policy';
import { clientRequestScopeWhere } from './list';
import { notifySubmitterClientRequestStatus } from './notify';

type TriageFailure = {
  ok: false;
  error: 'forbidden' | 'not_found' | 'lifecycle_violation' | 'validation';
};

async function loadInScope(prisma: PrismaClient, session: SessionPayload, id: string) {
  return prisma.clientRequest.findFirst({
    where: { AND: [{ id }, clientRequestScopeWhere(session)] },
  });
}

/**
 * Триаж заявок клиентов (этап 5, ФТ-1.4). Конвейер:
 * submitted → in_triage → converted | rejected. Скоуп — C8 (как очередь);
 * смена статуса уведомляет подателя (best-effort внутри notify.ts).
 */
export async function takeInTriage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<{ ok: true; request: ClientRequest } | TriageFailure> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };
  const r = await loadInScope(prisma, session, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'submitted') return { ok: false, error: 'lifecycle_violation' };

  const updated = await prisma.clientRequest.update({
    where: { id: r.id },
    data: { status: 'in_triage', triagedByUserId: session.sub, triagedAt: new Date() },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'client_request_taken',
    entity: 'client_request',
    entityId: r.id,
    after: { status: 'in_triage' },
  });
  await notifySubmitterClientRequestStatus(prisma, updated);
  return { ok: true, request: updated };
}

/**
 * «Принять → создать лид»: транзакция Lead (source=client_request,
 * sourceRequestId, партнёр/организация наследуются) + заявка → converted.
 * Допускается из submitted и in_triage (принять можно сразу).
 */
export async function convertToLead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string }
): Promise<{ ok: true; request: ClientRequest; lead: Lead } | TriageFailure> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };
  const r = await loadInScope(prisma, session, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'converted' || r.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }

  const { lead, request } = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        source: 'client_request',
        sourceRequestId: r.id,
        partnerId: r.partnerId,
        organizationId: r.organizationId,
        createdByUserId: session.sub,
        /**
         * Принял обращение — лид твой (`У-161`, этап 7).
         *
         * Раньше ответственный не ставился вовсе, и менеджер с профилем
         * «вижу только свои лиды» создавал лид, которого сам же не видел:
         * `canSeeLead` сравнивает именно это поле. Ни карточку открыть, ни
         * предложение выставить он не мог — а причину пришлось бы искать в
         * настройках доступа.
         */
        assignedManagerId: session.sub,
        clientCompanyName: r.companyName,
        clientInn: r.inn,
        clientContactName: r.contactName,
        clientContactPhone: r.contactPhone,
        clientContactEmail: r.contactEmail,
        subject: r.subject,
        notes: r.body,
        status: 'new',
      },
    });
    const request = await tx.clientRequest.update({
      where: { id: r.id },
      data: { status: 'converted', triagedByUserId: session.sub, triagedAt: new Date() },
    });
    return { lead, request };
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'client_request_converted',
    entity: 'client_request',
    entityId: r.id,
    after: { leadId: lead.id },
  });
  await notifySubmitterClientRequestStatus(prisma, request);
  return { ok: true, request, lead };
}

export async function rejectClientRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; reason: string }
): Promise<{ ok: true; request: ClientRequest } | TriageFailure> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };
  const r = await loadInScope(prisma, session, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'converted' || r.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }

  const updated = await prisma.clientRequest.update({
    where: { id: r.id },
    data: {
      status: 'rejected',
      rejectedReason: args.reason.trim() || 'Отклонено',
      triagedByUserId: session.sub,
      triagedAt: new Date(),
    },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'client_request_rejected',
    entity: 'client_request',
    entityId: r.id,
    after: { reason: updated.rejectedReason },
  });
  await notifySubmitterClientRequestStatus(prisma, updated);
  return { ok: true, request: updated };
}
