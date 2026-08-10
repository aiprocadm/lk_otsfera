import { describe, it, expect } from 'vitest';
import {
  parseRusDate,
  parseAmount,
  extractDocNumber,
  extractAccountCandidates,
  extractCounterparty,
  extractInn,
  extractVat,
} from '@/lib/services/import/oneCAccountCard/extractors';

describe('parseRusDate', () => {
  it('parses ДД.ММ.ГГГГ to ISO', () => {
    expect(parseRusDate('01.06.2026')).toBe('2026-06-01T00:00:00.000Z');
  });
  it('returns null on garbage', () => {
    expect(parseRusDate('—')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('parses plain integer', () => {
    expect(parseAmount('14800')).toBe(14800);
  });
  it('parses decimal with dot', () => {
    expect(parseAmount('2600.1')).toBe(2600.1);
  });
  it('tolerates spaces and comma decimal', () => {
    expect(parseAmount('1 200,50')).toBe(1200.5);
  });
  it('returns null when empty', () => {
    expect(parseAmount('')).toBeNull();
  });
});

describe('extractDocNumber', () => {
  it('pulls 1C doc number from line 1', () => {
    expect(
      extractDocNumber('Поступление на расчетный счет 0000-001471 от 01.06.2026 17:00:00')
    ).toBe('0000-001471');
  });
  it('handles Списание', () => {
    expect(extractDocNumber('Списание с расчетного счета 0000-000777 от 02.06.2026 10:00:00')).toBe(
      '0000-000777'
    );
  });

  // Жалоба пользователя 10.08.2026: в его базе номера с буквенным префиксом,
  // и единственный прежний шаблон «цифры-дефис-цифры» не находил НИ ОДНОГО —
  // весь файл уходил в «ошибки разбора».
  it('номера с буквами и без дефиса: БП-000123, ПП00-45, просто 15', () => {
    expect(extractDocNumber('Поступление на расчетный счет БП-000123 от 01.06.2026 10:15:00')).toBe(
      'БП-000123'
    );
    expect(extractDocNumber('Поступление на расчетный счет ПП00-45 от 01.06.2026')).toBe('ПП00-45');
    expect(extractDocNumber('Списание с расчетного счета 15 от 03.06.2026 12:00:00')).toBe('15');
  });

  it('номер после «№», когда даты в строке нет', () => {
    expect(extractDocNumber('Платёжное поручение № 4417')).toBe('4417');
  });

  it('без цифр номера нет: слово из названия документа за номер не принимаем', () => {
    expect(extractDocNumber('Поступление на расчетный счет б/н от 01.06.2026')).toBeNull();
    expect(extractDocNumber('Инкассовое поручение № б/н')).toBeNull();
    expect(extractDocNumber('')).toBeNull();
  });
});

describe('extractAccountCandidates', () => {
  it('extracts all distinct invoice-number candidates', () => {
    const text = 'Оплата по счету № 260509-1905 и СОГЛАСНО СЧЕТА 260424РД';
    expect(extractAccountCandidates(text)).toEqual(['260509-1905', '260424РД']);
  });
  it('handles abbreviated and suffixed forms', () => {
    expect(extractAccountCandidates('по сч № 260125-2605, счет № 251221А-6')).toEqual([
      '260125-2605',
      '251221А-6',
    ]);
  });
  it('returns empty array when none', () => {
    expect(extractAccountCandidates('Перевод собственных средств')).toEqual([]);
  });
});

describe('extractCounterparty', () => {
  it('takes the first line of col[3]', () => {
    expect(extractCounterparty('ХОЛДИНГ ГЕФЕСТ ООО\nДоговор № 5')).toBe('ХОЛДИНГ ГЕФЕСТ ООО');
  });
  it('strips trailing ИНН from the name', () => {
    expect(extractCounterparty('РОМАШКА ООО ИНН 9909676723')).toBe('РОМАШКА ООО');
  });
});

describe('extractInn', () => {
  it('finds INN near the marker', () => {
    expect(extractInn('РОМАШКА ООО ИНН 9909676723')).toBe('9909676723');
  });
  it('returns null when absent', () => {
    expect(extractInn('ХОЛДИНГ ГЕФЕСТ ООО')).toBeNull();
  });
});

describe('extractVat', () => {
  it('parses "В Т.Ч. НДС (5%) 704-75"', () => {
    expect(extractVat('Оплата 14800 В Т.Ч. НДС (5%) 704-75', 14800)).toBe(704.75);
  });
  it('parses "НДС 5 % - 3451.43 рублей"', () => {
    expect(extractVat('сумма НДС 5 % - 3451.43 рублей', 100000)).toBe(3451.43);
  });
  it('"НДС не облагается" → 0', () => {
    expect(extractVat('НДС не облагается', 5000)).toBe(0);
  });
  it('rate only → computed from amount', () => {
    // 20% включённого НДС от 12000 = 2000
    expect(extractVat('в том числе НДС 20%', 12000)).toBeCloseTo(2000, 2);
  });
  it('no VAT info → null', () => {
    expect(extractVat('Оплата по договору', 5000)).toBeNull();
  });
});
