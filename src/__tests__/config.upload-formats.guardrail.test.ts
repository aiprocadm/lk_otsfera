import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from '@/lib/config/upload';

/**
 * Единый список форматов документа (§13 ТЗ, §12b CLAUDE.md).
 *
 * `lib/config/upload` называет себя «единым allow-list», но копия списка жила
 * ещё и в роуте админ-панели — и они разъехались: общий список принимал
 * `.xls`, а роут молча отвергал; `.zip` работал только в роуте. Один и тот же
 * файл получал разный ответ в зависимости от кабинета, и заметить это можно
 * было только жалобой пользователя.
 *
 * Тест держит границу: канальное исключение допустимо, но объявляется явно и
 * ровно одно, а офисные форматы не переписываются заново.
 */
const ROUTE = join(__dirname, '..', 'app', 'api', 'documents', 'upload', 'route.ts');

describe('форматы документов объявлены в одном месте', () => {
  const routeSrc = readFileSync(ROUTE, 'utf8');

  it('роут не заводит свою копию офисных типов', () => {
    // Именно копирование этих длинных строк и привело к расхождению.
    expect(routeSrc, 'в роут вернулась копия списка MIME').not.toMatch(
      /application\/vnd\.(openxmlformats|ms-excel)/
    );
    expect(routeSrc, 'в роут вернулась копия расширений').not.toMatch(/'\.docx?'|'\.xlsx?'/);
  });

  it('роут берёт списки из общего модуля', () => {
    expect(routeSrc).toContain("from '@/lib/config/upload'");
    expect(routeSrc).toContain('DOCUMENT_MIME_TYPES');
    expect(routeSrc).toContain('DOCUMENT_EXTENSIONS');
  });

  it('канальное исключение ровно одно — архив, и оно названо', () => {
    expect(routeSrc).toContain("ARCHIVE_MIME = 'application/zip'");
    // Архив в общий список не просочился: остальные каналы его не принимают.
    expect(ALLOWED_MIME_TYPES.has('application/zip')).toBe(false);
    expect(ALLOWED_EXTENSIONS).not.toContain('.zip');
  });
});

describe('типы и расширения не расходятся между собой', () => {
  it('у каждого разрешённого типа есть расширение и наоборот', () => {
    // Цифры сверяем не «на глаз»: списки выводятся из одной таблицы, поэтому
    // рассинхрон означает, что таблицу разобрали на две.
    expect(ALLOWED_MIME_TYPES.size).toBe(7);
    expect(ALLOWED_EXTENSIONS).toEqual([
      '.pdf',
      '.jpg',
      '.jpeg',
      '.png',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
    ]);
  });

  it('legacy-форматы на месте: их присылают из старых версий Word и Excel', () => {
    expect(ALLOWED_MIME_TYPES.has('application/msword')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('application/vnd.ms-excel')).toBe(true);
    expect(ALLOWED_EXTENSIONS).toContain('.doc');
    expect(ALLOWED_EXTENSIONS).toContain('.xls');
  });

  it('исполняемые и прочие опасные типы не разрешены', () => {
    for (const bad of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'text/x-python']) {
      expect(ALLOWED_MIME_TYPES.has(bad), bad).toBe(false);
    }
  });
});
