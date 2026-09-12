/**
 * Бэкфилл диалогов мессенджеров (спека 2026-09-12, Р-М-10): письма из
 * Telegram / MAX / WhatsApp, накопившиеся во «Входящих» до появления диалогов,
 * сворачиваются в переписку по собеседникам.
 *
 * По умолчанию — dry-run: только число писем, база не трогается.
 *
 *   npm run backfill:messengers              # dry-run
 *   npm run backfill:messengers -- --apply   # применить
 *
 * Повторный запуск безопасен: письмо попадает в диалог один раз.
 * Логика — в src/lib/services/messengers/backfill.ts (там же тесты);
 * здесь только разбор аргументов и печать отчёта.
 *
 * Коды выхода: 0 — успех (в т.ч. «складывать нечего»); 1 — сбой базы.
 */
import { PrismaClient } from '@prisma/client';
import {
  backfillDialogsFromInbound,
  countPendingBackfill,
} from '../src/lib/services/messengers/backfill';

async function main(): Promise<number> {
  const apply = process.argv.slice(2).includes('--apply');
  const prisma = new PrismaClient();
  try {
    const pending = await countPendingBackfill(prisma);
    if (pending === 0) {
      console.log('Все письма из мессенджеров уже в диалогах — делать нечего.');
      return 0;
    }
    if (!apply) {
      console.log(`Писем из мессенджеров без диалога: ${pending}.`);
      console.log('Dry-run: база НЕ изменена. Применить: npm run backfill:messengers -- --apply');
      return 0;
    }
    const report = await backfillDialogsFromInbound(prisma);
    console.log(`Просмотрено писем: ${report.scanned}, добавлено в диалоги: ${report.appended}.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Бэкфилл диалогов не выполнен:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
