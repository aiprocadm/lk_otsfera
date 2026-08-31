/**
 * Разбор исторических номеров документов (`У-151`, этап 6 PR-8b).
 *
 *   npm run fix:document-numbers
 *
 * Пишет в базу, но каждое изменение сначала попадает в таблицу отката
 * `DocumentNumberingBackup`, а на экран — отчёт «до/после». Запускать ПОСЛЕ
 * `npm run report:document-numbers` и ПЕРЕД миграцией ограничений.
 *
 * Откат (если что-то пошло не так) — вернуть значения из таблицы отката:
 *
 *   UPDATE "Document" d SET "version" = b."oldValue"::int
 *     FROM "DocumentNumberingBackup" b
 *    WHERE b."documentId" = d."id" AND b."field" = 'version';
 *   UPDATE "Document" d SET "parentDocumentId" = b."oldValue"
 *     FROM "DocumentNumberingBackup" b
 *    WHERE b."documentId" = d."id" AND b."field" = 'parentDocumentId';
 *   UPDATE "Document" d SET "replacesDocumentId" = b."oldValue"
 *     FROM "DocumentNumberingBackup" b
 *    WHERE b."documentId" = d."id" AND b."field" = 'replacesDocumentId';
 */
import { PrismaClient } from '@prisma/client';
import {
  findNumberingIssues,
  fixNumberingIssues,
  isClean,
} from '../src/lib/services/documents/numberingMaintenance';

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const before = await findNumberingIssues(prisma);
    if (isClean(before)) {
      console.log('Номера документов: чинить нечего — всё уже чисто.');
      return 0;
    }

    console.log('ДО:');
    console.log(`  дублей номеров: ${before.duplicates.length} групп`);
    console.log(`  актов и ДС без связи с основанием: ${before.missingParents.length}`);
    console.log(`  ссылок в никуда: ${before.orphanReplaces.length}`);
    console.log(`  счётчиков без компании: ${before.orphanCounters.length}`);
    console.log(`  документов заказов без компании: ${before.companyless.length}\n`);

    const report = await fixNumberingIssues(prisma);

    console.log('СДЕЛАНО:');
    console.log(`  проставлена компания у ${report.companyBackfilled} документов заказов`);
    console.log(`  поднята версия у ${report.versionsBumped.length} документов:`);
    for (const b of report.versionsBumped) {
      console.log(`    ${b.documentId}: версия ${b.from} → ${b.to}`);
    }
    console.log(`  проставлена связь с основанием у ${report.parentsLinked} документов`);
    console.log(`  обнулено ссылок в никуда: ${report.orphanReplacesCleared}`);
    console.log(`  удалено счётчиков без компании: ${report.orphanCountersDeleted}`);

    const after = await findNumberingIssues(prisma);
    console.log('\nПОСЛЕ:');
    console.log(`  дублей номеров: ${after.duplicates.length} групп`);
    console.log(`  актов и ДС без связи с основанием: ${after.missingParents.length}`);
    console.log(`  ссылок в никуда: ${after.orphanReplaces.length}`);
    console.log(`  счётчиков без компании: ${after.orphanCounters.length}`);
    console.log(`  документов заказов без компании: ${after.companyless.length}`);

    if (!isClean(after)) {
      console.log(
        '\n⚠ Осталось нечинимое (скорее всего заказы без компании) — миграция откажется работать.'
      );
      console.log(
        'Прежние значения сохранены в таблице DocumentNumberingBackup; откат — в шапке этого файла.'
      );
      return 1;
    }
    console.log(
      '\nЧисто. Прежние значения сохранены в DocumentNumberingBackup — можно применять миграцию.'
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[fix:document-numbers] сбой:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
