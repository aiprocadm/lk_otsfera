import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from '@/lib/services/import/column-map';

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAMES.payments);
  ws.addRow([
    PAYMENT_COLS.externalId,
    PAYMENT_COLS.orgInn,
    PAYMENT_COLS.amount,
    PAYMENT_COLS.paidAt,
    PAYMENT_COLS.purpose,
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
  const orgs = wb.addWorksheet(SHEET_NAMES.orgs);
  orgs.addRow([ORG_COLS.name, ORG_COLS.inn, ORG_COLS.partnerInn]);
  orgs.addRow(['ООО Ромашка', '7700000001', '']);
  const orders = wb.addWorksheet(SHEET_NAMES.orders);
  orders.addRow([ORDER_COLS.externalId, ORDER_COLS.orgInn, ORDER_COLS.totalAmount]);
  orders.addRow(['ORD-1', '7700000001', 1000]);
  const payments = wb.addWorksheet(SHEET_NAMES.payments);
  payments.addRow([PAYMENT_COLS.externalId, PAYMENT_COLS.orgInn, PAYMENT_COLS.amount]);
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
      SHEET_NAMES.orgs,
      SHEET_NAMES.orders,
      SHEET_NAMES.payments,
    ]);
    expect(diagnostics.sheetsExpected).toEqual([
      SHEET_NAMES.orgs,
      SHEET_NAMES.orders,
      SHEET_NAMES.payments,
    ]);
    expect(diagnostics.unmatchedHeaders[SHEET_NAMES.orgs]).toEqual([]);
  });

  it('лишний заголовок попадает в список нераспознанных под именем своего листа', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAMES.orgs);
    ws.addRow([ORG_COLS.name, 'КПП', ORG_COLS.inn, 'Адрес']);
    ws.addRow(['ООО Ромашка', '770001001', '7700000001', 'Москва']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { diagnostics } = await parseWorkbook(buf);
    expect(diagnostics.unmatchedHeaders[SHEET_NAMES.orgs]).toEqual(['КПП', 'Адрес']);
  });

  it('листы названы по-своему: их имена видны, ключей нераспознанных заголовков нет', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Реализация товаров и услуг');
    ws.addRow(['Номер', 'ИНН организации']);
    ws.addRow(['ORD-1', '7700000001']);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const { orders, diagnostics } = await parseWorkbook(buf);
    // Ни один лист карты не найден — строк нет, но причина теперь видна.
    expect(orders).toEqual([]);
    expect(diagnostics.sheetsFound).toEqual(['Реализация товаров и услуг']);
    expect(diagnostics.unmatchedHeaders).toEqual({});
  });
});
