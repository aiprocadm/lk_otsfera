import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { CATALOG_IMPORT_COLUMNS } from '@/lib/services/admin/catalogExcel';

/**
 * Шаблон Excel для импорта каталога услуг (`У-137`). Обязательны Название,
 * Артикул и Цена — они со звёздочкой. Колонки — та же константа, что у
 * парсера: шаблон не может разъехаться с разбором.
 *
 * Каталог ведут админ и руководитель — прочим ролям шаблон ни к чему (403).
 */
const BRAND = 'FFF97316'; // оранжевый примитивов UI (§13)

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Право раздела, а не только роль: default-deny профиль режет и шаблон —
  // единый гард со страницей и экспортом (ревью PR-2).
  const section = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.priceList')!;
  if (!canAccessSettingsSection(session, section)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Каталог');
  ws.columns = [
    { header: `${CATALOG_IMPORT_COLUMNS.name}*`, key: 'name', width: 40 },
    { header: `${CATALOG_IMPORT_COLUMNS.code}*`, key: 'code', width: 16 },
    { header: CATALOG_IMPORT_COLUMNS.unit, key: 'unit', width: 10 },
    { header: `${CATALOG_IMPORT_COLUMNS.price}*`, key: 'price', width: 14 },
    { header: CATALOG_IMPORT_COLUMNS.vatRate, key: 'vatRate', width: 14 },
    { header: CATALOG_IMPORT_COLUMNS.vatIncluded, key: 'vatIncluded', width: 12 },
    { header: CATALOG_IMPORT_COLUMNS.direction, key: 'direction', width: 30 },
    { header: CATALOG_IMPORT_COLUMNS.description, key: 'description', width: 40 },
    { header: CATALOG_IMPORT_COLUMNS.sortOrder, key: 'sortOrder', width: 10 },
  ];
  ws.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
  ws.addRow({
    name: 'Обучение по охране труда',
    code: 'OT-101',
    unit: 'чел.',
    price: '4500',
    vatRate: 'не облагается',
    vatIncluded: 'да',
    direction: '',
    description: 'Пример строки — замените своими данными',
    sortOrder: 0,
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="catalog-import-template.xlsx"',
    },
  });
}
