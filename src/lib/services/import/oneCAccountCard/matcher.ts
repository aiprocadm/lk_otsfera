import type { PrismaClient } from '@prisma/client';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import { normalizeInn } from '@/lib/services/oneCSync/inn';
import { counterpartyKey } from './counterparty-key';
import type { ParsedRow, MatchOutcome } from './types';

const EPOCH = new Date(0).toISOString();

function baseDto(
  r: ParsedRow
): Omit<OneCPaymentDto, 'orderExternalId' | 'organizationInn' | 'organizationExternalId'> {
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
 * Точное (№ счёта→заказ, ИНН→орг, ключ названия→орг) → route 'exact' с готовым
 * DTO для writer. Неточное (fuzzy-имя) / ничего → route 'queue' (кандидат на
 * ручное подтверждение).
 *
 * `opts.companyId` (`У-88`) — компания импорта: в её пределах разрешено точное
 * совпадение по ключу названия. Без компании ступень пропускается: матчить по
 * названию «во всех компаниях» нельзя (C8 — граница изоляции).
 */
export async function matchRow(
  prisma: PrismaClient,
  r: ParsedRow,
  opts?: { companyId?: string | null }
): Promise<MatchOutcome> {
  // 1) № счёта → заказ (по orderNumber или externalId)
  for (const cand of r.accountCandidates) {
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: cand }, { externalId: cand }] },
      select: {
        id: true,
        externalId: true,
        organizationId: true,
        organization: { select: { inn: true } },
      },
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
      return {
        route: 'queue',
        candidateOrgId: order.organizationId,
        candidateOrderId: order.id,
        matchMethod: 'name_fuzzy',
      };
    }
  }

  // 2) ИНН → организация (точно)
  if (r.counterpartyInn) {
    // Ищем нормализованный ИНН: автосоздание кладёт в базу именно его
    // (`normalizeInn` восстанавливает ведущие нули), и на 11-значном значении
    // поиск по сырому не находил только что созданную организацию.
    const org = await prisma.organization.findFirst({
      where: { inn: normalizeInn(r.counterpartyInn) },
      select: { id: true, inn: true },
    });
    if (org?.inn) return { route: 'exact', dto: { ...baseDto(r), organizationInn: org.inn } };
  }

  // 3) ключ названия → организация в компании импорта (точно, `У-88`)
  const key = r.counterpartyName ? counterpartyKey(r.counterpartyName).key : '';
  if (opts?.companyId && key) {
    const org = await prisma.organization.findFirst({
      where: { companyId: opts.companyId, nameKey: key },
      select: { id: true, inn: true },
    });
    if (org) {
      // ИНН может отсутствовать (организация заведена по названию) — тогда
      // адресуем локальным id, иначе writer не нашёл бы её (`resolve-org`).
      return {
        route: 'exact',
        dto: org.inn
          ? { ...baseDto(r), organizationInn: org.inn }
          : { ...baseDto(r), organizationId: org.id },
      };
    }
  }

  // 4) fuzzy-имя → кандидат в очередь (не авто)
  if (r.counterpartyName) {
    const norm = key;
    if (norm.length >= 3) {
      const org = await prisma.organization.findFirst({
        // String.split всегда возвращает минимум один элемент — [0] существует.
        where: { name: { contains: norm.split(' ')[0]!, mode: 'insensitive' } },
        select: { id: true },
      });
      if (org)
        return {
          route: 'queue',
          candidateOrgId: org.id,
          candidateOrderId: null,
          matchMethod: 'name_fuzzy',
        };
    }
  }

  // 5) ничего
  return { route: 'queue', candidateOrgId: null, candidateOrderId: null, matchMethod: 'none' };
}
