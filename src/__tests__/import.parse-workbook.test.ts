import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from '@/lib/services/import/column-map';

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAMES.payments[0]);
  ws.addRow([
    PAYMENT_COLS.externalId[0],
    PAYMENT_COLS.orgInn[0],
    PAYMENT_COLS.amount[0],
    PAYMENT_COLS.paidAt[0],
    PAYMENT_COLS.purpose[0],
  ]);
  ws.addRow(['PP-1', '7700', 1000, '2026-04-20', 'аванс']);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

describe('parseWorkbook', () => {
  it('maps headers to DTO fields by column-map', async () => {
    const { payments } = await parseWorkbook(await buildBook());
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      externalId: 'PP-1',
      orgInn: '7700',
      amount: 1000,
      purpose: 'аванс',
    });
  });
  it('returns empty arrays for missing sheets without throwing', async () => {
    const { orgs, orders } = await parseWorkbook(await buildBook());
    expect(orgs).toEqual([]);
    expect(orders).toEqual([]);
  });
});

/** Книга со всеми тремя листами по текущей карте — «идеальный» файл. */
async function buildFullBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet(SHEET_NAMES.orgs[0]);
  orgs.addRow([ORG_COLS.name[0], ORG_COLS.inn[0], ORG_COLS.partnerInn[0]]);
  orgs.addRow(['ООО Ромашка', '7700000001', '']);
  const orders = wb.addWorksheet(SHEET_NAMES.orders[0]);
  orders.addRow([ORDER_COLS.externalId[0], ORDER_COLS.orgInn[0], ORDER_COLS.totalAmount[0]]);
  orders.addRow(['ORD-1', '7700000001', 1000]);
  const payments = wb.addWorksheet(SHEET_NAMES.payments[0]);
  payments.addRow([PAYMENT_COLS.externalId[0], PAYMENT_COLS.orgInn[0], PAYMENT_COLS.amount[0]]);
  payments.addRow(['PP-1', '7700000001', 500]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

/**
 * Диагностика разбора (Т-3): ради неё этап и делается — пользователь должен
 * видеть, что система нашла в файле, а не только «Файл пуст».
 */
describe('parseWorkbook — диагностика', () => {
  it('все листы на месте: перечислены найденные и ожидаемые, нераспознанных заголовков нет', async () => {
    const { diagnostics } = await parseWorkbook(await buildFullBook());
    expect(diagnostics.sheetsFound).toEqual([
      SHEET_NAMES.orgs[0],
      SHEET_NAMES.orders[0],
      SHEET_NAMES.payments[0],
    ]);
    expect(diagnostics.sheetsExpected).toEqual([
      SHEET_NAMES.orgs[0],
      SHEET_NAMES.orders[0],
      SHEET_NAMES.payments[0],
    ]);
    expect(diagnostics.unmatchedHeaders[SHEET_NAMES.orgs[0]]).toEqual([]);
  });

  it('лишний заголовок попадает в список нераспознанных под именем своего листа', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAMES.orgs[0]);
    ws.addRow([ORG_COLS.name[0], 'КПП', ORG_COLS.inn[0], 'Адрес']);
    ws.addRow(['ООО Ромашка', '770001001', '7700000001', 'Москва']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { diagnostics } = await parseWorkbook(buf);
    // С этапа 5 «КПП» — известная колонка (ORG_COLS.kpp); чужим остался только адрес.
    expect(diagnostics.unmatchedHeaders[SHEET_NAMES.orgs[0]]).toEqual(['Адрес']);
  });

  it('настояще чужое имя листа: имя видно, ключей нераспознанных заголовков нет', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.addRow(['Номер', 'ИНН организации']);
    ws.addRow(['ORD-1', '7700000001']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orders, diagnostics } = await parseWorkbook(buf);
    // Ни один лист карты не найден — строк нет, но причина теперь видна.
    expect(orders).toEqual([]);
    expect(diagnostics.sheetsFound).toEqual(['Лист1']);
    expect(diagnostics.unmatchedHeaders).toEqual({});
  });

  it('этап 3 (Т-10): «Реализация товаров и услуг» распознаётся как лист заказов', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Реализация товаров и услуг');
    ws.addRow(['Номер', 'ИНН контрагента', 'Сумма документа']);
    ws.addRow(['ORD-9', '7700000009', 500]);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orders, diagnostics } = await parseWorkbook(buf);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      externalId: 'ORD-9',
      orgInn: '7700000009',
      totalAmount: 500,
    });
    expect(diagnostics.unmatchedHeaders['Реализация товаров и услуг']).toEqual([]);
  });

  it('этап 3 (Т-8): шапка с «ё/е», регистром и неразрывным пробелом распознаётся', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('КОНТРАГЕНТЫ');
    ws.addRow(['НАИМЕНОВАНИЕ', 'инн', 'ИНН\u00A0партнера']);
    ws.addRow(['ООО Ромашка', '7700000001', '7712345678']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orgs, diagnostics } = await parseWorkbook(buf);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      name: 'ООО Ромашка',
      inn: '7700000001',
      partnerInn: '7712345678',
    });
    expect(diagnostics.unmatchedHeaders['КОНТРАГЕНТЫ']).toEqual([]);
  });

  it('этап 3 (Т-12): лист без обязательной колонки попадает в missingColumns', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Поступления');
    // Нет «Сумма» и «Дата» — обязательных для оплат.
    ws.addRow(['Номер документа', 'ИНН']);
    ws.addRow(['PP-1', '7700000001']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { diagnostics } = await parseWorkbook(buf);
    expect(diagnostics.missingColumns['Поступления']).toEqual(['Сумма', 'Дата']);
  });

  it('этап 3: распознанный, но совсем пустой лист — без падения, обязательные колонки в missing', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Контрагенты');
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orgs, diagnostics } = await parseWorkbook(buf);
    expect(orgs).toEqual([]);
    expect(diagnostics.unmatchedHeaders['Контрагенты']).toEqual([]);
    expect(diagnostics.missingColumns['Контрагенты']).toEqual(['ИНН']);
  });

  it('этап 3: два листа под один вид — берётся первый, второй виден в duplicateSheets', async () => {
    const wb = new ExcelJS.Workbook();
    const first = wb.addWorksheet('Контрагенты');
    first.addRow(['Наименование', 'ИНН']);
    first.addRow(['ООО Первая', '7700000001']);
    const second = wb.addWorksheet('Контрагенты (копия)');
    second.addRow(['Наименование', 'ИНН']);
    second.addRow(['ООО Вторая', '7700000002']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orgs, diagnostics } = await parseWorkbook(buf);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ name: 'ООО Первая' });
    expect(diagnostics.duplicateSheets['Контрагенты']).toEqual(['Контрагенты (копия)']);
  });
});
