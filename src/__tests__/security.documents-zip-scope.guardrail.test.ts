import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ `У-252` (`Р-Э8-3`): архив собирается тем же правилом доступа, что и
 * одиночное скачивание.
 *
 * Соблазн написать «свой» `where` по ролям в сборке архива велик: один запрос
 * вместо проверки по каждому документу — быстрее и короче. Цена — второй набор
 * правил доступа, который разъедется с первым на первой же правке, и разъедется
 * **молча**: архив просто окажется полнее, чем должен, а заметит это тот, кому
 * чужая бумага попадёт в руки.
 *
 * Поэтому страж требует трёх вещей от `services/documents/zip.ts`:
 *  1. гейт `canReadDocument` вызывается ВНУТРИ обхода документов;
 *  2. выборка не фильтруется по ролям сама (`where` только по списку id);
 *  3. в архив попадает только проверенный антивирусом файл (`clean`).
 *
 * Мутация (проверено, четыре поломки): убрать вызов гейта из цикла → «гейт
 * стоит в обходе» краснеет; добавить в `where` фильтр по компании → «выборка не
 * решает за гейт» краснеет; впустить непроверенный файл → «в архив идёт только
 * проверенный файл» краснеет; убрать предел по числу файлов до выборки →
 * «предел проверяется до базы» краснеет.
 */
const SRC = join(process.cwd(), 'src');
const ZIP = readSource(join(SRC, 'lib/services/documents/zip.ts'));

describe('страж: архив проверяет каждый документ тем же гейтом (У-252, Р-Э8-3)', () => {
  it('гейт чтения стоит в обходе документов, а не где-то рядом', () => {
    expect(ZIP, 'сборка архива больше не спрашивает гейт чтения').toContain('canReadDocument(');
    // Вызов обязан стоять внутри `for (const doc of rows)`: снаружи он проверил
    // бы один документ, а в архив уехали бы все.
    const loop = ZIP.indexOf('for (const doc of rows)');
    expect(loop, 'обход документов исчез — проверять стало нечего').toBeGreaterThan(-1);
    const gate = ZIP.indexOf('canReadDocument(', loop);
    expect(gate, 'гейт чтения уехал из обхода документов').toBeGreaterThan(loop);
    // И до конца этого цикла: следующий блок начинается с `if (allowed.length`.
    const afterLoop = ZIP.indexOf('if (allowed.length', loop);
    expect(gate, 'гейт чтения стоит уже после обхода').toBeLessThan(afterLoop);
  });

  it('выборка не решает за гейт: `where` только по списку идентификаторов', () => {
    const start = ZIP.indexOf('prisma.document.findMany(');
    expect(start, 'выборка документов исчезла').toBeGreaterThan(-1);
    const whereStart = ZIP.indexOf('where:', start);
    const selectStart = ZIP.indexOf('select:', start);
    const where = ZIP.slice(whereStart, selectStart);

    expect(where, 'выборка потеряла ограничение по списку id').toContain('id: { in: ids }');
    for (const forbidden of ['companyId', 'counterpartyId', 'counterpartyType', 'organizationId']) {
      expect(
        where,
        `в выборке архива появился свой фильтр доступа (${forbidden}) — второй набор правил`
      ).not.toContain(forbidden);
    }
  });

  it('в архив идёт только проверенный антивирусом файл', () => {
    // «Не заражён» и «проверен» — разные вещи: `pending` означает, что ClamAV
    // ещё не смотрел файл, и класть его в архив рано.
    expect(ZIP, 'исчезла проверка «файл проверен антивирусом»').toContain(
      "doc.scanStatus !== 'clean'"
    );
    expect(ZIP, 'заражённый файл перестал считаться отдельно').toContain(
      "doc.scanStatus === 'infected'"
    );
  });

  it('предел по числу файлов проверяется до обращения к базе и хранилищу', () => {
    const limit = ZIP.indexOf('ZIP_MAX_FILES)');
    const query = ZIP.indexOf('prisma.document.findMany(');
    expect(limit, 'предел по числу файлов исчез').toBeGreaterThan(-1);
    expect(
      limit,
      'предел проверяется после выборки — значит, полгигабайта скачают ради отказа'
    ).toBeLessThan(query);
  });

  it('чужой документ не отличается от несуществующего', () => {
    // Оба случая увеличивают один счётчик: иначе по коду ответа перебором
    // выяснялось бы, какие документы у соседей есть.
    expect(ZIP).toContain('skipped.noAccess');
    expect(ZIP, 'у архива появился отдельный ответ «такого документа нет»').not.toContain(
      "error: 'not_found'"
    );
  });
});
