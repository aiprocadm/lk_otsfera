/**
 * Бэкфилл осиротевших Company от дефекта §0.2 (ТЗ починки импорта, Т-42):
 * до этапа 6 каждый новый контрагент из 1С получал СВОЮ пустую Company.
 *
 * По умолчанию — dry-run: только список кандидатов, база не трогается.
 * Применение: два явных флага, целевую компанию скрипт не угадывает.
 *
 *   npm run backfill:orphan-companies                                # dry-run
 *   npm run backfill:orphan-companies -- --apply --company <id>      # применить
 *
 * ПЕРЕД запуском с --apply на проде — бэкап базы (docs/runbook-backups.md).
 * Логика — в src/lib/services/oneCSync/backfill-orphans.ts (там же тесты);
 * здесь только разбор аргументов и печать отчёта.
 *
 * Коды выхода: 0 — успех (в т.ч. «кандидатов нет»); 1 — неверные аргументы
 * или отказ сервиса (целевая компания не найдена / сама является сиротой).
 */
import { PrismaClient } from '@prisma/client';
import {
  findOrphanCompanies,
  applyOrphanBackfill,
} from '../src/lib/services/oneCSync/backfill-orphans';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const companyFlag = argv.indexOf('--company');
  const targetCompanyId = companyFlag >= 0 ? argv[companyFlag + 1] : undefined;

  const prisma = new PrismaClient();
  try {
    const candidates = await findOrphanCompanies(prisma);
    if (candidates.length === 0) {
      console.log('Осиротевших компаний не найдено — делать нечего.');
      return 0;
    }

    console.log(`Кандидаты-сироты (${candidates.length}):`);
    for (const c of candidates) {
      console.log(
        `  - Company ${c.companyId} «${c.companyName}» → организация ${c.organizationId}` +
          ` (ИНН ${c.organizationInn ?? '—'}), заказов на сироте: ${c.ordersCount}`
      );
    }

    if (!apply) {
      console.log('');
      console.log('Dry-run: база НЕ изменена.');
      console.log('Применить: npm run backfill:orphan-companies -- --apply --company <id>');
      console.log('Перед применением на проде сделайте бэкап (docs/runbook-backups.md).');
      return 0;
    }
    if (!targetCompanyId) {
      console.error('--apply требует --company <id целевой компании>.');
      return 1;
    }

    const result = await applyOrphanBackfill(prisma, { targetCompanyId });
    if (!result.ok) {
      console.error(
        result.error === 'target_not_found'
          ? `Целевая компания ${targetCompanyId} не найдена.`
          : `Целевая компания ${targetCompanyId} сама является кандидатом-сиротой — выберите настоящую.`
      );
      return 1;
    }
    for (const o of result.outcomes) {
      console.log(
        o.action === 'deleted'
          ? `  ✓ «${o.companyName}»: организация и ${o.ordersMoved} заказ(ов) перевешаны, пустая Company удалена`
          : `  ! «${o.companyName}»: перевешано (${o.ordersMoved} заказ(ов)), но Company НЕ пуста — оставлена (${o.companyId})`
      );
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('Сбой бэкфилла:', err);
    process.exitCode = 1;
  }
);
