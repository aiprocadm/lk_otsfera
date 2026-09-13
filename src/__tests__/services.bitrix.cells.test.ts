import { describe, expect, it } from 'vitest';

import {
  cellDate,
  cellDigitsOrNull,
  cellFlag,
  cellList,
  cellMoney,
  cellText,
  cellTextOrNull,
} from '@/lib/services/bitrix/cells';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189` file, `У-200`): значения ячеек выгрузки
 * Битрикс24 → примитивы источника. Ячейка приходит от exceljs, поэтому кроме
 * строки и числа бывает `Date`, rich text (куски с разным оформлением),
 * формула `{ result }` и ссылка `{ text, hyperlink }`.
 */

describe('cellText — текст ячейки exceljs', () => {
  it('пустая ячейка (null и undefined) → пустая строка', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('дата отдаётся в ISO — дальше её разбирает cellDate', () => {
    expect(cellText(new Date('2025-11-03T09:00:00Z'))).toBe('2025-11-03T09:00:00.000Z');
  });

  it('число становится строкой, а у строки обрезаются пробелы по краям', () => {
    expect(cellText(7712345678)).toBe('7712345678');
    expect(cellText(0)).toBe('0');
    expect(cellText('  АО «Бета»  ')).toBe('АО «Бета»');
  });

  it('rich text склеивается БЕЗ обрезки внутренних пробелов — пробел между кусками значим', () => {
    // Excel режет строку на куски по оформлению: «АО «Бета» жирным, « Логистик»» обычным.
    // Если тримить каждый кусок, получится «АО «БетаЛогистик»» — склеенное слово.
    expect(cellText({ richText: [{ text: 'АО «Бета' }, { text: ' Логистик»' }] })).toBe(
      'АО «Бета Логистик»'
    );
  });

  it('кусок rich text без текста (undefined или null) не ломает склейку', () => {
    expect(cellText({ richText: [{ text: 'Альфа' }, {}, { text: null }, { text: ' и Ко' }] })).toBe(
      'Альфа и Ко'
    );
  });

  it('rich text из одних пустых кусков → пустая строка', () => {
    expect(cellText({ richText: [{ text: '   ' }] })).toBe('');
  });

  it('число внутри куска rich text приводится к строке', () => {
    expect(cellText({ richText: [{ text: 120000 }] })).toBe('120000');
  });

  it('ссылка exceljs — берётся подпись, а не адрес', () => {
    expect(
      cellText({ text: 'ООО «Гамма»', hyperlink: 'https://demo.bitrix24.ru/crm/company/1/' })
    ).toBe('ООО «Гамма»');
  });

  it('формула — берётся её результат, в том числе вложенный rich text', () => {
    expect(cellText({ formula: 'A1&B1', result: '  120000  ' })).toBe('120000');
    expect(cellText({ result: { richText: [{ text: 'Итого' }] } })).toBe('Итого');
  });

  it('объект без знакомых полей → пустая строка (в том числе richText не массивом)', () => {
    expect(cellText({ sharedFormula: 'A1' })).toBe('');
    expect(cellText({ richText: 'не массив' })).toBe('');
    expect(cellText({})).toBe('');
  });
});

describe('cellTextOrNull — текст или «поля нет»', () => {
  it('непустой текст возвращается, пустой и отсутствующий → null', () => {
    expect(cellTextOrNull('  Комментарий  ')).toBe('Комментарий');
    expect(cellTextOrNull('   ')).toBeNull();
    expect(cellTextOrNull(null)).toBeNull();
  });
});

describe('cellDigitsOrNull — ИНН и КПП', () => {
  it('оставляет только цифры и переживает число из Excel', () => {
    expect(cellDigitsOrNull('7712 34-56 78')).toBe('7712345678');
    // Excel хранит ИНН числом, если в нём нет ведущего нуля.
    expect(cellDigitsOrNull(7712345678)).toBe('7712345678');
  });

  it('строка без цифр и пустая ячейка → null', () => {
    expect(cellDigitsOrNull('—')).toBeNull();
    expect(cellDigitsOrNull('')).toBeNull();
    expect(cellDigitsOrNull(null)).toBeNull();
  });
});

describe('cellDate — даты выгрузки читаются как UTC', () => {
  it('готовый Date возвращается как есть', () => {
    const d = new Date('2025-11-03T09:00:00Z');
    expect(cellDate(d)).toBe(d);
  });

  it('битый Date (Invalid Date) → null, а не «дата-мусор»', () => {
    expect(cellDate(new Date('не дата'))).toBeNull();
  });

  it('портальный формат «ДД.ММ.ГГГГ ЧЧ:ММ:СС» читается как UTC, а не по поясу сервера', () => {
    // Выгрузка не сообщает пояс портала; детерминированный UTC важнее «местного» времени.
    expect(cellDate('03.11.2025 09:00:00')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
  });

  it('дата без времени → полночь UTC', () => {
    expect(cellDate('20.12.2025')?.toISOString()).toBe('2025-12-20T00:00:00.000Z');
  });

  it('время без секунд тоже читается', () => {
    expect(cellDate('03.11.2025 09:00')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
  });

  it('однозначные день и месяц без ведущего нуля читаются', () => {
    expect(cellDate('3.1.2026')?.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });

  it('портальная дата через «T» вместо пробела тоже разбирается', () => {
    expect(cellDate('03.11.2025T09:00:00')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
  });

  it('ISO без зоны трактуется как UTC', () => {
    expect(cellDate('2025-11-03T09:00:00')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
    expect(cellDate('2025-11-03 09:00')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
    expect(cellDate('2025-11-03')?.toISOString()).toBe('2025-11-03T00:00:00.000Z');
    expect(cellDate('2025-11-03T09:00:00.250')?.toISOString()).toBe('2025-11-03T09:00:00.250Z');
  });

  it('ISO с явной зоной Z разбирается штатным Date', () => {
    expect(cellDate('2025-11-03T09:00:00Z')?.toISOString()).toBe('2025-11-03T09:00:00.000Z');
  });

  it('мусор и пустая ячейка → null', () => {
    expect(cellDate('абырвалг')).toBeNull();
    expect(cellDate('')).toBeNull();
    expect(cellDate(null)).toBeNull();
  });

  it('несуществующая дата «31.02.2026» → null, а не 3 марта', () => {
    // `Date.UTC(2026, 1, 31)` молча перекатился бы на 3 марта: в предпросмотре
    // это уверенная неправда, поэтому дата сверяется с исходными числами.
    expect(cellDate('31.02.2026')).toBeNull();
  });

  it('нулевая дата «00.00.0000» → null: формат подошёл, значения нет', () => {
    expect(cellDate('00.00.0000')).toBeNull();
  });

  it('последний день месяца принимается — отсечка не съедает настоящие даты', () => {
    expect(cellDate('29.02.2024')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(cellDate('31.12.2025 23:59:59')?.toISOString()).toBe('2025-12-31T23:59:59.000Z');
  });

  it('дата из rich text тоже читается — заголовок и ячейка приходят одним путём', () => {
    expect(cellDate({ richText: [{ text: '20.12.2025' }] })?.toISOString()).toBe(
      '2025-12-20T00:00:00.000Z'
    );
  });
});

describe('cellList — мультиполя («Телефон» с несколькими значениями)', () => {
  it('режет по запятой, точке с запятой и переносу строки', () => {
    expect(cellList('+7 495 111-11-11, +7 495 222-22-22')).toEqual([
      '+7 495 111-11-11',
      '+7 495 222-22-22',
    ]);
    expect(cellList('a@x.ru; b@x.ru')).toEqual(['a@x.ru', 'b@x.ru']);
    expect(cellList('a@x.ru\nb@x.ru')).toEqual(['a@x.ru', 'b@x.ru']);
  });

  it('пустые куски между разделителями выбрасываются', () => {
    expect(cellList(' , ;\n a@x.ru ,,, b@x.ru ;')).toEqual(['a@x.ru', 'b@x.ru']);
  });

  it('пустая ячейка → пустой список', () => {
    expect(cellList('')).toEqual([]);
    expect(cellList(null)).toEqual([]);
  });
});

describe('cellFlag — «да/нет» словами', () => {
  it('Y, Да, yes, true и 1 — это «да», регистр не важен', () => {
    expect(cellFlag('Y')).toBe(true);
    expect(cellFlag('y')).toBe(true);
    expect(cellFlag('Да')).toBe(true);
    expect(cellFlag('ДА')).toBe(true);
    expect(cellFlag('Yes')).toBe(true);
    expect(cellFlag('TRUE')).toBe(true);
    expect(cellFlag('1')).toBe(true);
    expect(cellFlag(1)).toBe(true);
  });

  it('Нет, N, произвольный текст и пустая ячейка — это «нет»', () => {
    expect(cellFlag('Нет')).toBe(false);
    expect(cellFlag('N')).toBe(false);
    expect(cellFlag('не знаю')).toBe(false);
    expect(cellFlag('')).toBe(false);
    expect(cellFlag(null)).toBe(false);
    expect(cellFlag(0)).toBe(false);
  });
});

describe('cellMoney — сумма сделки', () => {
  it('целое число остаётся как есть', () => {
    expect(cellMoney('120000')).toBe('120000');
    expect(cellMoney(120000)).toBe('120000');
  });

  it('пробелы-разряды и запятая-дробная часть нормализуются', () => {
    expect(cellMoney('120 000,00')).toBe('120000');
    expect(cellMoney('45000,5')).toBe('45000.5');
  });

  it('точка как дробная часть остаётся точкой, хвостовые нули срезаются', () => {
    expect(cellMoney('120000.00')).toBe('120000');
  });

  it('валюта после «|» отбрасывается — это формат выгрузки «сумма|валюта»', () => {
    expect(cellMoney('120000|RUB')).toBe('120000');
  });

  it('подпись валюты словами не мешает (точка из «руб.» не считается дробной)', () => {
    expect(cellMoney('45 000 руб.')).toBe('45000');
  });

  it('оба знака сразу: первый — разряды, второй — дробная часть', () => {
    expect(cellMoney('1,234.56')).toBe('1234.56');
    expect(cellMoney('1.234,56')).toBe('1234.56');
  });

  it('отрицательная сумма сохраняет знак', () => {
    expect(cellMoney('-1 500,50')).toBe('-1500.5');
  });

  it('пустая ячейка и строка без цифр → null («суммы нет»)', () => {
    expect(cellMoney('')).toBeNull();
    expect(cellMoney(null)).toBeNull();
    expect(cellMoney('—')).toBeNull();
  });

  it('не разобралось в число → исходный кусок до «|», чтобы это было видно в предпросмотре', () => {
    // «1-2-3» переживает чистку символов, но Number даёт NaN — возвращаем как было.
    expect(cellMoney('1-2-3')).toBe('1-2-3');
    expect(cellMoney('  1-2-3 |RUB')).toBe('1-2-3');
  });
});
