import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import {
  EXPORT_ROW_LIMIT,
  appendOverflowNotice,
  formatDateRu,
  safeText,
  styleHeader,
  textOrDash,
} from '@/lib/services/export/xlsx';

/**
 * Xlsx-рендерер списка заказов сотрудника (этап 9 PR-3, ФТ-12.2). Правила
 * Модуля 12 — в `export/xlsx.ts`: выгрузка строится из той же сервис-выборки,
 * что и экран (RBAC-скоуп и фильтры — забота роута), лимит строк, защита от
 * формула-инъекций.
 */

const EXECUTION_RU: Record<string, string> = {
  pending: 'Новый',
  in_progress: 'В работе',
  completed: 'Завершён',
  cancelled: 'Отменён',
  on_hold: 'Приостановлен',
};

const FINANCIAL_RU: Record<string, string> = {
  not_billed: 'Не выставлен',
  billed: 'Выставлен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  refunded: 'Возврат',
};

/** Коды приходят из БД-энамов, но fallback на код держим (как в i18n/labels.ts). */
function executionRu(code: string): string {
  return EXECUTION_RU[code] ?? code;
}

function financialRu(code: string): string {
  return FINANCIAL_RU[code] ?? code;
}

export function renderOrdersXlsx(args: {
  rows: ManagerOrderRow[];
  total: number;
}): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Заказы');

  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Номер заказа', key: 'orderNumber', width: 18 },
    { header: 'Название', key: 'title', width: 40 },
    { header: 'Организация', key: 'organization', width: 32 },
    { header: 'Менеджер', key: 'manager', width: 24 },
    { header: 'Статус', key: 'executionStatus', width: 16 },
    { header: 'Оплата', key: 'financialStatus', width: 18 },
    { header: 'Сумма, ₽', key: 'total', width: 14 },
    { header: 'Оплачено, ₽', key: 'paid', width: 14 },
    { header: 'Долг, ₽', key: 'outstanding', width: 14 },
    { header: 'Создан', key: 'createdAt', width: 14 },
  ];

  const page = args.rows.slice(0, EXPORT_ROW_LIMIT);
  styleHeader(ws, page.length > 0);

  page.forEach((o, idx) => {
    const total = new Prisma.Decimal(o.totalAmount);
    const paid = new Prisma.Decimal(o.paidAmount);
    ws.addRow({
      num: idx + 1,
      orderNumber: textOrDash(o.orderNumber),
      title: safeText(o.title),
      organization: safeText(o.organization.name),
      manager: textOrDash(o.manager?.name ?? o.manager?.email ?? null),
      executionStatus: executionRu(o.executionStatus),
      financialStatus: financialRu(o.financialStatus),
      total: total.toFixed(2),
      paid: paid.toFixed(2),
      outstanding: total.minus(paid).toFixed(2),
      createdAt: formatDateRu(o.createdAt),
    });
  });

  appendOverflowNotice(ws, { total: args.total, noticeKey: 'orderNumber' });

  return wb.xlsx.writeBuffer();
}
