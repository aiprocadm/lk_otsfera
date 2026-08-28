import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Страж: файл миграции — это чистый SQL, а не вывод терминала.
 *
 * Настоящая беда, которую он ловит. При генерации миграции этапа 4
 * (`20260826120000_stage4_notification_rules`) вывод `prisma` перенаправили в
 * `.sql`-файл, и вместе с SQL туда попал цветной баннер CLI
 * «Update available 5.22.0 -> 8.0.0» — с управляющими символами ANSI прямо
 * посреди запросов. Postgres на нём падает («syntax error at or near …»),
 * поэтому `prisma migrate deploy` на ЛЮБОЙ чистой базе останавливался, а с
 * ним — и развёртывание проекта с нуля.
 *
 * Обнаружилось это только при попытке поднять временную базу: обычные тесты
 * работают на уже накатанной схеме и такого не видят.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

function migrationFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(MIGRATIONS)) {
    const dir = join(MIGRATIONS, name);
    if (!statSync(dir).isDirectory()) continue;
    const file = join(dir, 'migration.sql');
    try {
      if (statSync(file).isFile()) out.push(file);
    } catch {
      // Каталог без migration.sql — не наше дело: это ловит сам Prisma.
    }
  }
  return out;
}

describe('миграции содержат только SQL', () => {
  const files = migrationFiles();

  it('миграции вообще находятся — обход не сломан', () => {
    // Пустой обход зелен не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(50);
  });

  it('ни в одной миграции нет управляющих символов терминала', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(file);
      // Допустимы только табуляция, перевод строки и возврат каретки.
      const hasControl = bytes.some(
        (b) => b < 9 || (b > 10 && b < 13) || (b > 13 && b < 32) || b === 127
      );
      if (hasControl) offenders.push(file.replace(MIGRATIONS, 'prisma/migrations'));
    }
    expect(
      offenders,
      'в SQL-файл попал вывод терминала — `prisma migrate deploy` упадёт на чистой базе:\n'
    ).toEqual([]);
  });

  it('ни в одной миграции нет следов вывода CLI', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/Update available|npm i --save-dev prisma|Prisma CLI Version/.test(text)) {
        offenders.push(file.replace(MIGRATIONS, 'prisma/migrations'));
      }
    }
    expect(offenders, 'в SQL-файл попал баннер prisma CLI:\n').toEqual([]);
  });
});
