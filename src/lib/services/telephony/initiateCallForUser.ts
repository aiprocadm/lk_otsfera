import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  initiateOutboundCall,
  type InitiateCallResult,
} from '@/lib/services/telephony/initiateCall';

/**
 * M2 click-to-call от лица текущего сотрудника: номер, с которого Mango звонит
 * («плечо А»), берётся из профиля вызывающего (`User.internalPhone`), а не из
 * входных данных — иначе любой менеджер мог бы поднять чужую трубку.
 * Без настроенного добавочного звонок не инициируется (`no_internal_phone`),
 * до транспорта дело не доходит.
 */
export async function initiateCallForUser(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; toNumber: string }
): Promise<InitiateCallResult> {
  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { internalPhone: true },
  });
  if (!me?.internalPhone) return { ok: false, error: 'no_internal_phone' };

  return initiateOutboundCall(prisma, session, {
    orderId: args.orderId,
    toNumber: args.toNumber,
    fromInternal: me.internalPhone,
  });
}
