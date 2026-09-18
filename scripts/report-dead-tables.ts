/**
 * Dry-run перед удалением мёртвых таблиц (`У-261`, дефекты `Д-43`, `Д-47`;
 * этап 9, PR-3 — до миграции PR-4).
 *
 *   npm run report:dead-tables
 *
 * Отвечает на три вопроса, каждый из которых решает судьбу правки:
 *
 *   1. **Есть ли строки в `SavedView`?** Модель мертва целиком: ни чтения, ни
 *      записи в боевом коде. Пусто — таблицу можно удалять.
 *   2. **Есть ли строки в `Upload`?** Здесь сложнее: писателя нет, но чтение
 *      есть — `findBlocker` считает загрузки, чтобы запретить объединение
 *      заказа, которым уже пользовались. Строки взяться неоткуда, но «неоткуда»
 *      — это про наш код, а не про чужую базу, которая могла пережить более
 *      раннюю версию.
 *   3. **Сколько лидов помечено источником `partner_legacy`?** Это не повод
 *      что-то удалять (решение `Р-Э9-7`: значение остаётся как история), а
 *      цифра для будущего решения заказчика.
 *
 * Плюс проверка `PartnerUser.roleInPartner = 'member'` — значения вне
 * контракта `'admin' | 'manager'` (`Д-47`). Их чинит бэкфилл в миграции PR-4;
 * отчёт показывает, скольких строк это коснётся.
 *
 * Коды выхода: 0 — мёртвые таблицы пусты, миграцию можно применять; 1 — в них
 * есть строки, применять НЕЛЬЗЯ: сначала решение человека, что с этими данными.
 * Тот же вопрос миграция задаёт себе сама и падает внятным текстом — отчёт
 * нужен, чтобы узнать ответ ДО выкладки, а не в момент неё.
 */
import { PrismaClient } from '@prisma/client';

/** Таблицы, которые PR-4 собирается удалить. */
const DEAD_TABLES = ['SavedView', 'Upload'] as const;

async function countTable(prisma: PrismaClient, table: string): Promise<number | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "${table}"`
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    // Таблицы нет — значит миграция уже применена. Это не ошибка отчёта.
    return null;
  }
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    let blocked = false;

    console.log('Мёртвые таблицы (У-261):');
    for (const table of DEAD_TABLES) {
      const n = await countTable(prisma, table);
      if (n === null) {
        console.log(`  ${table}: таблицы уже нет — миграция применена.`);
        continue;
      }
      if (n === 0) {
        console.log(`  ${table}: 0 строк — удалять можно.`);
      } else {
        blocked = true;
        console.log(`  ${table}: ${n} строк — УДАЛЯТЬ НЕЛЬЗЯ.`);
      }
    }

    console.log('\nЗначения вне контракта (Д-47):');
    const members = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "PartnerUser" WHERE "roleInPartner" = 'member'`
    );
    const memberCount = Number(members[0]?.n ?? 0);
    console.log(
      memberCount === 0
        ? "  PartnerUser.roleInPartner = 'member': не найдено."
        : `  PartnerUser.roleInPartner = 'member': ${memberCount} строк — бэкфилл миграции переведёт их в 'manager'.`
    );

    console.log('\nСправочно (Р-Э9-7, ничего не удаляем):');
    const leads = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "Lead" WHERE "source"::text = 'partner_legacy'`
    );
    const leadCount = Number(leads[0]?.n ?? 0);
    console.log(
      `  Лидов с источником partner_legacy: ${leadCount}. Значение enum остаётся — это история, а не ветка кода.`
    );

    if (blocked) {
      console.log(
        '\nИтог: миграцию PR-4 применять НЕЛЬЗЯ. Решите, что делать с найденными строками,\n' +
          'и только потом выкладывайте.'
      );
      return 1;
    }
    console.log('\nИтог: чисто — миграцию PR-4 можно применять.');
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('Отчёт не выполнен:', e);
    process.exit(2);
  });
