import { describe, it, expect } from 'vitest';
import { parseAccountCard } from '@/lib/services/import/oneCAccountCard/parser';
import { detectColumns } from '@/lib/services/import/oneCAccountCard/columns';

/**
 * Регресс на жалобу пользователя (10.08.2026): «загружаю выписку — 327 строк,
 * к импорту 0, ошибок разбора 129». Разбор велся **по живому файлу**
 * (выгрузка 1С «Карточка счета 51 за Июнь 2026 г.», .xls), и причин оказалось
 * две, обе видны только на настоящей раскладке:
 *
 * 1. **Суммы в формате `14,800.00`.** `parseAmount` менял первую запятую на
 *    точку → `14.800.00` → `NaN` → «не найдена сумма». Так падали ВСЕ 129
 *    платежей: к импорту уходил ноль.
 * 2. **Шапка занимает ДВЕ строки, под «Дебет»/«Кредит» есть подколонка
 *    «Счет».** То есть в колонке «Дебет» лежит не сумма, а счёт (51); сумма —
 *    в следующей. Из этой же пары берётся корр-счёт: у поступления «Счет Кт»,
 *    у списания «Счет Дт».
 *
 * Фикстура ниже — копия реальных строк файла (данные обезличены только в
 * части номеров счетов).
 */
const REAL_SHEET: string[][] = [
  ['ООО «ПРОМТЕХНОСФЕРА»', '', '', '', '', '', '', '', '', '', '', ''],
  ['Карточка счета 51 за Июнь 2026 г.', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Выводимые данные: БУ (данные бухгалтерского учета)',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Отбор: Банковские счета Равно «40702810332430001489»',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Период',
    'Документ',
    'Аналитика Дт',
    'Аналитика Кт',
    'Дебет',
    '',
    '',
    'Кредит',
    '',
    '',
    'Текущее сальдо',
    '',
  ],
  ['', '', '', '', 'Счет', '', '', 'Счет', '', '', '', ''],
  ['Сальдо на начало', '', '', '', '', '', '', '', '', '', 'Д', '7,918.81'],
  // Поступление от клиента: сумма в «Дебете», корр-счёт — «Счет Кт» = 62.01.
  [
    '01.06.2026',
    'Поступление на расчетный счет 0000-001471 от 01.06.2026 17:00:00\nОплата по счету № 260509-1905 В Т.Ч. НДС (5%) 704-75',
    '40702810332430001489, ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ»',
    'ХОЛДИНГ ГЕФЕСТ ООО\nДС №260509-1905 от 19.05.2026 г.',
    '51',
    '14,800.00',
    '',
    '62.01',
    '',
    '',
    'Д',
    '22,718.81',
  ],
  // Оплата поставщику: сумма в «Кредите», корр-счёт — «Счет Дт» = 60.02.
  [
    '01.06.2026',
    'Списание с расчетного счета 0000-001183 от 01.06.2026 18:00:00\nОплата по договору',
    'Шпилевая Ева Владимировна ИП\nОсновной договор',
    '40702810332430001489, ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ»',
    '60.02',
    '',
    '',
    '51',
    '9,165.00',
    '',
    'Д',
    '13,553.81',
  ],
  // Возврат клиенту: списание, но корр-счёт 62.01 — это НЕ «прочие».
  [
    '02.06.2026',
    'Списание с расчетного счета 0000-001190 от 02.06.2026 10:00:00\nВозврат излишне уплаченного',
    'ХОЛДИНГ ГЕФЕСТ ООО ИНН 7701234567\nВозврат',
    '40702810332430001489, ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ»',
    '62.01',
    '',
    '',
    '51',
    '1,200.50',
    '',
    'Д',
    '12,353.31',
  ],
  // Перевод между своими счетами: 51 ↔ 51 → «прочие».
  [
    '02.06.2026',
    'Списание с расчетного счета 0000-001175 от 02.06.2026 18:00:00\nПеревод',
    '40702810532310003129, ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ»',
    '40702810332430001489, ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ»',
    '51',
    '',
    '',
    '51',
    '444.00',
    '',
    'Д',
    '11,909.31',
  ],
  ['Обороты за период и сальдо на конец', '', '', '', '', '', '', '', '', '', '', ''],
];

describe('detectColumns (У-56) на реальной раскладке', () => {
  it('видит двухстрочную шапку: под «Дебет»/«Кредит» лежит подколонка «Счет»', () => {
    const d = detectColumns(REAL_SHEET);
    expect(d.source).toBe('headers');
    // Тело начинается под НИЖНЕЙ строкой шапки.
    expect(d.headerRow).toBe(8);
    expect(d.columns).toMatchObject({
      date: 0,
      document: 1,
      analyticsDt: 2,
      analyticsCr: 3,
      debitAccount: 4,
      debitAmount: 5,
      creditAccount: 7,
      creditAmount: 8,
    });
  });

  it('однострочная шапка без подколонки «Счет»: сумма прямо под заголовком', () => {
    const d = detectColumns([['Период', 'Документ', 'Корр. счет', 'Дебет', 'Кредит']]);
    expect(d.source).toBe('headers');
    expect(d.headerRow).toBe(0);
    expect(d.columns).toMatchObject({
      date: 0,
      document: 1,
      corrAccount: 2,
      debitAmount: 3,
      creditAmount: 4,
      debitAccount: null,
    });
  });

  it('шапка без даты и без «Кредита»: недостающее берётся из прежней раскладки', () => {
    const d = detectColumns([['', 'Документ', 'Дебет']]);
    expect(d.source).toBe('headers');
    expect(d.columns).toMatchObject({
      document: 1,
      debitAmount: 2,
      // не найдено в заголовках → прежние индексы
      date: 0,
      analyticsDt: 2,
      analyticsCr: 3,
      creditAccount: 7,
      creditAmount: 8,
    });
    expect(d.matched.creditAmount).toBeUndefined();
  });

  it('шапка только с «Кредитом»: колонка дебета остаётся прежней', () => {
    const d = detectColumns([['Документ', 'Кредит']]);
    expect(d.source).toBe('headers');
    expect(d.columns).toMatchObject({ document: 0, creditAmount: 1, debitAmount: 5 });
    expect(d.matched.debitAmount).toBeUndefined();
  });

  it('без заголовков честно возвращает прежние жёсткие индексы', () => {
    const d = detectColumns([['мусор'], ['ещё мусор']]);
    expect(d.source).toBe('fallback');
    expect(d.headerRow).toBeNull();
    expect(d.columns).toMatchObject({ date: 0, document: 1, debitAmount: 5, creditAccount: 7 });
  });
});

describe('жалоба пользователя: 0 к импорту на живом файле', () => {
  it('платежи разбираются с ПРАВИЛЬНЫМИ суммами, ошибок разбора нет', () => {
    const { rows, diagnostics } = parseAccountCard(REAL_SHEET);

    expect(rows).toHaveLength(4);
    expect(diagnostics.parseErrorsByReason).toEqual({});

    const payment = rows.find((r) => r.kind === 'payment')!;
    expect(payment.externalId).toBe('0000-001471');
    // Главное: 14 800, а не NaN и не 51 (номер счёта из соседней колонки).
    expect(payment.amount).toBe(14800);
    expect(payment.paidAt).toBe('2026-06-01T00:00:00.000Z');
    expect(payment.counterpartyName).toBe('ХОЛДИНГ ГЕФЕСТ ООО');
    expect(payment.vatAmount).toBe(704.75);
  });

  it('возврат клиенту распознаётся как возврат, а не «прочие корр-счета»', () => {
    const { rows } = parseAccountCard(REAL_SHEET);
    const refund = rows.find((r) => r.kind === 'refund')!;

    expect(refund.externalId).toBe('0000-001190');
    expect(refund.isRefund).toBe(true);
    expect(refund.amount).toBe(1200.5);
    // Контрагент берётся из аналитики «с той стороны», где не расчётный счёт.
    expect(refund.counterpartyName).toBe('ХОЛДИНГ ГЕФЕСТ ООО');
    expect(refund.counterpartyInn).toBe('7701234567');
  });

  it('оплата поставщику и перевод между своими счетами исключаются с разными причинами', () => {
    const { rows } = parseAccountCard(REAL_SHEET);
    const reasons = rows.filter((r) => r.kind === 'excluded').map((r) => r.excludeReason);
    expect(reasons).toEqual(['supplier', 'corr_other']);
  });

  it('диагностика говорит, что и где нашлось (У-58)', () => {
    const { diagnostics } = parseAccountCard(REAL_SHEET);
    expect(diagnostics.columnSource).toBe('headers');
    expect(diagnostics.startMarkerFound).toBe(true);
    expect(diagnostics.rowsScanned).toBe(4);
    expect(diagnostics.notes).toEqual([]);
    expect(diagnostics.matchedColumns).toMatchObject({ debitAmount: 5, creditAccount: 7 });
  });

  it('непрочитанная строка попадает в примеры с номером строки и причиной', () => {
    const sheet = REAL_SHEET.map((r) => [...r]);
    sheet[10]![1] = 'Поступление на расчетный счет б/н\nОплата по счету';
    const { diagnostics } = parseAccountCard(sheet);

    expect(diagnostics.parseErrorsByReason).toMatchObject({ no_doc_number: 1 });
    expect(diagnostics.samples[0]).toMatchObject({ rowNumber: 11, reasons: ['no_doc_number'] });
    expect(diagnostics.samples[0]!.corr).toBe('62.01');
  });

  it('У-57: без «Сальдо на начало» таблица читается от заголовков и об этом сказано', () => {
    const sheet = REAL_SHEET.filter((r) => r[0] !== 'Сальдо на начало');
    const { rows, diagnostics } = parseAccountCard(sheet);

    expect(rows).toHaveLength(4);
    expect(diagnostics.startMarkerFound).toBe(false);
    expect(diagnostics.notes.join(' ')).toContain('Сальдо на начало');
  });

  it('выгрузка с отдельной колонкой «Корр. счет»: она главнее пары Дт/Кт', () => {
    const sheet = [
      ['Период', 'Документ', 'Корр. счет', 'Дебет', 'Кредит'],
      ['Сальдо на начало', '', '', '', ''],
      [
        '03.06.2026',
        'Поступление на расчетный счет 0000-002000 от 03.06.2026 09:00:00\nОплата по счету № 123',
        '62.01',
        '5 000,00',
        '',
      ],
      ['Обороты за период', '', '', '', ''],
    ];
    const { rows } = parseAccountCard(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'payment', externalId: '0000-002000', amount: 5000 });
  });

  it('совсем чужой файл: пустой результат, но с объяснением, а не молча', () => {
    const { rows, diagnostics } = parseAccountCard([['Отчёт о прибылях'], ['ничего похожего']]);
    expect(rows).toHaveLength(0);
    expect(diagnostics.notes.join(' ')).toContain('не карточка счёта 51');
  });
});
