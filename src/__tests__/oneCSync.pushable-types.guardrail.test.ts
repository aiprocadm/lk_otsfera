import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ONE_C_PUSHABLE_TYPES } from '@/lib/services/oneCSync/schemas';

/**
 * Страж `У-169`/`Р-14` (CLAUDE.md §16): набор типов, которые уезжают в 1С,
 * записан в ТРЁХ местах, и все три обязаны совпадать.
 *
 * ЗАЧЕМ. «КП в 1С не выгружается» (`Р-14`) держится не одной проверкой, а
 * тремя рубежами: схема тела выгрузки (`ONE_C_PUSHABLE_TYPES`) — что
 * кабинет вообще соглашается отправить; умолчание колонки
 * `Company.oneCDocumentPushTypes` — что уезжает при `auto`; CHECK-ограничение
 * в базе — что нельзя записать мимо интерфейса. Если кто-то расширит один
 * рубеж (добавит тип в схему), а два других забудет, поведение разъедется
 * молча: очередь примет документ, а база откажет — или наоборот.
 *
 * ПОЧЕМУ ТЕКСТОВЫЙ СТРАЖ. Prisma-схема и SQL миграции в рантайме недоступны;
 * сравнить их с константой можно только чтением файлов. Регулярные выражения
 * ниже намеренно узкие: страж должен упасть и на «не нашёл» (файл переписали
 * так, что шаблон не совпал), а не только на «нашёл другое».
 *
 * ПРОВЕРЕН МУТАЦИЕЙ (§16): добавление `'commercial_proposal'` в
 * `ONE_C_PUSHABLE_TYPES` роняет оба сравнения; удаление `extra_agreement` из
 * `@default(...)` в schema.prisma роняет сравнение с Prisma.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function listFrom(source: string, re: RegExp, what: string): string[] {
  const m = source.match(re);
  if (!m?.[1]) throw new Error(`${what}: не нашёл список типов по шаблону ${re}`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('guardrail: pushable document types agree across schema, Prisma default and DB CHECK', () => {
  const expected = [...ONE_C_PUSHABLE_TYPES].sort();

  it('never includes the commercial proposal (Р-14)', () => {
    expect(ONE_C_PUSHABLE_TYPES).not.toContain('commercial_proposal');
    expect(ONE_C_PUSHABLE_TYPES.length).toBeGreaterThan(0);
  });

  it('matches @default([...]) of Company.oneCDocumentPushTypes in prisma/schema.prisma', () => {
    const prismaDefault = listFrom(
      read('prisma/schema.prisma'),
      /oneCDocumentPushTypes\s+DocumentType\[\]\s+@default\(\[([^\]]+)\]\)/,
      'prisma/schema.prisma'
    );
    expect(prismaDefault.sort()).toEqual(expected);
  });

  it('matches the ARRAY[...] of CHECK Company_oneCDocumentPushTypes_pushable in the migration', () => {
    const migration = listFrom(
      read('prisma/migrations/20260903100000_stage8_document_push_model/migration.sql'),
      /"Company_oneCDocumentPushTypes_pushable"\s+CHECK\s*\(\s*"oneCDocumentPushTypes"\s*<@\s*ARRAY\[([^\]]+)\]::"DocumentType"\[\]/,
      'migration.sql'
    );
    expect(migration.sort()).toEqual(expected);
  });
});
