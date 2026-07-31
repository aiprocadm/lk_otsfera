import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import { ENROLLMENT_IMPORT_COLUMNS } from '@/lib/services/enrollments/importRows';

/**
 * Шаблон Excel-импорта слушателей (этап 2 PR-2, ФТ-2.1): колонки шаблона +
 * строка-пример. Генерируется на лету (без S3), под сессией — публичных
 * данных нет, но и анонимной раздачи не делаем.
 */

const BRAND = 'FFF97316'; // оранжевый примитивов UI (§13)

export async function GET() {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSubmitEnrollments(session))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Слушатели');
  ws.columns = [
    { header: `${ENROLLMENT_IMPORT_COLUMNS.fullName}*`, key: 'fullName', width: 32 },
    { header: `${ENROLLMENT_IMPORT_COLUMNS.email}*`, key: 'email', width: 28 },
    { header: ENROLLMENT_IMPORT_COLUMNS.position, key: 'position', width: 24 },
    { header: ENROLLMENT_IMPORT_COLUMNS.snils, key: 'snils', width: 18 },
    { header: ENROLLMENT_IMPORT_COLUMNS.birthDate, key: 'birthDate', width: 16 },
    { header: ENROLLMENT_IMPORT_COLUMNS.extra, key: 'extra', width: 32 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 20;
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  // Строка-пример: показывает форматы (СНИЛС с маской, дата ДД.ММ.ГГГГ).
  ws.addRow({
    fullName: 'Иванов Иван Иванович',
    email: 'ivanov@example.ru',
    position: 'Инженер по охране труда',
    snils: '123-456-789 00',
    birthDate: '01.01.1990',
    extra: '',
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="enrollment-import-template.xlsx"',
    },
  });
}
