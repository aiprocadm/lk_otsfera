/**
 * Dry-run перед миграцией удаления `OrderItem.amount` (`У-139`, решение
 * `Р-13`, этап 5 PR-5).
 *
 * Поле — задел этапа 8 v1.0 («попозиционный счёт»), который так и не
 * заполнялся: деньги переехали в `OrderLine`. Прежде чем удалять колонку,
 * отчёт отвечает на единственный важный вопрос: **есть ли в ней данные?**
 *
 *   npm run report:order-item-amounts
 *
 * Коды выхода: 0 — колонка пуста, миграцию можно применять; 1 — найдены
 * непустые значения (их перечень в выводе), миграцию применять НЕЛЬЗЯ:
 * сначала решение заказчика, куда переносить эти суммы.
 *
 * Тот же вопрос миграция задаёт себе сама и падает внятным текстом — отчёт
 * нужен, чтобы узнать это ДО выкладки, а не в момент неё.
 */
import { PrismaClient } from '@prisma/client';

const PREVIEW_LIMIT = 20;

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    // Колонка ещё существует на момент отчёта, но Prisma-модель её уже не
    // знает (PR-4 снял последнее чтение) — спрашиваем базу напрямую.
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; orderId: string; amount: string }>>(
      `SELECT "id", "orderId", "amount"::text AS amount
         FROM "OrderItem"
        WHERE "amount" IS NOT NULL
        ORDER BY "id"
        LIMIT ${PREVIEW_LIMIT + 1}`
    );

    if (rows.length === 0) {
      console.log('OrderItem.amount: непустых значений нет — миграцию можно применять.');
      return 0;
    }

    const shown = rows.slice(0, PREVIEW_LIMIT);
    console.log(
      `OrderItem.amount: НАЙДЕНЫ непустые значения (${shown.length}${rows.length > PREVIEW_LIMIT ? '+' : ''}).`
    );
    console.log('Миграцию удаления применять НЕЛЬЗЯ — сначала решите, куда переносить суммы.\n');
    for (const r of shown) {
      console.log(`  позиция ${r.id} · заказ ${r.orderId} · сумма ${r.amount}`);
    }
    if (rows.length > PREVIEW_LIMIT) {
      console.log(`  … и другие (показаны первые ${PREVIEW_LIMIT}).`);
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[report:order-item-amounts] сбой:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
