import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  suggestScanMatch,
  suggestScanMatches,
} from '@/lib/orders/certificateScanMatch';

/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) — подсказка «файл → слушатель».
 * Ключевое требование ТЗ: это ПОДСКАЗКА. Неоднозначность и промах обязаны
 * оставлять выбор человеку (`suggestedItemId: null`).
 */

const TARGETS = [
  { itemId: 'i1', studentName: 'Иванов Иван Иванович' },
  { itemId: 'i2', studentName: 'Петрова Анна Сергеевна' },
];

describe('normalizeName', () => {
  it('снимает регистр, ё и разделители', () => {
    expect(normalizeName('Артём_Королёв-СКАН.pdf')).toBe('артем королев скан pdf');
  });

  it('схлопывает подряд идущие разделители и края', () => {
    expect(normalizeName('  Иванов___И.И.  ')).toBe('иванов и и');
  });
});

describe('suggestScanMatch', () => {
  it('однозначное совпадение по фамилии → подсказка', () => {
    const m = suggestScanMatch('Иванов_И_И.pdf', TARGETS);
    expect(m).toEqual({ fileName: 'Иванов_И_И.pdf', suggestedItemId: 'i1', ambiguous: false });
  });

  it('фамилия с ё совпадает с написанием через е', () => {
    const m = suggestScanMatch('Королёв.pdf', [{ itemId: 'i9', studentName: 'Королев Пётр' }]);
    expect(m.suggestedItemId).toBe('i9');
  });

  it('нет совпадения → выбор за менеджером', () => {
    const m = suggestScanMatch('скан_1.pdf', TARGETS);
    expect(m).toEqual({ fileName: 'скан_1.pdf', suggestedItemId: null, ambiguous: false });
  });

  it('две однофамилицы → ambiguous, ничего не подставляем', () => {
    const m = suggestScanMatch('Иванов.pdf', [
      { itemId: 'a', studentName: 'Иванов Иван' },
      { itemId: 'b', studentName: 'Иванов Пётр' },
    ]);
    expect(m).toEqual({ fileName: 'Иванов.pdf', suggestedItemId: null, ambiguous: true });
  });

  it('пустое ФИО позиции совпадений не даёт', () => {
    const m = suggestScanMatch('Иванов.pdf', [{ itemId: 'x', studentName: '   ' }]);
    expect(m.suggestedItemId).toBeNull();
  });

  it('односимвольные инициалы не считаются признаком', () => {
    // «И» в имени файла не должно цеплять «И Иванов» — фамилия берётся первым
    // значимым словом, а односимвольные слова отбрасываются.
    const m = suggestScanMatch('И.pdf', [{ itemId: 'x', studentName: 'И Иванов' }]);
    expect(m.suggestedItemId).toBeNull();
  });
});

describe('suggestScanMatches', () => {
  it('сохраняет порядок файлов', () => {
    const res = suggestScanMatches(['Петрова.pdf', 'Иванов.pdf', 'мусор.pdf'], TARGETS);
    expect(res.map((r) => r.suggestedItemId)).toEqual(['i2', 'i1', null]);
    expect(res.map((r) => r.fileName)).toEqual(['Петрова.pdf', 'Иванов.pdf', 'мусор.pdf']);
  });
});
