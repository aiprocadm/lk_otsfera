import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { renderOrdersXlsx } from '@/lib/services/orders/xlsx';
import { renderPaymentsXlsx } from '@/lib/services/finance/xlsx';
import { renderOrgStudentsXlsx } from '@/lib/services/organization/students-xlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';
import type { OrgStudentExportRow } from '@/lib/services/organization/students';

/**
 * Этап 9 PR-3 (ФТ-12.2): три новых xlsx-рендерера — колонки, русские подписи
 * статусов, прочерки вместо пустот, лимит строк с хвостом и защита от
 * формула-инъекций.
 */

async function load(buf: ExcelJS.Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

function headersOf(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(1).eachCell((c) => out.push(String(c.value)));
  return out;
}

function rowValues(ws: ExcelJS.Worksheet, rowNumber: number): string[] {
  const out: string[] = [];
  ws.getRow(rowNumber).eachCell((c) => out.push(String(c.value)));
  return out;
}

const order = (over: Partial<ManagerOrderRow> = {}): ManagerOrderRow =>
  ({
    id: 'o1',
    orderNumber: 'ЗК-1',
    title: 'Обучение по охране труда',
    organization: { id: 'org1', name: 'ООО Ромашка' },
    manager: { id: 'm1', name: 'Петров Пётр', email: 'p@x.ru' },
    executionStatus: 'in_progress',
    financialStatus: 'partially_paid',
    totalAmount: new Prisma.Decimal('1000.00'),
    paidAmount: new Prisma.Decimal('400.00'),
    createdAt: new Date('2026-02-10T09:00:00Z'),
    ...over,
  }) as unknown as ManagerOrderRow;

describe('renderOrdersXlsx', () => {
  it('колонки, русские статусы и посчитанный долг', async () => {
    const wb = await load(await renderOrdersXlsx({ rows: [order()], total: 1 }));
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Заказы');
    expect(headersOf(ws)).toEqual([
      '№',
      'Номер заказа',
      'Название',
      'Организация',
      'Менеджер',
      'Статус',
      'Оплата',
      'Сумма, ₽',
      'Оплачено, ₽',
      'Долг, ₽',
      'Создан',
    ]);
    const row = rowValues(ws, 2);
    expect(row).toContain('В работе');
    expect(row).toContain('Частично оплачен');
    expect(row).toContain('600.00');
    expect(row).toContain('10.02.2026');
  });

  it('нет номера и менеджера — прочерки; неизвестный код статуса выводится как есть', async () => {
    const wb = await load(
      await renderOrdersXlsx({
        rows: [
          order({
            orderNumber: null,
            manager: null,
            executionStatus: 'exotic' as never,
            financialStatus: 'exotic' as never,
          }),
        ],
        total: 1,
      })
    );
    const row = rowValues(wb.worksheets[0]!, 2);
    expect(row.filter((v) => v === '—').length).toBe(2);
    expect(row.filter((v) => v === 'exotic').length).toBe(2);
  });

  it('менеджер без имени — показываем email', async () => {
    const wb = await load(
      await renderOrdersXlsx({
        rows: [order({ manager: { id: 'm1', name: null, email: 'p@x.ru' } as never })],
        total: 1,
      })
    );
    expect(rowValues(wb.worksheets[0]!, 2)).toContain('p@x.ru');
  });

  it('формула-инъекция в названии обезврежена', async () => {
    const wb = await load(
      await renderOrdersXlsx({ rows: [order({ title: '=HYPERLINK("evil")' })], total: 1 })
    );
    expect(rowValues(wb.worksheets[0]!, 2)).toContain('\'=HYPERLINK("evil")');
  });

  it('срез по лимиту + хвост о превышении', async () => {
    const rows = Array.from({ length: EXPORT_ROW_LIMIT + 3 }, (_, i) =>
      order({ id: `o${i}`, orderNumber: `ЗК-${i}` })
    );
    const wb = await load(await renderOrdersXlsx({ rows, total: rows.length }));
    const ws = wb.worksheets[0]!;
    // шапка + лимит строк + пустая + хвост
    expect(ws.rowCount).toBe(EXPORT_ROW_LIMIT + 3);
    // после load() ключи колонок теряются — 2-я колонка это «Номер заказа»
    expect(String(ws.getRow(ws.rowCount).getCell(2).value)).toContain(
      `Показаны первые ${EXPORT_ROW_LIMIT} строк из ${rows.length}`
    );
  });

  it('пустая выдача — только шапка, без автофильтра', async () => {
    const wb = await load(await renderOrdersXlsx({ rows: [], total: 0 }));
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(1);
    expect(ws.autoFilter).toBeFalsy();
  });
});

const payment = (over: Partial<OrgPaymentRow> = {}): OrgPaymentRow => ({
  id: 'p1',
  amount: '1000.00',
  paidAt: new Date('2026-02-11T09:00:00Z'),
  method: 'wire',
  isRefund: false,
  note: 'предоплата',
  orderId: 'o1',
  orderNumber: 'ЗК-1',
  vatAmount: '166.67',
  purpose: 'обучение',
  paymentOrderNumber: '77',
  enteredByName: 'Петров Пётр',
  ...over,
});

const KPIS = { billed: '1000.00', paid: '400.00', outstanding: '600.00' };

describe('renderPaymentsXlsx', () => {
  it('лист «Платежи» с русским способом оплаты и лист «Итоги» с KPI', async () => {
    const wb = await load(
      await renderPaymentsXlsx({
        rows: [payment()],
        total: 1,
        kpis: KPIS,
        organizationName: 'ООО Ромашка',
      })
    );
    const ws = wb.getWorksheet('Платежи')!;
    expect(headersOf(ws)).toEqual([
      '№',
      'Дата',
      'Заказ',
      'Сумма, ₽',
      'НДС, ₽',
      'Назначение',
      '№ платёжного поручения',
      'Способ',
      'Возврат',
      'Внёс',
      'Комментарий',
    ]);
    const row = rowValues(ws, 2);
    expect(row).toContain('Банковский перевод');
    expect(row).toContain('нет');
    expect(row).toContain('11.02.2026');

    const totals = wb.getWorksheet('Итоги')!;
    const labels = totals.getColumn(1).values.map((v) => String(v));
    expect(labels).toContain('Задолженность, ₽');
    expect(totals.getColumn(2).values.map((v) => String(v))).toContain('600.00');
  });

  it('возврат помечается «да», пустые поля — прочерки', async () => {
    const wb = await load(
      await renderPaymentsXlsx({
        rows: [
          payment({
            isRefund: true,
            method: null,
            note: null,
            purpose: null,
            paymentOrderNumber: null,
            enteredByName: null,
            orderNumber: null,
            vatAmount: null,
          }),
        ],
        total: 1,
        kpis: KPIS,
        organizationName: 'ООО Ромашка',
      })
    );
    const row = rowValues(wb.getWorksheet('Платежи')!, 2);
    expect(row).toContain('да');
    // способ оплаты без кода тоже даёт прочерк (paymentMethodRu)
    expect(row.filter((v) => v === '—').length).toBeGreaterThanOrEqual(6);
  });

  it('срез по лимиту + хвост в колонке даты', async () => {
    const rows = Array.from({ length: EXPORT_ROW_LIMIT + 2 }, (_, i) => payment({ id: `p${i}` }));
    const wb = await load(
      await renderPaymentsXlsx({
        rows,
        total: rows.length,
        kpis: KPIS,
        organizationName: 'ООО Ромашка',
      })
    );
    const ws = wb.getWorksheet('Платежи')!;
    expect(String(ws.getRow(ws.rowCount).getCell(2).value)).toContain(
      `Показаны первые ${EXPORT_ROW_LIMIT} строк из ${rows.length}`
    );
  });
});

const student = (over: Partial<OrgStudentExportRow> = {}): OrgStudentExportRow => ({
  id: 's1',
  name: 'Иванов Иван',
  email: 'i@x.ru',
  position: 'Инженер',
  externalStudentId: 'EXT-1',
  createdAt: new Date('2026-01-20T09:00:00Z'),
  activeCertificates: 2,
  ...over,
});

describe('renderOrgStudentsXlsx', () => {
  it('колонки ФТ-12.2: ФИО, должность, счётчик действующих удостоверений', async () => {
    const wb = await load(await renderOrgStudentsXlsx({ rows: [student()], total: 1 }));
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Сотрудники');
    expect(headersOf(ws)).toEqual([
      '№',
      'ФИО',
      'Email',
      'Должность',
      'Действующих удостоверений',
      'Внешний id',
      'Добавлен',
    ]);
    const row = rowValues(ws, 2);
    expect(row).toContain('Иванов Иван');
    expect(row).toContain('Инженер');
    expect(row).toContain('2');
    expect(row).toContain('20.01.2026');
  });

  it('пустая должность — прочерк (поле необязательное)', async () => {
    const wb = await load(
      await renderOrgStudentsXlsx({
        rows: [student({ position: null, externalStudentId: null, activeCertificates: 0 })],
        total: 1,
      })
    );
    const row = rowValues(wb.worksheets[0]!, 2);
    expect(row.filter((v) => v === '—').length).toBe(2);
    expect(row).toContain('0');
  });

  it('срез по лимиту + хвост в колонке ФИО', async () => {
    const rows = Array.from({ length: EXPORT_ROW_LIMIT + 1 }, (_, i) => student({ id: `s${i}` }));
    const wb = await load(await renderOrgStudentsXlsx({ rows, total: rows.length }));
    const ws = wb.worksheets[0]!;
    expect(String(ws.getRow(ws.rowCount).getCell(2).value)).toContain(
      `Показаны первые ${EXPORT_ROW_LIMIT} строк из ${rows.length}`
    );
  });
});
