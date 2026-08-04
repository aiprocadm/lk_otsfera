import type { PrismaClient } from '@prisma/client';
import {
  getOrgFinanceKpis,
  listOrgPaymentsForExport,
  type OrgFinanceKpis,
  type OrgPaymentRow,
} from '@/lib/services/organization/finance';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';

/**
 * Данные для выгрузки платежей организации (этап 9 PR-3, ФТ-12.2) — ровно то,
 * что принимает `renderPaymentsXlsx`.
 *
 * Одна выборка на два маршрута: staff-путь (карточка организации в кабинете
 * менеджера) и клиентский путь (`/organization/finance`). Они отличаются
 * ТОЛЬКО тем, как получен `organizationId` (скоуп менеджера vs активная
 * организация клиента), а состав файла обязан совпадать — поэтому композиция
 * живёт здесь, а не дублируется в двух роутах.
 *
 * Организации может не быть в БД (например, её удалили между запросами) —
 * тогда в шапке файла стоит прочерк, а не падение.
 */

export type PaymentsExportData = {
  rows: OrgPaymentRow[];
  total: number;
  kpis: OrgFinanceKpis;
  organizationName: string;
};

export async function getPaymentsExportData(
  prisma: PrismaClient,
  organizationId: string
): Promise<PaymentsExportData> {
  const [{ rows, total }, kpis, org] = await Promise.all([
    listOrgPaymentsForExport(prisma, { organizationId, limit: EXPORT_ROW_LIMIT }),
    getOrgFinanceKpis(prisma, organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);

  return { rows, total, kpis, organizationName: org?.name ?? '—' };
}
