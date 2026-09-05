import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { documentTypeLabelRu } from '@/lib/documents/fileName';
import { errorMessageRu } from '@/lib/errors/messages';
import { pluralizeRu } from '@/lib/format';
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
export type ExchangeChannel = 'excel' | 'statement' | 'auto' | 'documents';

export const CHANNEL_LABEL: Record<ExchangeChannel, string> = {
  excel: 'Загрузка Excel',
  statement: 'Выписка по счёту 51',
  auto: 'Автообмен',
  // `У-173`: пакет документов, скачанный файлом для 1С; `У-174`: каждая
  // попытка выгрузки документа по сети — тоже здесь.
  documents: 'Документы → 1С',
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
  /**
   * `У-174`: что именно случилось — текст ошибки 1С или русская причина
   * отказа. Только у попыток выгрузки документов; у остальных `null`.
   */
  detail: string | null;
};

export type HistoryFilter = {
  channel?: ExchangeChannel | undefined;
  /** Сколько записей вернуть суммарно (после слияния каналов). */
  take?: number | undefined;
};

/** Что кладёт в payload каждая попытка выгрузки (`pushDocument.ts`). */
type AttemptPayload = {
  documentId?: string;
  type?: string;
  number?: string | null;
  attempt?: number;
  actorUserId?: string | null;
  reason?: string;
};

/** «Акт А-7 → 1С · попытка 2» — по номеру человек узнаёт бумагу, по попытке видит, что она не первая. */
function attemptTitle(p: AttemptPayload): string {
  const name = `${documentTypeLabelRu(p.type ?? 'other')} ${p.number ?? 'без номера'} → 1С`;
  return p.attempt ? `${name} · попытка ${p.attempt}` : name;
}

/**
 * Подробности попытки: ошибка 1С как есть, отказ — русской строкой из
 * словаря ошибок (в `errorMessage` лежит код), пропуск той же версии — словами.
 */
function attemptDetail(
  operation: string,
  status: string,
  errorMessage: string | null,
  p: AttemptPayload
): string | null {
  if (status === 'error') return errorMessage;
  if (operation !== 'skip') return null;
  if (p.reason === 'same_version') return 'Эта версия уже в 1С — повтор не нужен.';
  return errorMessage ? errorMessageRu(errorMessage) : null;
}

/** Имена инициаторов попыток одним запросом — по одному на строку было бы N+1. */
async function actorNames(
  prisma: PrismaClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

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
        detail: null,
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
        detail: null,
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
        detail: null,
      });
    }
  }

  // Документы → 1С: пакеты (`У-173`, `operation: 'export'`) и попытки
  // выгрузки по сети (`У-174`, `create`/`update`/`skip`) — все исходящие
  // записи `SyncLog` по документам. Компания лежит в payload, поэтому
  // руководителю показывается только своё; записи без `companyId` (до
  // `У-174`) ему не видны — лучше пропуск, чем чужая бумага. Рядовому
  // менеджеру канала нет вовсе — он и пакет собрать не может.
  if (wants('documents') && scope.kind !== 'orgs') {
    const rows = await prisma.syncLog.findMany({
      where: {
        entity: 'document',
        direction: 'outbound',
        ...(scope.kind === 'company'
          ? { payload: { path: ['companyId'], equals: scope.companyId } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        status: true,
        operation: true,
        errorMessage: true,
        payload: true,
      },
    });
    const authors = await actorNames(
      prisma,
      rows.map((l) => (l.payload as AttemptPayload | null)?.actorUserId)
    );
    for (const l of rows) {
      if (l.operation === 'export') {
        const p = (l.payload ?? {}) as { documents?: number; actorName?: string | null };
        const n = p.documents ?? 0;
        items.push({
          id: l.id,
          channel: 'documents',
          createdAt: l.createdAt.toISOString(),
          title: `Пакет для 1С: ${n} ${pluralizeRu(n, 'документ', 'документа', 'документов')}`,
          authorName: p.actorName ?? null,
          status: l.status,
          rollback: 'unsupported',
          counts: l.payload,
          detail: null,
        });
        continue;
      }
      const p = (l.payload ?? {}) as AttemptPayload;
      items.push({
        id: l.id,
        channel: 'documents',
        createdAt: l.createdAt.toISOString(),
        title: attemptTitle(p),
        authorName: (p.actorUserId && authors.get(p.actorUserId)) || null,
        status: l.status,
        rollback: 'unsupported',
        // Числа попытки (версия, номер попытки) уже в заголовке — в «Числах»
        // они читались бы как итоги импорта.
        counts: null,
        detail: attemptDetail(l.operation, l.status, l.errorMessage, p),
      });
    }
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { ok: true, items: items.slice(0, take) };
}
