import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ `У-251` (`Р-Э8-5`): цепочка версий документа не ветвится и не рвётся.
 *
 * Механизм замены файла держится на трёх вещах одновременно:
 *  1. новая строка ссылается на прежнюю (`replacesDocumentId`);
 *  2. прежняя помечается заменённой (`supersededAt`);
 *  3. обе записи делаются ОДНОЙ транзакцией.
 *
 * Выпадение любой из трёх ломается молча. Забыли `supersededAt` — у
 * контрагента в списке две действующие версии одного счёта, и какая из них
 * настоящая, не скажет никто. Разнесли записи по двум запросам — сбой между
 * ними оставляет клиента без действующего документа вовсе. Завели вторую точку
 * записи `replacesDocumentId` — два набора правил замены, которые придётся
 * держать в согласии вечно (ровно от этого отказались решением `Р-Э8-5`).
 *
 * Поэтому страж следит за ЕДИНСТВЕННОСТЬЮ точки записи и за тем, что в ней
 * есть все три составляющие.
 *
 * Мутация (проверено, четыре поломки): убрать `$transaction` из
 * `upload-core.ts` → «обе записи в одной транзакции» краснеет; убрать
 * `supersededAt` → «прежняя версия помечается заменённой» краснеет; дописать
 * `replacesDocumentId` в `data` другого сервиса → «точка записи одна»
 * краснеет; убрать `resolveReplaces` из ОДНОЙ из двух веток канала → «ветка
 * записи без правила замены» краснеет. Последнюю поломку первая редакция
 * стража пропускала: она проверяла «встречается ли слово в файле», а слово
 * оставалось во второй ветке.
 */
const SRC = join(process.cwd(), 'src');

/**
 * Файлы, которым разрешено писать ссылку на прежнюю версию.
 *
 * `upload-core.ts` — загрузка новой версии ЗАГРУЖЕННОГО файла (`У-251`);
 * `generate.ts` — перевыпуск выпущенной в ЛК бумаги (`У-151`);
 * `numberingMaintenance.ts` — починка осиротевшей ссылки (обнуляет её, когда
 * прежнего документа в базе уже нет). Три разных случая, у каждого своя
 * дверь — и четвёртой быть не должно.
 */
const WRITERS = [
  'lib/services/documents/generate.ts',
  'lib/services/documents/numberingMaintenance.ts',
  'lib/services/documents/upload-core.ts',
];

function prodFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      out.push(relative(SRC, p).split('\\').join('/'));
    }
  };
  walk(SRC);
  return out;
}

/**
 * Пишет ли файл ссылку в базу.
 *
 * Отличить запись от чтения по тексту можно только аккуратно: `: true` —
 * выборка, `z.` — поле формы роута, `where` — условие поиска, `===` — разбор
 * пришедшей строки, `string` — объявление типа. Всё остальное с двоеточием —
 * присвоение значения; плюс сырое `SET` для тех мест, где Prisma не годится.
 */
function writesReplacesLink(source: string): boolean {
  if (/SET "replacesDocumentId"/.test(source)) return true;
  return source
    .split('\n')
    .some(
      (line) =>
        /replacesDocumentId:\s*\S/.test(line) &&
        !/replacesDocumentId:\s*(true|string|z\.)/.test(line) &&
        !line.includes('where') &&
        !line.includes('===')
    );
}

describe('страж: цепочка версий документа одна (У-251, Р-Э8-5)', () => {
  const files = prodFiles();

  it('обход исходников не сломан', () => {
    // Страж, которому нечего проверять, зелен не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(500);
  });

  it('точка записи ссылки на прежнюю версию одна', () => {
    const writers = files.filter((rel) => writesReplacesLink(readSource(join(SRC, rel))));
    expect(
      writers.sort(),
      'появилась новая точка записи `replacesDocumentId` — правила замены разъедутся'
    ).toEqual([...WRITERS].sort());
  });

  it('прежняя версия помечается заменённой в той же транзакции', () => {
    const core = readSource(join(SRC, 'lib/services/documents/upload-core.ts'));
    expect(core, 'обе записи больше не в одной транзакции').toContain('$transaction');
    expect(core, 'прежняя версия перестала помечаться заменённой').toContain('supersededAt');
    // Пометка обязана стоять ВНУТРИ транзакции, а не рядом с ней: снаружи она
    // переживёт откат создания и оставит контрагента без документа.
    const tx = core.slice(core.indexOf('$transaction'));
    expect(tx.indexOf('supersededAt'), 'пометка уехала из транзакции').toBeGreaterThan(-1);
  });

  it('проверки замены живут в одном месте и зовутся всеми каналами загрузки', () => {
    const versions = readSource(join(SRC, 'lib/services/documents/versions.ts'));
    expect(versions).toContain('canReadDocument');
    expect(versions, 'исчезла проверка «документ уже заменён»').toContain('already_superseded');
    expect(versions, 'исчезла проверка «документ выпущен в ЛК»').toContain('generated_document');

    // Каналы загрузки обязаны спросить одну и ту же функцию, иначе через
    // забытый канал версия подменится без проверок. Считаем ВЫЗОВЫ, а не
    // «встречается ли слово»: у трёх каналов по две ветки (с заказом и без),
    // и потерять проверку в одной из них — самый вероятный вид регресса.
    const channels = [
      'lib/services/manager/uploads.ts',
      'lib/services/organization/documentUpload.ts',
      'lib/services/partner/documentUpload.ts',
      'lib/services/documents/adminUpload.ts',
    ];
    for (const rel of channels) {
      const source = readSource(join(SRC, rel));
      const persists = source.match(/persistUploadedDocument\(/g)?.length ?? 0;
      const checks = source.match(/resolveReplaces\(/g)?.length ?? 0;
      expect(persists, `${rel}: в канале не нашлось ни одной записи документа`).toBeGreaterThan(0);
      expect(checks, `${rel}: ветка записи без правила замены`).toBe(persists);
    }
  });
});
