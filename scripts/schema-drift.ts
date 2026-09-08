/**
 * Дрейф `schema.prisma` от каталога миграций — с поимённым списком того, что
 * Prisma выразить не умеет.
 *
 * Зачем не голый `prisma migrate diff --exit-code`. В базе есть ограничение,
 * которого в схеме быть не может:
 *
 *     ALTER TABLE "Document" ADD CONSTRAINT "Document_order_company_fkey"
 *       FOREIGN KEY ("orderId", "companyId") REFERENCES "Order"("id", "companyId")
 *       ON UPDATE CASCADE ON DELETE SET NULL ("orderId");
 *
 * Это «компания документа не может разойтись с компанией его заказа» (этап 6,
 * нумерация). При удалении заказа обнуляется ТОЛЬКО `orderId` — Postgres 15
 * умеет `SET NULL (колонка)`, а Prisma такого не выражает: её `onDelete:
 * SetNull` обнулил бы обе колонки пары, включая `companyId`, который NOT NULL.
 *
 * Поэтому голый `--exit-code` здесь всегда красный, а если его убрать — молча
 * пропадёт вся проверка дрейфа (так и было: CI отключили 13.08.2026 и месяц
 * никто не замечал, что схема разошлась ещё и по `@@unique([id, companyId])`).
 * Скрипт держит середину: сравнивает SQL-разницу со списком ожидаемых строк и
 * падает на всём остальном.
 *
 * Запуск: `npm run schema:drift` (нужна пустая теневая БД в `SHADOW_DATABASE_URL`).
 */
import { execFileSync } from 'node:child_process';

/** Строки, которые Prisma не умеет выразить. Каждая — с причиной. */
const EXPECTED: Array<{ sql: string; why: string }> = [
  {
    sql: 'ALTER TABLE "Document" DROP CONSTRAINT "Document_order_company_fkey";',
    why:
      'Составной внешний ключ (orderId, companyId) → Order(id, companyId) с ' +
      '`ON DELETE SET NULL ("orderId")`: обнуляется только одна колонка пары. ' +
      'Prisma выражает лишь `SetNull` на всю связь, а `companyId` — NOT NULL. ' +
      'Живёт в миграциях 20260831160000 и 20260831170000.',
  },
];

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error('Нужна пустая теневая БД: SHADOW_DATABASE_URL=postgresql://…');
  process.exit(2);
}

const script = execFileSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--shadow-database-url',
    shadow,
    '--script',
  ],
  { encoding: 'utf8' }
);

const lines = script
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('--'));

const expected = new Set(EXPECTED.map((e) => e.sql));
const unexpected = lines.filter((l) => !expected.has(l));
const missing = EXPECTED.filter((e) => !lines.includes(e.sql));

if (missing.length > 0) {
  console.error('Ожидаемое расхождение исчезло — список устарел, обнови его:');
  for (const m of missing) console.error(`  ${m.sql}\n    (${m.why})`);
  process.exit(1);
}

if (unexpected.length > 0) {
  console.error('schema.prisma разошёлся с каталогом миграций:');
  for (const l of unexpected) console.error(`  ${l}`);
  console.error(
    '\nЛибо опиши изменение в schema.prisma, либо — если Prisma этого не умеет —\n' +
      'добавь строку в EXPECTED в scripts/schema-drift.ts с объяснением почему.'
  );
  process.exit(1);
}

console.log(`Дрейфа нет. Известных исключений: ${EXPECTED.length}.`);
