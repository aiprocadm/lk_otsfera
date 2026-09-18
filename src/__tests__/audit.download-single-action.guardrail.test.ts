import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { AUDIT_ACTIONS } from '@/lib/auth/audit';

/**
 * СТРАЖ `У-254` (`Р-Э8-1`): у скачивания документа ОДНО имя события.
 *
 * Пакет требований предлагал завести событие `document_downloaded`. В коде уже
 * писалось `document_download_signed_url` — во всех трёх дверях выдачи ссылки.
 * Завести рядом второе имя значило бы разрезать журнал надвое: половина
 * скачиваний под одним словом, половина под другим, и ответ на вопрос «кто
 * скачивал» стал бы неполным — причём молча, без единой ошибки.
 *
 * Поэтому проверяются две вещи разом: второго имени нет, а единственное
 * имеющееся пишут все три двери и пишут ПОЛНО — с ролью читателя и версией
 * файла. Без роли журнал не отвечает «кто», без версии — «что именно унесли».
 *
 * Мутация (проверено): добавить `document_downloaded` в `AUDIT_ACTIONS` →
 * «второго имени нет» краснеет; убрать `version` из `after` одного роута →
 * «все три двери пишут роль и версию» краснеет; заменить `session.role` на
 * строку `'manager'` → «роль берётся из сессии» краснеет.
 */
const SRC = join(process.cwd(), 'src');

const ROUTES = [
  'app/api/documents/[id]/download/route.ts',
  'app/api/manager/documents/[id]/download/route.ts',
  'app/api/organization/documents/[id]/download/route.ts',
];

const ACTION = 'document_download_signed_url';

describe('страж: скачивание документа пишется одним событием (У-254, Р-Э8-1)', () => {
  it('второго имени для того же факта в справочнике нет', () => {
    expect(AUDIT_ACTIONS).toContain(ACTION);
    expect(
      AUDIT_ACTIONS as readonly string[],
      'журнал скачиваний разрезан надвое: появилось второе имя события'
    ).not.toContain('document_downloaded');
  });

  it('все три двери выдачи ссылки пишут роль читателя и версию', () => {
    for (const rel of ROUTES) {
      const source = readSource(join(SRC, rel));
      expect(source, `${rel}: дверь перестала писать событие скачивания`).toContain(
        `action: '${ACTION}'`
      );
      expect(source, `${rel}: в журнал не попадает роль читателя`).toMatch(
        /after:\s*\{[^}]*viewer:/
      );
      expect(source, `${rel}: в журнал не попадает версия документа`).toMatch(
        /after:\s*\{[^}]*version:/
      );
    }
  });

  it('роль берётся из сессии, а не вписывается строкой', () => {
    // Кабинет менеджера открыт и руководителю: вписанное словом «manager»
    // означало бы, что журнал врёт про каждое скачивание руководителя.
    for (const rel of ROUTES) {
      const source = readSource(join(SRC, rel));
      expect(source, `${rel}: роль читателя снова вписана строкой`).not.toMatch(
        /viewer:\s*'(manager|leader|admin|organization|partner)'/
      );
    }
  });

  it('версия попадает в журнал из выборки документа, а не угадывается', () => {
    // Три резолвера скачивания обязаны отдать версию наружу — иначе роуту
    // неоткуда её взять, и «версия» в журнале станет константой.
    const resolvers = [
      'lib/services/documents/download.ts',
      'lib/services/manager/documents.ts',
      'lib/services/organization/documents.ts',
    ];
    for (const rel of resolvers) {
      expect(readSource(join(SRC, rel)), `${rel}: резолвер не отдаёт версию`).toMatch(
        /version:\s*doc\.version/
      );
    }
  });
});
