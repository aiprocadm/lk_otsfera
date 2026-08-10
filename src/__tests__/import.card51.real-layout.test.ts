import { describe, it, expect } from 'vitest';
import { parseAccountCard } from '@/lib/services/import/oneCAccountCard/parser';
import { detectColumns } from '@/lib/services/import/oneCAccountCard/columns';

/**
 * Регресс на реальную жалобу пользователя (10.08.2026): «загружаю выписку —
 * 327 строк, к импорту 0, ошибок разбора 129». Причина оказалась не одна:
 *
 * 1. номер документа искался ЕДИНСТВЕННЫМ шаблоном «цифры-дефис-цифры»
 *    (`0000-001471`). В базе 1С с буквенным префиксом (`БП-000123`) номера не
 *    находилось НИ У ОДНОЙ строки — и весь файл уходил в «ошибки разбора»;
 * 2. колонки брались по жёстким индексам, поэтому файл из другой конфигурации
 *    разбирался в мусор (`У-56`).
 *
 * Здесь оба случая закреплены на раскладке, отличной от «эталонной».
 */

/** Лист с ДРУГИМ порядком колонок и буквенными номерами документов. */
function sheetWithShiftedColumns(): string[][] {
  const row = (map: Record<number, string>): string[] => {
    const cells = Array.from({ length: 10 }, () => '');
    for (const [i, v] of Object.entries(map)) cells[Number(i)] = v;
    return cells;
  };
  return [
    row({ 0: 'Карточка счета 51 за Июнь 2026 г.' }),
    row({ 0: 'ООО «Ромашка»' }),
    // Заголовки: дата в 0, документ в 1, аналитика в 2, корр-счёт в 3,
    // дебет в 4, кредит в 5 — «дебет» уехал с 5-й позиции на 4-ю.
    row({
      0: 'Период',
      1: 'Документ',
      2: 'Аналитика Кт',
      3: 'Корр. счет',
      4: 'Дебет',
      5: 'Кредит',
    }),
    row({ 0: 'Сальдо на начало' }),
    row({
      0: '01.06.2026',
      1: 'Поступление на расчетный счет БП-000123 от 01.06.2026 10:15:00\nОплата по счету № 260509-1905 в т.ч. НДС (5%) 704-75',
      2: 'ХОЛДИНГ ГЕФЕСТ ООО ИНН 7701234567',
      3: '62.01',
      4: '14 800,00',
    }),
    row({
      0: '02.06.2026',
      1: 'Поступление на расчетный счет ПП00-000045 от 02.06.2026 09:00:00\nАванс по счету № 260424РД',
      2: 'РОМАШКА ООО ИНН 9909676723',
      3: '62.02',
      4: '2 600,10',
    }),
    row({
      0: '03.06.2026',
      1: 'Списание с расчетного счета 15 от 03.06.2026 12:00:00\nВозврат излишне уплаченного',
      2: 'ХОЛДИНГ ГЕФЕСТ ООО',
      3: '62.01',
      5: '500,00',
    }),
    row({
      0: '04.06.2026',
      1: 'Списание с расчетного счета БП-000900 от 04.06.2026 12:00:00\nОплата поставщику',
      2: 'ПОСТАВЩИК ООО',
      3: '60.01',
      5: '5 000,00',
    }),
    row({ 0: 'Обороты за период и сальдо на конец' }),
  ];
}

describe('detectColumns (У-56): колонки по заголовкам', () => {
  it('находит сдвинутую раскладку и сообщает, что взял из заголовков', () => {
    const d = detectColumns(sheetWithShiftedColumns());
    expect(d.source).toBe('headers');
    expect(d.headerRow).toBe(2);
    expect(d.columns).toMatchObject({ date: 0, document: 1, analyticsCr: 2, corr: 3, debit: 4 });
  });

  it('без заголовков честно возвращает запасные жёсткие индексы', () => {
    const d = detectColumns([['мусор'], ['ещё мусор']]);
    expect(d.source).toBe('fallback');
    expect(d.headerRow).toBeNull();
    expect(d.columns).toMatchObject({ date: 0, document: 1, debit: 5, corr: 7 });
  });

  it('заголовки, разъехавшиеся по двум строкам (объединённые ячейки 1С)', () => {
    const sheet = [
      ['Карточка счета 51', '', '', ''],
      ['Период', 'Документ', 'Аналитика Кт', ''],
      ['', '', 'Корр. счет', 'Дебет'],
    ];
    const d = detectColumns(sheet);
    expect(d.source).toBe('headers');
    // Строкой заголовков считается НИЖНЯЯ: тело идёт под ней.
    expect(d.headerRow).toBe(2);
    expect(d.columns).toMatchObject({ date: 0, document: 1, corr: 2, debit: 3 });
  });

  it('нашлась только часть заголовков — остальные берутся из запасной раскладки', () => {
    const d = detectColumns([['Документ', 'Кредит']]);
    expect(d.source).toBe('headers');
    expect(d.columns).toMatchObject({
      document: 0,
      credit: 1,
      // не найдены в заголовках → прежние жёсткие индексы
      date: 0,
      analyticsCr: 3,
      debit: 5,
      corr: 7,
    });
  });
});

describe('жалоба пользователя: 0 к импорту при живом файле', () => {
  it('строки с буквенными номерами документов разбираются, а не падают в ошибки', () => {
    const { rows, diagnostics } = parseAccountCard(sheetWithShiftedColumns());

    const payments = rows.filter((r) => r.kind !== 'excluded');
    expect(payments).toHaveLength(3);
    // Главное: ни одной ошибки разбора там, где раньше падали все.
    expect(payments.filter((r) => r.parseError)).toHaveLength(0);
    expect(diagnostics.parseErrorsByReason).toEqual({});

    expect(payments.map((r) => r.externalId)).toEqual(['БП-000123', 'ПП00-000045', '15']);
    // Суммы взяты из «Дебета», найденного по заголовку, а не из 5-й колонки.
    expect(payments[0]!.amount).toBe(14800);
    expect(payments[1]!.amount).toBe(2600.1);
    // Возврат читается из «Кредита».
    expect(payments[2]!.isRefund).toBe(true);
    expect(payments[2]!.amount).toBe(500);
    expect(payments[0]!.counterpartyInn).toBe('7701234567');
  });

  it('диагностика говорит, что и где нашлось (У-58)', () => {
    const { diagnostics } = parseAccountCard(sheetWithShiftedColumns());
    expect(diagnostics.columnSource).toBe('headers');
    expect(diagnostics.startMarkerFound).toBe(true);
    expect(diagnostics.rowsScanned).toBe(4);
    expect(diagnostics.notes).toEqual([]);
  });

  it('непрочитанная строка попадает в примеры с номером строки и причиной', () => {
    const sheet = sheetWithShiftedColumns();
    // Портим документ: номера нет вовсе.
    sheet[4]![1] = 'Поступление на расчетный счет б/н\nОплата по счету';
    const { diagnostics } = parseAccountCard(sheet);

    expect(diagnostics.parseErrorsByReason).toMatchObject({ no_doc_number: 1 });
    expect(diagnostics.samples[0]).toMatchObject({ rowNumber: 5, reasons: ['no_doc_number'] });
    expect(diagnostics.samples[0]!.document).toContain('Поступление');
  });

  it('У-57: без «Сальдо на начало» таблица читается от заголовков и об этом сказано', () => {
    const sheet = sheetWithShiftedColumns().filter((r) => r[0] !== 'Сальдо на начало');
    const { rows, diagnostics } = parseAccountCard(sheet);

    expect(rows.filter((r) => r.kind !== 'excluded')).toHaveLength(3);
    expect(diagnostics.startMarkerFound).toBe(false);
    expect(diagnostics.notes.join(' ')).toContain('Сальдо на начало');
  });

  it('вторая строка шапки не превращается в операцию', () => {
    const sheet = [
      ['Карточка счета 51', '', '', '', ''],
      ['Период', 'Документ', 'Аналитика Кт', '', ''],
      ['', '', 'Корр. счет', 'Дебет', 'Кредит'],
      ['Сальдо на начало', '', '', '', ''],
      [
        '01.06.2026',
        'Поступление на расчетный счет БП-1 от 01.06.2026 10:00:00\nОплата',
        'ГЕФЕСТ ООО',
        '62.01',
        '100',
      ],
      ['Обороты за период', '', '', '', ''],
    ];
    const { rows } = parseAccountCard(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe('БП-1');
  });

  it('совсем чужой файл: пустой результат, но с объяснением, а не молча', () => {
    const { rows, diagnostics } = parseAccountCard([['Отчёт о прибылях'], ['ничего похожего']]);
    expect(rows).toHaveLength(0);
    expect(diagnostics.notes.join(' ')).toContain('не карточка счёта 51');
  });
});
