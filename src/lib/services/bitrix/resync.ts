import type { Prisma, PrismaClient } from '@prisma/client';
import { getQueue } from '@/lib/jobs/queues';
import { bestEffort, log } from '@/lib/logging';
import type { BitrixBatchSettings } from './preview';

/**
 * Еженедельный повтор переноса (`У-203`, спека §3.9) — сердце параллельного
 * периода.
 *
 * Две недели после первого переноса люди работают и в Битрикс24, и в кабинете.
 * Чтобы кабинет не отставал, раз в неделю пакет повторяется: настройки берутся
 * у последнего применённого, правила §3.4 не дают ничего продублировать и не
 * трогают правленное руками. Когда очередной повтор не записал ни строки,
 * Битрикс24 можно выключать — это и есть критерий приёмки §0.4.
 *
 * Повтор идёт через предпросмотр, а не сразу в запись: за неделю на портале
 * могла появиться новая стадия сделки, которой в кабинете нет. Тогда пакет
 * останавливается на предпросмотре и ждёт человека — записать такие сделки
 * «куда-нибудь» хуже, чем не записать вовсе.
 */
export type ResyncResult = {
  /** Заведённые пакеты — по одному на компанию с применённым переносом. */
  batchIds: string[];
  /** Компании, у которых переноса ещё не было: повторять нечего. */
  skipped: number;
};

/** Статусы, из которых имеет смысл брать настройки для повтора. */
const SOURCE_STATUSES = ['applied', 'rollback_partial'];

export async function createResyncBatch(prisma: PrismaClient): Promise<ResyncResult> {
  // Последний применённый пакет каждой компании: настройки уже выверены
  // человеком (таблицы стадий, менеджер по умолчанию, нужны ли файлы).
  const companies = await prisma.bitrixImportBatch.groupBy({
    by: ['companyId'],
    where: { status: { in: SOURCE_STATUSES } },
    _max: { createdAt: true },
  });

  const batchIds: string[] = [];
  let skipped = 0;
  for (const company of companies) {
    const source = await prisma.bitrixImportBatch.findFirst({
      where: { companyId: company.companyId, status: { in: SOURCE_STATUSES } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, companyId: true, importedById: true, source: true, settings: true },
    });
    // Строка МОЖЕТ исчезнуть между двумя запросами: список компаний и сам
    // пакет читаются порознь, а между ними идёт уборка кабинета или откат с
    // удалением. Это не ошибка прогона — просто повторять нечего.
    if (!source) {
      skipped += 1;
      continue;
    }

    const settings = (source.settings ?? {}) as unknown as BitrixBatchSettings;
    const created = await prisma.bitrixImportBatch.create({
      data: {
        companyId: source.companyId,
        importedById: source.importedById,
        source: source.source,
        mode: 'resync',
        status: 'preview_pending',
        counts: {},
        settings: {
          ...settings,
          // Строки и находки прошлого прогона не наследуются: это картина той
          // недели, и в отчёте повтора она врала бы.
          rows: [],
          stagesFound: [],
          usersFound: [],
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    batchIds.push(created.id);

    await getQueue('bitrix.import')
      .add('preview', { batchId: created.id })
      .catch(bestEffort('[bitrix/resync] задача предпросмотра не поставлена'));
  }

  log.info('[bitrix/resync] повтор переноса заведён', {
    batches: batchIds.length,
    skipped,
  });
  return { batchIds, skipped };
}
