import { describe, it, expect } from 'vitest';
import { unmatchedHeadersOf } from '@/lib/services/import/diagnostics';

/**
 * Этап 1 ТЗ починки импорта 1С (Т-3): список заголовков, которых нет в карте
 * колонок. Это и есть половина ответа на вопрос «почему файл не прочитался» —
 * оператор видит, как колонка называется в его выгрузке на самом деле.
 */
const COLS = { name: ['Наименование'], inn: ['ИНН', 'ИНН контрагента'] };

describe('unmatchedHeadersOf', () => {
  it('заголовки из карты в список не попадают', () => {
    expect(unmatchedHeadersOf(['Наименование', 'ИНН'], COLS)).toEqual([]);
  });

  it('чужой заголовок попадает в список', () => {
    expect(unmatchedHeadersOf(['Наименование', 'КПП', 'ИНН', 'Адрес'], COLS)).toEqual([
      'КПП',
      'Адрес',
    ]);
  });

  it('пустые ячейки шапки игнорируются — это не «нераспознанный заголовок»', () => {
    expect(unmatchedHeadersOf(['Наименование', '', '   ', 'КПП'], COLS)).toEqual(['КПП']);
  });

  it('повтор заголовка показывается один раз', () => {
    expect(unmatchedHeadersOf(['КПП', 'КПП'], COLS)).toEqual(['КПП']);
  });

  it('порядок сохраняется — оператор сверяет со своей шапкой слева направо', () => {
    expect(unmatchedHeadersOf(['Б', 'А', 'В'], COLS)).toEqual(['Б', 'А', 'В']);
  });

  it('пустая шапка даёт пустой список, а не падение', () => {
    expect(unmatchedHeadersOf([], COLS)).toEqual([]);
  });

  it('с этапа 3 сравнение нормализованное (Т-8): регистр, «ё/е», лишние пробелы', () => {
    expect(unmatchedHeadersOf(['ИНН '], COLS)).toEqual([]);
    expect(unmatchedHeadersOf(['инн'], COLS)).toEqual([]);
    expect(unmatchedHeadersOf(['НАИМЕНОВАНИЕ'], COLS)).toEqual([]);
    // Неразрывный пробел и перенос строки внутри ячейки шапки.
    expect(unmatchedHeadersOf(['ИНН\u00A0контрагента'], COLS)).toEqual([]);
    expect(unmatchedHeadersOf(['ИНН\nконтрагента'], COLS)).toEqual([]);
    // «И Н Н» с пробелами внутри слова — всё ещё чужой заголовок.
    expect(unmatchedHeadersOf(['И Н Н'], COLS)).toEqual(['И Н Н']);
  });

  it('«ё» и «е» считаются одной буквой', () => {
    expect(unmatchedHeadersOf(['ИНН партнера'], { partnerInn: ['ИНН партнёра'] })).toEqual([]);
  });

  it('алиас из хвоста массива распознаётся так же, как основной', () => {
    expect(unmatchedHeadersOf(['ИНН контрагента'], COLS)).toEqual([]);
  });
});
