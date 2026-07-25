import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
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
  // Этап 5: лид может быть без партнёра — slug тогда не передаём.
  partner: { slug: string | null } | null;
}): OneCLeadPushPayload {
  const amount = lead.estimatedAmount;
  let amountNumber: number | undefined;
  if (typeof amount === 'number') amountNumber = amount;
  else if (amount && typeof amount === 'object' && 'toNumber' in amount) amountNumber = amount.toNumber();

  return {
    partnerSlug: lead.partner?.slug ?? undefined,
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

  // Atomic first-writer-wins claim: flip pushedToOneCAt from NULL so only one
  // concurrent caller proceeds to the adapter. Losers get count:0 and skip —
  // this is what prevents a DUPLICATE lead in 1C when two jobs race. The guard
  // above (findUnique) is not enough on its own: it's a read, and the pushLead
  // queue has attempts:5, so two jobs can both read NULL before either writes.
  const claim = await prisma.lead.updateMany({
    where: { id: lead.id, pushedToOneCAt: null },
    data: { pushedToOneCAt: new Date() }
  });
  if (claim.count === 0) {
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'skip',
        status: 'success',
        externalId: lead.externalIdInOneC ?? undefined,
        payload: { cabinetLeadId: lead.id, reason: 'claim_lost_or_already_pushed' }
      },
      prisma
    );
    return {
      ok: true,
      result: { acceptedAt: new Date().toISOString(), oneCRequestId: lead.externalIdInOneC ?? undefined },
      externalIdInOneC: lead.externalIdInOneC
    };
  }

  const payload = mapLeadToPayload(lead);
  const startedAt = Date.now();

  try {
    const result = await adapter.pushLead(payload);
    const externalIdInOneC = result.oneCRequestId ?? null;

    // pushedToOneCAt is already stamped by the claim above; on success we only
    // record the external id returned by 1C.
    if (externalIdInOneC) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { externalIdInOneC }
      });
    }

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
    // Release the claim so a BullMQ retry can re-attempt — preserves the
    // existing "error ⇒ retryable" semantics. Defensive inner try/catch: if the
    // rollback ITSELF fails (DB down at the same instant as the adapter), we
    // must STILL honour the Result contract and return the ADAPTER error — not
    // throw the rollback error. The residual "lead left claimed" case is
    // surfaced via console.error for the reconcile path to pick up.
    try {
      await prisma.lead.updateMany({
        where: { id: lead.id },
        data: { pushedToOneCAt: null }
      });
    } catch (rollbackErr) {
      log.error('[pushLeadToOneC] claim rollback failed — lead may be stuck claimed', {
        leadId: lead.id,
        rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
      });
    }
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
