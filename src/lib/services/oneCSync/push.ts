import type { PrismaClient } from '@prisma/client';
import { getOneCAdapter, type OneCAdapter } from '.';
import { writeSyncLog } from './log';
import type { OneCLeadPushPayload, OneCLeadPushResult } from './dto';

export type PushLeadResult =
  | { ok: true; result: OneCLeadPushResult; externalIdInOneC: string | null }
  | { ok: false; error: string };

export type PushLeadOptions = {
  adapter?: OneCAdapter;
};

function mapLeadToPayload(lead: {
  id: string;
  clientCompanyName: string;
  clientInn: string | null;
  clientContactName: string;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  subject: string;
  estimatedAmount: { toNumber(): number } | number | null;
  productType: string[];
  notes: string | null;
  partner: { slug: string | null };
}): OneCLeadPushPayload {
  const amount = lead.estimatedAmount;
  let amountNumber: number | undefined;
  if (typeof amount === 'number') amountNumber = amount;
  else if (amount && typeof amount === 'object' && 'toNumber' in amount) amountNumber = amount.toNumber();

  return {
    partnerSlug: lead.partner.slug ?? undefined,
    cabinetLeadId: lead.id,
    clientCompanyName: lead.clientCompanyName,
    clientInn: lead.clientInn ?? undefined,
    clientContactName: lead.clientContactName,
    clientContactPhone: lead.clientContactPhone ?? undefined,
    clientContactEmail: lead.clientContactEmail ?? undefined,
    subject: lead.subject,
    estimatedAmount: amountNumber,
    productType: lead.productType,
    notes: lead.notes ?? undefined
  };
}

export async function pushLeadToOneC(
  prisma: PrismaClient,
  leadId: string,
  opts: PushLeadOptions = {}
): Promise<PushLeadResult> {
  const adapter = opts.adapter ?? getOneCAdapter();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { partner: { select: { slug: true } } }
  });
  if (!lead) {
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'create',
        status: 'error',
        externalId: leadId,
        errorMessage: 'Lead not found'
      },
      prisma
    );
    return { ok: false, error: 'Lead not found' };
  }

  if (lead.pushedToOneCAt) {
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'skip',
        status: 'success',
        externalId: lead.externalIdInOneC ?? undefined,
        payload: { cabinetLeadId: lead.id, reason: 'already_pushed' }
      },
      prisma
    );
    return {
      ok: true,
      result: { acceptedAt: lead.pushedToOneCAt.toISOString(), oneCRequestId: lead.externalIdInOneC ?? undefined },
      externalIdInOneC: lead.externalIdInOneC
    };
  }

  const payload = mapLeadToPayload(lead);
  const startedAt = Date.now();

  try {
    const result = await adapter.pushLead(payload);
    const externalIdInOneC = result.oneCRequestId ?? null;

    await prisma.lead.update({
      where: { id: lead.id },
      data: { pushedToOneCAt: new Date(), ...(externalIdInOneC ? { externalIdInOneC } : {}) }
    });

    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'create',
        status: 'success',
        externalId: externalIdInOneC ?? undefined,
        payload: { cabinetLeadId: lead.id, acceptedAt: result.acceptedAt },
        durationMs: Date.now() - startedAt
      },
      prisma
    );

    return { ok: true, result, externalIdInOneC };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'create',
        status: 'error',
        externalId: lead.id,
        errorMessage: message,
        durationMs: Date.now() - startedAt
      },
      prisma
    );
    return { ok: false, error: message };
  }
}
