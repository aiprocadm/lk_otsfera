import ExcelJS from 'exceljs';
import type { OrgFinanceKpis, OrgPaymentRow } from '@/lib/services/organization/finance';
import { paymentMethodRu } from '@/lib/i18n/labels';
import {
  EXPORT_ROW_LIMIT,
  appendOverflowNotice,
  formatDateRu,
  safeText,
  styleHeader,
  textOrDash,
} from '@/lib/services/export/xlsx';

/**
 * Xlsx-рендерер платежей и задолженности (этап 9 PR-3, ФТ-12.2). Лист
 * «Платежи» — леджер как на экране; лист «Итоги» — KPI начислено/оплачено/долг
 * (та же тройка, что в карточках финансов). Общие правила Модуля 12 — в
 * `export/xlsx.ts`.
 */

export function renderPaymentsXlsx(args: {
  rows: OrgPaymentRow[];
  total: number;
  kpis: OrgFinanceKpis;
  organizationName: string;
}): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';

  const ws = wb.addWorksheet('Платежи');
  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Дата', key: 'paidAt', width: 14 },
    { header: 'Заказ', key: 'order', width: 18 },
    { header: 'Сумма, ₽', key: 'amount', width: 14 },
    { header: 'НДС, ₽', key: 'vat', width: 12 },
    { header: 'Назначение', key: 'purpose', width: 36 },
    { header: '№ платёжного поручения', key: 'paymentOrderNumber', width: 24 },
    { header: 'Способ', key: 'method', width: 20 },
    { header: 'Возврат', key: 'isRefund', width: 10 },
    { header: 'Внёс', key: 'enteredBy', width: 22 },
    { header: 'Комментарий', key: 'note', width: 36 },
  ];

  const page = args.rows.slice(0, EXPORT_ROW_LIMIT);
  styleHeader(ws, page.length > 0);

  page.forEach((p, idx) => {
    ws.addRow({
      num: idx + 1,
      paidAt: formatDateRu(p.paidAt),
      order: textOrDash(p.orderNumber),
      amount: p.amount,
      vat: p.vatAmount ?? '—',
      purpose: textOrDash(p.purpose),
      paymentOrderNumber: textOrDash(p.paymentOrderNumber),
      method: safeText(paymentMethodRu(p.method)),
      isRefund: p.isRefund ? 'да' : 'нет',
      enteredBy: textOrDash(p.enteredByName),
      note: textOrDash(p.note),
    });
  });

  appendOverflowNotice(ws, { total: args.total, noticeKey: 'paidAt' });

  const totals = wb.addWorksheet('Итоги');
  totals.columns = [
    { header: 'Показатель', key: 'label', width: 28 },
    { header: 'Значение', key: 'value', width: 20 },
  ];
  styleHeader(totals, true);
  totals.addRow({ label: 'Организация', value: safeText(args.organizationName) });
  totals.addRow({ label: 'Начислено, ₽', value: args.kpis.billed });
  totals.addRow({ label: 'Оплачено, ₽', value: args.kpis.paid });
  totals.addRow({ label: 'Задолженность, ₽', value: args.kpis.outstanding });

  return wb.xlsx.writeBuffer();
}
