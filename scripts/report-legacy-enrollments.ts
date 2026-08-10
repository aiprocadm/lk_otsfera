/**
 * Отчёт «какие заявки надо разобрать руками» (`У-34а`, шаг 1, этап 6 ТЗ).
 *
 * До этапа 6 направление обучения лежало на шапке заявки, и часть заявок
 * хранит курс **текстом** (`legacyCourseTitle`), а `directionId` у них пуст.
 * Бэкфилл такие заявки не трогает: служебное направление «Без указания»
 * заводить запрещено (решение `Р-8`), поэтому направление им проставляет
 * человек — на экране `/admin/enrollments/legacy`.
 *
 *   npm run report:legacy-enrollments
 *
 * Скрипт **ничего не меняет** — только печатает список. Пока он непустой,
 * миграцию-«замок» (сделать направление позиции обязательным) накатывать
 * нельзя: она упадёт на боевых данных.
 *
 * Коды выхода: 0 — разбирать нечего; 1 — есть незакрытые заявки (удобно для
 * скриптов и CI). Ошибка подключения к базе — тоже 1, с текстом.
 */
import { PrismaClient } from '@prisma/client';
import { listLegacyEnrollments } from '../src/lib/services/enrollments/legacyDirections';

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const rows = await listLegacyEnrollments(prisma);

    if (rows.length === 0) {
      console.log('Разбирать нечего: заявок без направления нет.');
      console.log('Можно накатывать миграцию, делающую направление позиции обязательным.');
      return 0;
    }

    console.log(`Заявок к разбору: ${rows.length}\n`);
    console.log('Дата       | Организация                    | Слушателей | Курс (текстом)');
    console.log('-'.repeat(100));
    for (const r of rows) {
      const org = r.organizationName.slice(0, 30).padEnd(30);
      const cnt = String(r.itemsCount).padStart(10);
      console.log(
        `${fmtDate(r.createdAt)} | ${org} | ${cnt} | ${r.legacyCourseTitle ?? '— (текст не сохранён)'}`
      );
    }
    console.log(
      '\nРазобрать их можно на экране /admin/enrollments/legacy — выбрать направление из справочника.'
    );
    console.log('Пока список непуст, миграцию «сделать направление обязательным» не накатывать.');
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('Не удалось построить отчёт:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
