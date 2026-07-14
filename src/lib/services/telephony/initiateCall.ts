import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { getMangoAdapter } from '@/lib/telephony/mango';
import { recordAudit } from '@/lib/auth/audit';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';

export type InitiateCallResult =
  | { ok: true; callId: string }
  | { ok: false; error: 'disabled' | 'not_found' | 'call_failed' };

export async function initiateOutboundCall(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; toNumber: string; fromInternal: string }
): Promise<InitiateCallResult> {
  if (!isFeatureEnabled('telephony_mango')) return { ok: false, error: 'disabled' };

  const order = await getOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'not_found' };

  let commandId: string;
  try {
    ({ commandId } = await getMangoAdapter().initiateCallback({ fromInternal: args.fromInternal, toNumber: args.toNumber }));
  } catch (err) {
    log.warn('[telephony/initiateOutboundCall] callback failed', { orderId: args.orderId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'call_failed' };
  }

  const thread = await prisma.orderThread.findUnique({
    where: { orderId_side: { orderId: args.orderId, side: 'org' } },
    select: { id: true }
  });

  let call;
  try {
    call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `mango:cmd:${commandId}`,
        direction: 'outbound',
        status: 'initiated',
        callerNumber: args.toNumber,
        initiatedByUserId: session.sub,
        resolvedOrgId: order.organizationId,
        companyId: order.companyId,
        threadId: thread?.id ?? null
      },
      select: { id: true }
    });
  } catch (err) {
    log.warn('[telephony/initiateOutboundCall] call persist failed', { orderId: args.orderId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'call_failed' };
  }

  await recordAudit(prisma, { action: 'call_initiated', entity: 'order', entityId: args.orderId, userId: session.sub });
  await writeSyncLog({ entity: 'call', direction: 'outbound', operation: 'create', status: 'success', externalId: `mango:cmd:${commandId}` });

  return { ok: true, callId: call.id };
}
