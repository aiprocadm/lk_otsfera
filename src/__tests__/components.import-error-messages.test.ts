import { describe, it, expect } from 'vitest';
import {
  IMPORT_ERROR_CODES,
  XLSX_IMPORT_ERRORS,
  PAYMENT_IMPORT_ERRORS,
  errorMessage,
  fileSizeMb,
} from '@/components/import/error-messages';
import { IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';

/**
 * Т-7: у каждого кода ошибки есть человеческий русский текст. Без этого теста
 * новый код в сервисе доезжает до пользователя в виде «Ошибка: parse_failed».
 */
const CYRILLIC = /[А-Яа-яЁё]/;

describe('тексты ошибок импорта', () => {
  for (const [name, map] of [
    ['Загрузка Excel', XLSX_IMPORT_ERRORS],
    ['Импорт выписки', PAYMENT_IMPORT_ERRORS],
  ] as const) {
    it(`${name}: текст есть у каждого кода и он на русском`, () => {
      for (const code of IMPORT_ERROR_CODES) {
        const text = map[code];
        expect(text, code).toBeTruthy();
        expect(text, code).toMatch(CYRILLIC);
      }
    });
  }

  it('предел размера в текстах берётся из константы, а не написан руками', () => {
    expect(XLSX_IMPORT_ERRORS.file_too_large).toContain(`${IMPORT_MAX_FILE_MB} МБ`);
    expect(PAYMENT_IMPORT_ERRORS.invalid_file).toContain(`${IMPORT_MAX_FILE_MB} МБ`);
    expect(XLSX_IMPORT_ERRORS.network_or_server).toContain(`${IMPORT_MAX_FILE_MB} МБ`);
  });

  it('подсказки про формат у форм разные: одна ждёт только .xlsx', () => {
    expect(XLSX_IMPORT_ERRORS.invalid_file).not.toContain('.xls ');
    expect(PAYMENT_IMPORT_ERRORS.invalid_file).toContain('.xls или .xlsx');
  });

  it('неизвестный код показывается как есть, а не проглатывается', () => {
    expect(errorMessage(XLSX_IMPORT_ERRORS, 'never_seen')).toBe('Ошибка: never_seen');
  });

  it('известный код берётся из карты', () => {
    expect(errorMessage(XLSX_IMPORT_ERRORS, 'forbidden')).toBe('Недостаточно прав');
  });
});

describe('fileSizeMb', () => {
  it('показывает мегабайты с одним знаком и запятой', () => {
    expect(fileSizeMb(34 * 1024 * 1024)).toBe('34,0');
    expect(fileSizeMb(1_500_000)).toBe('1,4');
  });
});
