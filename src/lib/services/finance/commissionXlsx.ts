import ExcelJS from 'exceljs';
import type { FinanceKpis, StatementListItem } from '@/lib/services/partner/finance';
import { COMMISSION_STATUS_LABELS } from '@/lib/i18n/commissionStatus';
import {
  EXPORT_ROW_LIMIT,
  appendOverflowNotice,
  formatDateRu,
  safeText,
  styleHeader,
} from '@/lib/services/export/xlsx';

/**
 * Xlsx-выгрузка комиссионных отчётов партнёра (`У-115`).
 *
 * Зеркало выгрузки платежей заказчика (`renderPaymentsXlsx`): у заказчика в
 * «Финансах» платежи, у партнёра — комиссия, но раздел один и кнопка «Выгрузить
 * в Excel» должна быть у обоих. Устройство книги то же: лист со строками как на
 * экране плюс лист «Итоги» с той же тройкой показателей, что в карточках.
 */
export function renderCommissionStatementsXlsx(args: {
  rows: StatementListItem[];
  total: number;
  kpis: FinanceKpis;
  partnerName: string;
}): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';

  const ws = wb.addWorksheet('Комиссионные отчёты');
  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Период с', key: 'periodFrom', width: 14 },
    { header: 'Период по', key: 'periodTo', width: 14 },
    { header: 'Статус', key: 'status', width: 16 },
    { header: 'Начислено, ₽', key: 'amount', width: 16 },
    { header: 'Позиций', key: 'itemCount', width: 12 },
  ];

  const page = args.rows.slice(0, EXPORT_ROW_LIMIT);
  styleHeader(ws, page.length > 0);

  page.forEach((s, idx) => {
    ws.addRow({
      num: idx + 1,
      periodFrom: formatDateRu(s.periodFrom),
      periodTo: formatDateRu(s.periodTo),
      status: safeText(COMMISSION_STATUS_LABELS[s.status] ?? s.status),
      amount: Number(s.totalCommissionAmount),
      itemCount: s.itemCount,
    });
  });

  appendOverflowNotice(ws, { total: args.total, noticeKey: 'periodFrom' });

  const totals = wb.addWorksheet('Итоги');
  totals.columns = [
    { header: 'Показатель', key: 'label', width: 28 },
    { header: 'Значение', key: 'value', width: 20 },
  ];
  styleHeader(totals, true);
  totals.addRow({ label: 'Партнёр', value: safeText(args.partnerName) });
  totals.addRow({ label: 'Заработано, ₽', value: args.kpis.earnedTotal });
  totals.addRow({ label: 'В обработке, ₽', value: args.kpis.pendingTotal });
  totals.addRow({ label: 'Выплачено, ₽', value: args.kpis.paidTotal });

  return wb.xlsx.writeBuffer();
}
