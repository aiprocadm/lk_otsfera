import { describe, it, expect } from 'vitest';
import { documentDownloadName } from '@/lib/documents/fileName';

/**
 * `У-154` — имя файла при скачивании. Проверяем не «функция вернула строку»,
 * а те случаи, где легко испортить: документ без номера, чужое расширение и
 * символы, которые файловая система не принимает.
 */
const DOC = {
  type: 'invoice',
  number: 'С-2026-7',
  createdAt: new Date('2026-07-26T00:00:00Z'),
  name: 'С-2026-7.pdf',
};

describe('documentDownloadName', () => {
  it('выпущенный документ называется по-человечески', () => {
    expect(documentDownloadName(DOC)).toBe('Счёт С-2026-7 от 26.07.2026.pdf');
    expect(documentDownloadName({ ...DOC, type: 'act', number: 'А-2026-7' })).toBe(
      'Акт А-2026-7 от 26.07.2026.pdf'
    );
    expect(documentDownloadName({ ...DOC, type: 'extra_agreement', number: 'ДС-2026-1' })).toBe(
      'Доп. соглашение ДС-2026-1 от 26.07.2026.pdf'
    );
  });

  it('загруженный вручную файл сохраняет своё имя', () => {
    // Номера у него нет, и выдумывать название хуже, чем оставить как есть.
    expect(documentDownloadName({ ...DOC, number: null, name: 'скан паспорта.jpg' })).toBe(
      'скан паспорта.jpg'
    );
  });

  it('расширение берётся у файла, а не у типа документа', () => {
    expect(documentDownloadName({ ...DOC, name: 'invoice-v1.xlsx' })).toBe(
      'Счёт С-2026-7 от 26.07.2026.xlsx'
    );
    // Файл без расширения — по умолчанию PDF (так их генерирует система).
    expect(documentDownloadName({ ...DOC, name: 'invoice-v1' })).toBe(
      'Счёт С-2026-7 от 26.07.2026.pdf'
    );
    // Точка в начале — не расширение, а скрытый файл.
    expect(documentDownloadName({ ...DOC, name: '.gitignore' })).toBe(
      'Счёт С-2026-7 от 26.07.2026.pdf'
    );
  });

  it('символы, запрещённые в именах файлов, заменяются', () => {
    // Номер приходит из настроек нумерации компании — там может оказаться
    // что угодно, вплоть до «/» из «12/2026».
    expect(documentDownloadName({ ...DOC, number: '12/2026' })).toBe(
      'Счёт 12_2026 от 26.07.2026.pdf'
    );
  });

  it('незнакомый тип документа не ломает имя', () => {
    expect(documentDownloadName({ ...DOC, type: 'unknown_kind' })).toBe(
      'Документ С-2026-7 от 26.07.2026.pdf'
    );
  });
});
