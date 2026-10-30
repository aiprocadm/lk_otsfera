import { describe, it, expect } from 'vitest';
import { documentDownloadName, documentTypeLabelRu } from '@/lib/documents/fileName';

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

  /**
   * Прогон сопровождения №36 (спека 2026-09-23-moscow-time-in-server-code-design,
   * группа Е): дата в имени — московская. `createdAt` пишет база моментом
   * выпуска; прежний `toLocaleDateString('ru-RU')` без пояса брал день
   * процесса (UTC), и счёт, выпущенный ночью по Москве, назывался вчерашним.
   */
  it('документ, выпущенный в 01:30 по Москве, называется сегодняшним московским числом', () => {
    // 22:30 UTC 31 августа — в Москве уже 1 сентября.
    expect(documentDownloadName({ ...DOC, createdAt: new Date('2026-08-31T22:30:00Z') })).toBe(
      'Счёт С-2026-7 от 01.09.2026.pdf'
    );
  });

  it('документ, выпущенный в 23:30 по Москве (20:30 UTC), — ещё тем же днём', () => {
    expect(documentDownloadName({ ...DOC, createdAt: new Date('2026-08-31T20:30:00Z') })).toBe(
      'Счёт С-2026-7 от 31.08.2026.pdf'
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

// `У-328`: тип документа в таблицах карточки организации — по-русски.
describe('documentTypeLabelRu', () => {
  it('подписывает все типы, включая отчёт и комиссионный отчёт', () => {
    expect(documentTypeLabelRu('invoice')).toBe('Счёт');
    expect(documentTypeLabelRu('report')).toBe('Отчёт');
    expect(documentTypeLabelRu('commission_statement')).toBe('Комиссионный отчёт');
  });
  it('незнакомый тип — «Документ», а не код', () => {
    expect(documentTypeLabelRu('mystery')).toBe('Документ');
  });
});
