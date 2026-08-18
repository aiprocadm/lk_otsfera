import type { Lead, PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { validateClientRequestInput } from '@/lib/services/clientRequests/submit';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * Этап 7 (ФТ-1.6) — «Создать лид» из обращения и звонка. Форма предзаполняется
 * на UI (контакт/тема источника), значения редактируемые — поэтому сервис
 * принимает поля и валидирует их тем же валидатором, что ручной лид/заявка.
 * Транзакция: Lead (source + source*-ссылка @unique) + пометка источника
 * разобранным (обращение → bound; звонок остаётся, но покидает Intake по
 * появившемуся lead). Повтор → `already_converted`.
 */

export type ConvertSourceInput = {
  companyName?: string | null;
  inn?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  subject?: string | null;
  notes?: string | null;
};

export type ConvertSourceResult =
  | { ok: true; lead: Lead }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'already_converted' | 'validation';
      messages?: string[];
    };

function staffGate(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

export async function createLeadFromInbound(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { inboundId: string; input: ConvertSourceInput }
): Promise<ConvertSourceResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };

  const msg = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundId },
    select: {
      id: true,
      status: true,
      companyId: true,
      resolvedOrgId: true,
      lead: { select: { id: true } },
    },
  });
  if (!msg || !isInboundMessageInScope(session, msg)) return { ok: false, error: 'not_found' };
  if (msg.lead) return { ok: false, error: 'already_converted' };

  const validated = validateClientRequestInput(args.input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const lead = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        source: 'inbound_message',
        sourceInboundId: msg.id,
        organizationId: msg.resolvedOrgId,
        createdByUserId: session.sub,
        clientCompanyName: v.companyName,
        clientInn: v.inn,
        clientContactName: v.contactName,
        clientContactPhone: v.contactPhone,
        clientContactEmail: v.contactEmail,
        subject: v.subject,
        notes: args.input.notes?.trim() || null,
        status: 'new',
      },
    });
    // Обращение разобрано: целевая сущность есть → покидает Intake (ФТ-8.2).
    await tx.inboundMessage.update({
      where: { id: msg.id },
      data: {
        status: 'bound',
        boundAt: new Date(),
        boundById: session.sub,
        companyId: msg.companyId ?? session.companyId ?? null,
      },
    });
    return lead;
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'lead_created_from_inbound',
    entity: 'lead',
    entityId: lead.id,
    after: { sourceInboundId: msg.id },
  });
  return { ok: true, lead };
}

function isCallInScope(session: SessionPayload, call: { companyId: string | null }): boolean {
  return (
    call.companyId === null || (call.companyId != null && call.companyId === session.companyId)
  );
}

export async function createLeadFromCall(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { callId: string; input: ConvertSourceInput }
): Promise<ConvertSourceResult> {
  if (!staffGate(session)) return { ok: false, error: 'forbidden' };

  const call = await prisma.call.findUnique({
    where: { id: args.callId },
    select: { id: true, companyId: true, resolvedOrgId: true, lead: { select: { id: true } } },
  });
  if (!call || !isCallInScope(session, call)) return { ok: false, error: 'not_found' };
  if (call.lead) return { ok: false, error: 'already_converted' };

  const validated = validateClientRequestInput(args.input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const lead = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        source: 'call',
        sourceCallId: call.id,
        organizationId: call.resolvedOrgId,
        createdByUserId: session.sub,
        clientCompanyName: v.companyName,
        clientInn: v.inn,
        clientContactName: v.contactName,
        clientContactPhone: v.contactPhone,
        clientContactEmail: v.contactEmail,
        subject: v.subject,
        notes: args.input.notes?.trim() || null,
        status: 'new',
      },
    });
    // Ответственный за разбор звонка — создатель лида (звонок покидает Intake
    // по связке lead, claim фиксирует «кто разобрал»).
    await tx.call.update({
      where: { id: call.id },
      data: { claimedByUserId: session.sub, claimedAt: new Date() },
    });
    return lead;
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'lead_created_from_call',
    entity: 'lead',
    entityId: lead.id,
    after: { sourceCallId: call.id },
  });
  return { ok: true, lead };
}
