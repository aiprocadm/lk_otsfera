import type { PrismaClient } from '@prisma/client';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import type { ParsedRow, MatchOutcome } from './types';

const EPOCH = new Date(0).toISOString();

/** Нормализация наименования для fuzzy: upper-case, схлопывание пробелов, убрать орг-формы и пунктуацию. */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[«»"'().,]/g, ' ')
    .replace(/\b(ООО|АО|ПАО|ЗАО|ИП|ОАО|НКО)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseDto(r: ParsedRow): Omit<OneCPaymentDto, 'orderExternalId' | 'organizationInn' | 'organizationExternalId'> {
  return {
    externalId: r.externalId,
    amount: r.amount as number,
    paidAt: r.paidAt as string,
    method: r.isRefund ? 'возврат' : undefined,
    purpose: r.purpose ?? undefined,
    paymentOrderNumber: r.paymentOrderNumber ?? undefined,
    vatAmount: r.vatAmount ?? undefined,
    isRefund: r.isRefund,
    updatedAt: EPOCH,
  };
}

/**
 * Сопоставление строки с заказом/организацией.
 * Точное (№ счёта→заказ, ИНН→орг) → route 'exact' с готовым DTO для writer.
 * Неточное (fuzzy-имя) / ничего → route 'queue' (кандидат на ручное подтверждение).
 */
export async function matchRow(prisma: PrismaClient, r: ParsedRow): Promise<MatchOutcome> {
  // 1) № счёта → заказ (по orderNumber или externalId)
  for (const cand of r.accountCandidates) {
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: cand }, { externalId: cand }] },
      select: { id: true, externalId: true, organizationId: true, organization: { select: { inn: true } } },
    });
    if (order) {
      // writer резолвит заказ по externalId; если его нет — пишем org-level по ИНН заказа.
      if (order.externalId) {
        return { route: 'exact', dto: { ...baseDto(r), orderExternalId: order.externalId } };
      }
      if (order.organization?.inn) {
        return { route: 'exact', dto: { ...baseDto(r), organizationInn: order.organization.inn } };
      }
      // заказ без externalId и без ИНН орги — в очередь с кандидат-заказом
      return { route: 'queue', candidateOrgId: order.organizationId, candidateOrderId: order.id, matchMethod: 'name_fuzzy' };
    }
  }

  // 2) ИНН → организация (точно)
  if (r.counterpartyInn) {
    const org = await prisma.organization.findFirst({ where: { inn: r.counterpartyInn }, select: { id: true, inn: true } });
    if (org?.inn) return { route: 'exact', dto: { ...baseDto(r), organizationInn: org.inn } };
  }

  // 3) fuzzy-имя → кандидат в очередь (не авто)
  if (r.counterpartyName) {
    const norm = normalizeName(r.counterpartyName);
    if (norm.length >= 3) {
      const org = await prisma.organization.findFirst({
        where: { name: { contains: norm.split(' ')[0], mode: 'insensitive' } },
        select: { id: true },
      });
      if (org) return { route: 'queue', candidateOrgId: org.id, candidateOrderId: null, matchMethod: 'name_fuzzy' };
    }
  }

  // 4) ничего
  return { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' };
}
