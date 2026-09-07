import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * `findMany({ distinct })` не собирает списки значений — для этого есть
 * `groupBy`.
 *
 * Prisma считает `distinct` **в памяти приложения**: в базу уходит обычный
 * `SELECT id, action FROM "AuditLog"` — без `DISTINCT` и без `LIMIT`, даже
 * когда указан `take` (он тоже применяется уже после). Ради десятка значений
 * для выпадающего списка в процесс едет вся таблица. Так страница «Аудит»
 * дважды тянула целиком самый быстрорастущий журнал системы, а страница
 * «Доступ к персональным данным» — журнал просмотров (сопровождение `С-8`,
 * 07.09.2026, хотфикс №17). `groupBy` уходит в базу настоящим `GROUP BY`.
 *
 * Запрет не абсолютный: `distinct` по УЗКОЙ выборке (одна сущность, десятки
 * строк) — нормальная дедупликация, а не сканирование. Такие места
 * перечислены поимённо, у каждого записана причина.
 */
const ROOT = join(__dirname, '..', '..');

/** Узкие выборки, где `distinct` безопасен. Пустая причина не принимается. */
const NARROW_BY_DESIGN: Array<{ file: string; why: string }> = [
  {
    file: 'src/lib/notifications/manager.ts',
    why: 'Выборка ограничена комментариями ОДНОГО заказа (`where: { orderId }`, индекс `[orderId, createdAt]`) — это десятки строк, а не таблица. Дедупликация авторов здесь дешевле отдельного `groupBy`.',
  },
];

const DISTINCT = /\bdistinct:\s*\[/;

function sourceFiles(): string[] {
  return execFileSync(
    'git',
    ['ls-files', 'src/lib/**/*.ts', 'src/app/**/*.ts', 'src/worker/**/*.ts'],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('__tests__'));
}

const rel = (f: string) => f.split(sep).join('/');

describe('services: списки значений собирает groupBy, а не distinct в памяти', () => {
  const files = sourceFiles();

  it('файлы находятся — обход не сломан', () => {
    // Страж, которому нечего проверять, зелёный не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(200);
  });

  it('ни один сервис не собирает список значений через findMany({ distinct })', () => {
    const allowed = new Set(NARROW_BY_DESIGN.map((e) => e.file));
    const offenders = files
      .filter((f) => DISTINCT.test(readFileSync(join(ROOT, f), 'utf8')))
      .map(rel)
      .filter((f) => !allowed.has(f));

    expect(
      offenders,
      'Prisma считает `distinct` в памяти приложения: в базу уходит выборка ' +
        'БЕЗ `DISTINCT` и без `LIMIT` (даже с `take`), поэтому ради списка ' +
        'значений читается вся таблица. Возьми `groupBy({ by: [...] })` — он ' +
        'уходит в базу настоящим `GROUP BY`; если выборка узкая по построению, ' +
        'впиши файл в NARROW_BY_DESIGN с причиной:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('у каждого исключения записана причина, и `distinct` там действительно есть', () => {
    for (const e of NARROW_BY_DESIGN) {
      const src = readFileSync(join(ROOT, e.file), 'utf8');
      expect(DISTINCT.test(src), `${e.file}: distinct пропал — убери файл из списка`).toBe(true);
      expect(e.why.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
    }
  });

  it('фильтры аудита и журнала ПДн собираются groupBy', () => {
    // Прямая проверка починенных мест: без неё страж молчал бы, вернись они
    // к построчному чтению через другой вызов.
    for (const f of ['src/lib/services/admin/auditLog.ts', 'src/lib/services/admin/piiAccess.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f}: список для фильтра собирается не groupBy`).toMatch(
        /\.groupBy\(\{\s*by:\s*\[/
      );
    }
  });
});
