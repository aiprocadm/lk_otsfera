import { describe, it, expect } from 'vitest';
import { parseAccountCard } from '@/lib/services/import/oneCAccountCard/parser';

// Минимальный лист: шапка, маркер начала, 3 операции, маркер конца.
// 12 колонок; заполняем только значимые индексы (0,1,3,5,7,8).
function cell(map: Record<number, string>): string[] {
  const row = Array.from({ length: 12 }, () => '');
  for (const [i, v] of Object.entries(map)) row[Number(i)] = v;
  return row;
}

const SHEET: string[][] = [
  cell({ 0: 'Карточка счёта 51' }), // 0 шапка
  cell({ 0: 'за Июнь 2026 г.' }), // 1 шапка
  cell({ 0: 'Период', 1: 'Документ' }), // 2 заголовки (упрощённо)
  cell({ 0: 'Сальдо на начало' }), // 3 маркер начала
  // 4: платёж 62.01
  cell({
    0: '01.06.2026',
    1: 'Поступление на расчетный счет 0000-001471 от 01.06.2026 17:00:00\nОплата по счету № 260509-1905 В Т.Ч. НДС (5%) 704-75',
    3: 'ХОЛДИНГ ГЕФЕСТ ООО\nДоговор № 5',
    5: '14800',
    7: '62.01',
  }),
  // 5: аванс 62.02
  cell({
    0: '02.06.2026',
    1: 'Поступление на расчетный счет 0000-001472 от 02.06.2026 09:00:00\nАванс по счету № 260424РД',
    3: 'РОМАШКА ООО ИНН 9909676723',
    5: '2600.1',
    7: '62.02',
  }),
  // 6: оплата поставщику corr 60 → excluded
  cell({
    0: '03.06.2026',
    1: 'Списание с расчетного счета 0000-001473 от 03.06.2026 12:00:00\nОплата поставщику',
    3: 'ПОСТАВЩИК ООО',
    7: '60',
    8: '5000',
  }),
  cell({ 0: 'Обороты за период и сальдо на конец' }), // 7 маркер конца
  cell({ 5: '17400.1' }), // 8 итоги — пропустить
];

describe('parseAccountCard', () => {
  it('returns only operation rows (between markers)', () => {
    const rows = parseAccountCard(SHEET).rows;
    expect(rows).toHaveLength(3);
  });

  it('parses 62.01 incoming as payment with full fields', () => {
    const p = parseAccountCard(SHEET).rows.find((r) => r.externalId === '0000-001471')!;
    expect(p.kind).toBe('payment');
    expect(p.isRefund).toBe(false);
    expect(p.amount).toBe(14800);
    expect(p.paidAt).toBe('2026-06-01T00:00:00.000Z');
    expect(p.accountCandidates).toContain('260509-1905');
    expect(p.vatAmount).toBe(704.75);
    expect(p.counterpartyName).toBe('ХОЛДИНГ ГЕФЕСТ ООО');
    expect(p.paymentOrderNumber).toBe('0000-001471');
  });

  it('parses 62.02 advance as payment and reads INN', () => {
    const p = parseAccountCard(SHEET).rows.find((r) => r.externalId === '0000-001472')!;
    expect(p.kind).toBe('payment');
    expect(p.amount).toBe(2600.1);
    expect(p.counterpartyInn).toBe('9909676723');
  });

  it('marks corr-60 supplier row as excluded', () => {
    const p = parseAccountCard(SHEET).rows.find((r) => r.externalId === '0000-001473')!;
    expect(p.kind).toBe('excluded');
    expect(p.excludeReason).toBe('supplier');
  });

  it('synthetic Списание + corr 62 → refund, amount from col[8]', () => {
    const sheet: string[][] = [
      cell({ 0: 'Сальдо на начало' }),
      cell({
        0: '04.06.2026',
        1: 'Списание с расчетного счета 0000-001999 от 04.06.2026 10:00:00\nВозврат по счету № 260509-1905',
        3: 'ХОЛДИНГ ГЕФЕСТ ООО',
        7: '62.01',
        8: '1500',
      }),
      cell({ 0: 'Обороты за период' }),
    ];
    const r = parseAccountCard(sheet).rows[0];
    expect(r.kind).toBe('refund');
    expect(r.isRefund).toBe(true);
    expect(r.amount).toBe(1500);
  });

  it('"НДС не облагается" → vatAmount 0', () => {
    const sheet: string[][] = [
      cell({ 0: 'Сальдо на начало' }),
      cell({
        0: '05.06.2026',
        1: 'Поступление на расчетный счет 0000-002000 от 05.06.2026 10:00:00\nОплата по счету № 260101-1 НДС не облагается',
        3: 'УПРОЩЕНЕЦ ООО',
        5: '9000',
        7: '62.01',
      }),
      cell({ 0: 'Обороты за период' }),
    ];
    expect(parseAccountCard(sheet).rows[0].vatAmount).toBe(0);
  });

  it('flags parseError when amount/date missing', () => {
    const sheet: string[][] = [
      cell({ 0: 'Сальдо на начало' }),
      cell({ 0: '', 1: 'Поступление на расчетный счет 0000-002001 от ...', 7: '62.01' }),
      cell({ 0: 'Обороты за период' }),
    ];
    const r = parseAccountCard(sheet).rows[0];
    expect(r.parseError).toBeTruthy();
  });

  it('обрезанная строка без колонок аналитики не роняет разбор', () => {
    // В урезанных выгрузках строка кончается раньше — соседней колонки просто
    // нет. Падать нельзя: строка должна дойти до списка ошибок разбора, а не
    // обрушить весь файл.
    const sheet: string[][] = [
      cell({ 0: 'Сальдо на начало' }),
      ['05.06.2026', 'Списание с расчетного счета 0000-002002 от 05.06.2026', ''],
      cell({ 0: 'Обороты за период' }),
    ];
    const parsed = parseAccountCard(sheet);
    expect(parsed.rows).toHaveLength(1);
    // Имени контрагента взять неоткуда — строка уйдёт в ручной разбор.
    expect(parsed.rows[0].counterpartyName).toBeNull();
  });
});
