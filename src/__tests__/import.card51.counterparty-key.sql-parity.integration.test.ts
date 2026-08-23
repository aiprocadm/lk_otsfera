import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

import { counterpartyKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';

// `У-83`/`У-84`: SQL-бэкфилл миграции обязан давать те же ключи, что и
// TS-функция, — иначе строки, заполненные миграцией, молча разойдутся со
// строками, которые пишет код. Приём стража `У-36`: SQL берётся ИЗ ФАЙЛА
// миграции (между маркерами), а не из копии в тесте — копия проверяла бы
// сама себя. pg_temp-функция видна только в своём соединении, поэтому всё
// исполняется внутри одной interactive-транзакции.
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const MIGRATION_SUFFIX = '_stage1_counterparty_key';

function readMigrationFn(): string {
  const dir = readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith(MIGRATION_SUFFIX));
  if (!dir) throw new Error(`миграция *${MIGRATION_SUFFIX} не найдена в prisma/migrations`);
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
  const m = sql.match(
    /-- counterparty-key-fn-begin\n([\s\S]*?)\n-- counterparty-key-fn-end/
  );
  if (!m) throw new Error('маркеры counterparty-key-fn-begin/end не найдены в migration.sql');
  return m[1]!;
}

const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

// Тот же контракт, что в unit-таблице import.card51.counterparty-key.test.ts,
// плюс случаи, где SQL и TS легче всего разъехаться (локаль, ё, лукахед).
const FIXTURES = [
  'ООО «Ромашка»',
  'РОМАШКА, ООО',
  'ромашка ооо',
  'ХОЛДИНГ ГЕФЕСТ ООО',
  'Ёлки-Палки АО',
  'ИП Иванов И.И.',
  '  ПАО  Газпром  ',
  'ЗАО "Вектор"',
  'ФГУП НИИ Связи',
  'МУП Водоканал',
  'ООО АО Ромашка',
  'Фонд АНО НКО',
  'Сипайлово',
  'ПРООО-Сервис',
  'ООО',
  'Servicetrade Ltd.',
  'ДС №260509-1905 от 19.05.2026 г.',
];

describe('counterpartyKey: SQL-бэкфилл ≡ TS (У-83/У-84)', () => {
  it('функция из файла миграции даёт те же ключи, что counterpartyKey()', async () => {
    const fnSql = readMigrationFn();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(fnSql);
      for (const raw of FIXTURES) {
        const rows = await tx.$queryRawUnsafe<Array<{ key: string | null }>>(
          'SELECT pg_temp.counterparty_key($1) AS key',
          raw
        );
        const sqlKey = rows[0]?.key ?? null;
        const tsKey = counterpartyKey(raw).key || null;
        expect({ raw, key: sqlKey }).toEqual({ raw, key: tsKey });
      }
    });
  });
});
