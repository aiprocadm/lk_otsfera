import ExcelJS from 'exceljs';
import {
  certificateStatus,
  type CertificateRow,
} from '@/lib/services/training/certificates';

/**
 * Xlsx-рендерер клиентского реестра удостоверений (этап 3 PR-2, ФТ-6.5 /
 * ФТ-12.1). Правила Модуля 12: выгрузка строится из той же сервис-выборки,
 * что и экран (RBAC-скоуп и фильтры — забота вызывающего роута); лимит строк;
 * защита от формула-инъекций (образец — commission/xlsx.ts).
 */

export const CERTIFICATES_EXPORT_LIMIT = 10_000;

const BRAND = 'FFF97316'; // оранжевый примитивов UI (§13)

const STATUS_RU: Record<ReturnType<typeof certificateStatus>, string> = {
  active: 'Действует',
  expiring: 'Истекает',
  expired: 'Истекло',
};

// OWASP CSV/формула-инъекция: ведущие = + - @ / tab / CR превращают ячейку в
// формулу — префиксуем одинарной кавычкой (как в commission/xlsx.ts).
function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function fmt(d: Date): string {
  return new Date(d).toLocaleDateString('ru-RU');
}

export function renderCertificatesXlsx(args: {
  rows: CertificateRow[];
  total: number;
  showOrganization: boolean;
  now?: Date;
}): Promise<ExcelJS.Buffer> {
  const now = args.now ?? new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Удостоверения');

  ws.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Сотрудник', key: 'student', width: 32 },
    ...(args.showOrganization ? [{ header: 'Организация', key: 'organization', width: 32 }] : []),
    { header: 'Направление', key: 'direction', width: 32 },
    { header: 'Номер', key: 'number', width: 20 },
    { header: 'Выдано', key: 'issuedAt', width: 14 },
    { header: 'Действует до', key: 'validUntil', width: 14 },
    { header: 'Статус', key: 'status', width: 14 },
    { header: 'Скан', key: 'scan', width: 16 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 20;
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  if (args.rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }

  const page = args.rows.slice(0, CERTIFICATES_EXPORT_LIMIT);
  page.forEach((c, idx) => {
    ws.addRow({
      num: idx + 1,
      student: safeText(c.student.name),
      ...(args.showOrganization ? { organization: safeText(c.organization.name) } : {}),
      direction: safeText(c.direction.name),
      number: safeText(c.number),
      issuedAt: fmt(c.issuedAt),
      validUntil: c.validUntil ? fmt(c.validUntil) : 'бессрочно',
      status: STATUS_RU[certificateStatus(c.validUntil, now)],
      scan: c.documentId ? 'есть' : 'готовится',
    });
  });

  if (args.total > CERTIFICATES_EXPORT_LIMIT) {
    ws.addRow({});
    ws.addRow({
      student: `Показаны первые ${CERTIFICATES_EXPORT_LIMIT} строк из ${args.total} — уточните фильтры.`,
    });
  }

  return wb.xlsx.writeBuffer();
}
