import { describe, it, expect } from 'vitest';
import { normalizeLabel } from '@/lib/services/import/normalize';

/**
 * Т-8: пять способов, которыми реальная шапка 1С ломает точное сравнение
 * (§1 П-7 ТЗ). Каждый гасится нормализацией.
 */
describe('normalizeLabel', () => {
  it('неразрывный пробел становится обычным', () => {
    expect(normalizeLabel('ИНН партнёра')).toBe('инн партнера');
  });

  it('«ё» приводится к «е»', () => {
    expect(normalizeLabel('ИНН партнёра')).toBe(normalizeLabel('ИНН партнера'));
  });

  it('регистр не значим', () => {
    expect(normalizeLabel('НАИМЕНОВАНИЕ')).toBe('наименование');
  });

  it('двойные пробелы схлопываются, края обрезаются', () => {
    expect(normalizeLabel('  Номер   документа ')).toBe('номер документа');
  });

  it('перенос строки внутри ячейки шапки становится пробелом', () => {
    expect(normalizeLabel('Номер\nдокумента')).toBe('номер документа');
    expect(normalizeLabel('Номер\r\nдокумента')).toBe('номер документа');
  });

  it('пустая строка остаётся пустой', () => {
    expect(normalizeLabel('   ')).toBe('');
  });
});
