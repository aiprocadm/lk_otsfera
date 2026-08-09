import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { STUDENT_IMPORT_COLUMNS } from '@/lib/services/students/import';

/**
 * Шаблон Excel для импорта сотрудников (`У-27`, этап 5 PR-2).
 *
 * Обязательна **только ФИО** — она и помечена звёздочкой. В охране труда почты
 * у рабочих часто нет, а СНИЛС приносят позже; требовать их значило бы
 * блокировать ввод (`У-21`).
 *
 * Генерируется на лету под сессией — как шаблон слушателей заявки.
 */
const BRAND = 'FFF97316'; // оранжевый примитивов UI (§13)

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Сотрудники');
  ws.columns = [
    { header: `${STUDENT_IMPORT_COLUMNS.name}*`, key: 'name', width: 32 },
    { header: STUDENT_IMPORT_COLUMNS.position, key: 'position', width: 24 },
    { header: STUDENT_IMPORT_COLUMNS.snils, key: 'snils', width: 18 },
    { header: STUDENT_IMPORT_COLUMNS.birthDate, key: 'birthDate', width: 16 },
    { header: STUDENT_IMPORT_COLUMNS.email, key: 'email', width: 28 },
    { header: STUDENT_IMPORT_COLUMNS.phone, key: 'phone', width: 20 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  ws.addRow({
    name: 'Иванов Иван Иванович',
    position: 'Электромонтёр',
    snils: '112-233-445 95',
    birthDate: '01.01.1990',
    email: 'можно не указывать',
    phone: '+7 900 000-00-00',
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="students-template.xlsx"',
    },
  });
}
