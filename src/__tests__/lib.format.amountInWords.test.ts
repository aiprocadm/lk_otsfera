import { describe, it, expect } from 'vitest';
import { amountInWords, integerToWords, pluralForm } from '@/lib/format/amountInWords';

/**
 * `У-141` — сумма прописью в счетах и актах.
 *
 * Место, где ошибка стоит дороже всего: счёт с неверной суммой прописью
 * бухгалтерия не примет. Поэтому проверяем не «работает вообще», а именно
 * те места, где русское склонение подводит: 11–14, окончания на 1 и 2,
 * женский род тысяч, копейки после точки.
 */
describe('склонение', () => {
  it('одиннадцать–четырнадцать — «многие», хотя оканчиваются на 1–4', () => {
    const rub = ['рубль', 'рубля', 'рублей'] as const;
    expect(pluralForm(11, rub)).toBe('рублей');
    expect(pluralForm(12, rub)).toBe('рублей');
    expect(pluralForm(14, rub)).toBe('рублей');
    // А 111 и 112 — по тому же правилу (последние две цифры).
    expect(pluralForm(111, rub)).toBe('рублей');
  });

  it('обычные окончания: 1 → рубль, 2–4 → рубля, 5–0 → рублей', () => {
    const rub = ['рубль', 'рубля', 'рублей'] as const;
    expect(pluralForm(1, rub)).toBe('рубль');
    expect(pluralForm(21, rub)).toBe('рубль');
    expect(pluralForm(3, rub)).toBe('рубля');
    expect(pluralForm(24, rub)).toBe('рубля');
    expect(pluralForm(5, rub)).toBe('рублей');
    expect(pluralForm(20, rub)).toBe('рублей');
    expect(pluralForm(0, rub)).toBe('рублей');
  });
});

describe('целое число словами', () => {
  it('ноль так и остаётся нулём', () => {
    expect(integerToWords(0)).toBe('ноль');
  });

  it('тысячи — женского рода: «одна тысяча», «две тысячи»', () => {
    // Классическая ошибка бланка: «один тысяча» или «два тысячи».
    expect(integerToWords(1000)).toBe('одна тысяча');
    expect(integerToWords(2000)).toBe('две тысячи');
    expect(integerToWords(5000)).toBe('пять тысяч');
    expect(integerToWords(21_000)).toBe('двадцать одна тысяча');
  });

  it('единицы — мужского рода (род задаёт валюта)', () => {
    expect(integerToWords(1)).toBe('один');
    expect(integerToWords(2)).toBe('два');
    expect(integerToWords(1002)).toBe('одна тысяча два');
  });

  it('сотни, десятки и подростковые числа', () => {
    expect(integerToWords(19)).toBe('девятнадцать');
    expect(integerToWords(115)).toBe('сто пятнадцать');
    expect(integerToWords(999)).toBe('девятьсот девяносто девять');
  });

  it('миллионы и миллиарды со своим склонением', () => {
    expect(integerToWords(1_000_000)).toBe('один миллион');
    expect(integerToWords(2_000_000)).toBe('два миллиона');
    expect(integerToWords(5_000_000)).toBe('пять миллионов');
    expect(integerToWords(1_000_000_000)).toBe('один миллиард');
  });

  it('пропускает пустые разряды: 1 000 007 — без «нуль тысяч»', () => {
    expect(integerToWords(1_000_007)).toBe('один миллион семь');
  });
});

describe('сумма прописью', () => {
  it('обычный счёт: «Двенадцать тысяч рублей 00 копеек»', () => {
    expect(amountInWords('12000.00')).toBe('Двенадцать тысяч рублей 00 копеек');
  });

  it('копейки цифрами и со своим склонением', () => {
    expect(amountInWords('1.01')).toBe('Один рубль 01 копейка');
    expect(amountInWords('2.02')).toBe('Два рубля 02 копейки');
    expect(amountInWords('3.05')).toBe('Три рубля 05 копеек');
    expect(amountInWords('4.11')).toBe('Четыре рубля 11 копеек');
  });

  it('«12.5» — это пятьдесят копеек, а не пять', () => {
    // Дополняем дробную часть СПРАВА: иначе счёт на 12,50 напечатался бы
    // как «05 копеек» — расхождение с цифрой в той же строке.
    expect(amountInWords('12.5')).toBe('Двенадцать рублей 50 копеек');
  });

  it('целое без дробной части и ноль', () => {
    expect(amountInWords('100')).toBe('Сто рублей 00 копеек');
    expect(amountInWords('0.00')).toBe('Ноль рублей 00 копеек');
  });

  it('запятая как разделитель — обычный человеческий ввод', () => {
    expect(amountInWords('4500,50')).toBe('Четыре тысячи пятьсот рублей 50 копеек');
  });

  it('число на входе тоже принимается', () => {
    expect(amountInWords(4500.5)).toBe('Четыре тысячи пятьсот рублей 50 копеек');
  });

  it('отрицательная сумма помечается словом, а не молча теряет знак', () => {
    expect(amountInWords('-500.00')).toBe('минус Пятьсот рублей 00 копеек');
  });

  it('первая буква заглавная — как в бухгалтерском бланке', () => {
    expect(amountInWords('5000.00').startsWith('Пять')).toBe(true);
  });
});
