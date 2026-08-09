import ExcelJS from 'exceljs';
import type { OrgStudentExportRow } from '@/lib/services/organization/students';
import {
  EXPORT_ROW_LIMIT,
  appendOverflowNotice,
  formatDateRu,
  safeText,
  styleHeader,
  textOrDash,
} from '@/lib/services/export/xlsx';

/**
 * Xlsx-рендерер сотрудников организации (этап 9 PR-3, ФТ-12.2): ФИО,
 * должность, счётчик действующих удостоверений. Должность необязательна
 * (решение заказчика §9-1 спеки) — пустая выводится прочерком.
 */

export function renderOrgStudentsXlsx(args: {
  rows: OrgStudentExportRow[];
  total: number;
}): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Сотрудники');

  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'ФИО', key: 'name', width: 32 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Должность', key: 'position', width: 28 },
    { header: 'Действующих удостоверений', key: 'activeCertificates', width: 26 },
    { header: 'Внешний id', key: 'externalStudentId', width: 18 },
    { header: 'Добавлен', key: 'createdAt', width: 14 },
  ];

  const page = args.rows.slice(0, EXPORT_ROW_LIMIT);
  styleHeader(ws, page.length > 0);

  page.forEach((s, idx) => {
    ws.addRow({
      num: idx + 1,
      name: safeText(s.name),
      email: s.email ? safeText(s.email) : '—',
      position: textOrDash(s.position),
      activeCertificates: s.activeCertificates,
      externalStudentId: textOrDash(s.externalStudentId),
      createdAt: formatDateRu(s.createdAt),
    });
  });

  appendOverflowNotice(ws, { total: args.total, noticeKey: 'name' });

  return wb.xlsx.writeBuffer();
}
