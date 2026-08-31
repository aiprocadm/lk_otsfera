/**
 * Dry-run перед включением уникальности номеров документов (`У-151`,
 * дефекты `Д-3`, `Д-4`, `Д-21`, этап 6 PR-8b).
 *
 *   npm run report:document-numbers
 *
 * Только читает. Отвечает на один вопрос: **можно ли вешать уникальный
 * индекс и внешние ключи прямо сейчас?**
 *
 * Коды выхода: 0 — чисто, миграцию можно применять; 1 — найдено, что мешает
 * (перечень в выводе). Порядок работ: этот отчёт → `npm run fix:document-numbers`
 * → миграция. Миграция задаёт себе те же вопросы сама и падает внятным
 * текстом — отчёт нужен, чтобы узнать это ДО выкладки, а не в момент неё.
 */
import { PrismaClient } from '@prisma/client';
import { findNumberingIssues, isClean } from '../src/lib/services/documents/numberingMaintenance';

const PREVIEW = 20;

function list<T>(rows: T[], render: (row: T) => string): void {
  for (const row of rows.slice(0, PREVIEW)) console.log(`    ${render(row)}`);
  if (rows.length > PREVIEW) console.log(`    … и другие (показаны первые ${PREVIEW}).`);
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const issues = await findNumberingIssues(prisma);
    if (isClean(issues)) {
      console.log('Номера документов: всё чисто — миграцию можно применять.');
      return 0;
    }

    console.log('Номера документов: НАЙДЕНО, что мешает включить уникальность.\n');

    if (issues.duplicates.length > 0) {
      console.log(
        `  Дубли номеров (${issues.duplicates.length} групп) — ` +
          'разводятся версиями, номер не меняется:'
      );
      list(
        issues.duplicates,
        (g) =>
          `${g.type} ${g.number} версия ${g.version} · компания ${g.companyId} · документов ${g.documentIds.length}`
      );
    }
    if (issues.missingParents.length > 0) {
      console.log(
        `\n  Акты и ДС без связи с основанием (${issues.missingParents.length}) — ` +
          'связь проставится по совпадению номера внутри заказа:'
      );
      list(
        issues.missingParents,
        (r) => `${r.type} ${r.number} · документ ${r.documentId} → ${r.candidateId}`
      );
    }
    if (issues.orphanReplaces.length > 0) {
      console.log(
        `\n  Ссылки на несуществующий заменённый документ (${issues.orphanReplaces.length}) — обнулятся:`
      );
      list(issues.orphanReplaces, (r) => `${r.documentId} → ${r.replacesDocumentId}`);
    }
    if (issues.orphanCounters.length > 0) {
      console.log(
        `\n  Счётчики номеров без компании (${issues.orphanCounters.length}) — удалятся:`
      );
      list(issues.orphanCounters, (r) => `компания ${r.companyId} · год ${r.year} · вид ${r.kind}`);
    }
    if (issues.companyless.length > 0) {
      console.log(
        `\n  ⚠ Документы заказов БЕЗ компании (${issues.companyless.length}) — ` +
          'их не починит ни скрипт, ни миграция:'
      );
      list(issues.companyless, (r) => `документ ${r.documentId} · заказ ${r.orderId}`);
      console.log('    Компанию таким заказам нужно проставить вручную — подставить её неоткуда,');
      console.log('    а выдумать значит приписать чужую бумагу чужому юрлицу.');
    }

    console.log('\nДальше: npm run fix:document-numbers (чинит и сохраняет «до» для отката),');
    console.log('затем повторите этот отчёт — он должен стать пустым.');
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[report:document-numbers] сбой:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
