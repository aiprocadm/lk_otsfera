import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { importScope } from '@/lib/services/oneCSync/scope';
import { rollbackStateOf, type RollbackState } from './rollback';

/**
 * Общая история обмена с 1С (`У-48`, этап 7).
 *
 * Раньше история была только у Excel-канала, а импорты выписки не показывались
 * **нигде**: пользователь не мог даже проверить, что его файл вообще
 * загрузился. Здесь три канала сведены в один список.
 *
 * Откат (кнопка) поддержан не везде, и это честно отражено в `rollback`:
 * у автообмена отката нет by design — это поток, а не файл, отменять там
 * нечего.
 */
export type ExchangeChannel = 'excel' | 'statement' | 'auto';

export const CHANNEL_LABEL: Record<ExchangeChannel, string> = {
  excel: 'Загрузка Excel',
  statement: 'Выписка по счёту 51',
  auto: 'Автообмен',
};

export type ExchangeHistoryItem = {
  id: string;
  channel: ExchangeChannel;
  createdAt: string;
  /** Имя файла у файловых каналов; у автообмена — что синхронизировали. */
  title: string;
  authorName: string | null;
  status: string;
  /** `unsupported` — канал в принципе не откатывается (автообмен). */
  rollback: RollbackState | 'unsupported';
  counts: Prisma.JsonValue;
};

export type HistoryFilter = {
  channel?: ExchangeChannel | undefined;
  /** Сколько записей вернуть суммарно (после слияния каналов). */
  take?: number | undefined;
};

/** Русское описание записи автообмена: «Организации · получение». */
function autoTitle(entity: string, operation: string): string {
  const ENTITY: Record<string, string> = {
    organization: 'Организации',
    order: 'Заказы',
    payment: 'Платежи',
    document: 'Документы',
    lead: 'Лиды',
  };
  const OPERATION: Record<string, string> = {
    pull: 'получение',
    push: 'отправка',
    import: 'импорт файла',
    reconcile: 'сверка',
  };
  return `${ENTITY[entity] ?? entity} · ${OPERATION[operation] ?? operation}`;
}

/**
 * Последние записи всех каналов, свежие сверху. Скоуп — как у импорта:
 * руководитель видит только свою компанию.
 *
 * Автообмен компанией не режется (`SyncLog` её не хранит), поэтому
 * руководителю он не показывается вовсе — иначе это была бы утечка чужих
 * данных под видом «истории».
 */
export async function listExchangeHistory(
  prisma: PrismaClient,
  session: SessionPayload,
  filter: HistoryFilter = {}
): Promise<{ ok: true; items: ExchangeHistoryItem[] } | { ok: false; error: 'forbidden' }> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };

  const scope = importScope(session);
  const companyWhere = scope.kind === 'company' ? { companyId: scope.companyId } : {};
  const take = filter.take ?? 20;
  const wants = (c: ExchangeChannel) => !filter.channel || filter.channel === c;
  const now = Date.now();
  const items: ExchangeHistoryItem[] = [];

  if (wants('excel')) {
    const rows = await prisma.oneCImportBatch.findMany({
      where: companyWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        fileName: true,
        status: true,
        counts: true,
        importedBy: { select: { name: true } },
        // Число строк следа: батч без следа откатывать нечем, и кнопка обязана
        // сказать это заранее, а не после нажатия (§15 «что делать дальше»).
        _count: { select: { rows: true } },
      },
    });
    for (const b of rows) {
      items.push({
        id: b.id,
        channel: 'excel',
        createdAt: b.createdAt.toISOString(),
        title: b.fileName,
        authorName: b.importedBy?.name ?? null,
        status: b.status,
        rollback: rollbackStateOf(b.status, b.createdAt, now, b._count.rows),
        counts: b.counts,
      });
    }
  }

  if (wants('statement')) {
    const rows = await prisma.paymentImportBatch.findMany({
      where: companyWhere,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        fileName: true,
        status: true,
        counts: true,
        importedBy: { select: { name: true } },
        _count: { select: { writes: true } },
      },
    });
    for (const b of rows) {
      items.push({
        id: b.id,
        channel: 'statement',
        createdAt: b.createdAt.toISOString(),
        title: b.fileName,
        authorName: b.importedBy?.name ?? null,
        status: b.status,
        // `У-59`: откат у выписки такой же, как у Excel. Импорты, сделанные до
        // появления следа записи, честно показывают «отменять нечего».
        rollback: rollbackStateOf(b.status, b.createdAt, now, b._count.writes),
        counts: b.counts,
      });
    }
  }

  // Автообмен — только администратору: `SyncLog` не хранит компанию, и
  // показывать его руководителю значило бы показать чужие обмены.
  if (wants('auto') && scope.kind !== 'company') {
    const rows = await prisma.syncLog.findMany({
      where: { operation: { in: ['pull', 'push', 'reconcile'] } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        entity: true,
        operation: true,
        status: true,
        payload: true,
      },
    });
    for (const l of rows) {
      items.push({
        id: l.id,
        channel: 'auto',
        createdAt: l.createdAt.toISOString(),
        title: autoTitle(l.entity, l.operation),
        authorName: null,
        status: l.status,
        rollback: 'unsupported',
        counts: l.payload,
      });
    }
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { ok: true, items: items.slice(0, take) };
}
