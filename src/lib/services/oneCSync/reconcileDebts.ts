import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { OneCMethodNotImplementedError, type OneCAdapter } from './adapter';
import { normalizeInn } from './inn';
import { writeSyncLog } from './log';
import { OneCDebtSchema } from './schemas';
import { getOneCAdapter } from '.';

/**
 * Сверка дебиторки с 1С (`У-257`, этап 8).
 *
 * Кабинет считает долг сам: «выставлено минус оплачено». 1С считает его своими
 * данными. Пока никто их не сравнивал, расхождение обнаруживалось разговором с
 * клиентом — «я же заплатил» — и разбиралось вручную по двум системам.
 *
 * **Сверка ничего не правит** (`Р-Э8-6`). Она только показывает расхождение:
 * двигать суммы заказов по внешнему источнику — решение заказчика, а не
 * фоновой задачи. Тихая автоправка денег однажды переписала бы верную цифру
 * неверной, и виноватого не нашли бы.
 *
 * **«Метод не подключён» — не ошибка.** `GET /api/debts` ожидает реализации на
 * стороне 1С; пока его нет, сверка честно пишет это в историю обмена вместо
 * красной строки «1С не отвечает». Второе заставило бы администратора чинить
 * работающий обмен.
 */

/** Ниже этой разницы расхождением не считаем (`В-8-3`): округление копеек. */
export const DEBT_MISMATCH_THRESHOLD = 1;

export type DebtMismatchRow = {
  orderId: string;
  orderNumber: string | null;
  organizationName: string | null;
  /** Долг по данным кабинета. */
  ours: string;
  /** Долг по данным 1С. */
  theirs: string;
  /** `наш − их`, со знаком: видно, кто «должен больше». */
  diff: string;
};

export type ReconcileDebtsResult =
  | {
      ok: true;
      /** Сколько строк 1С прислала и мы смогли сопоставить. */
      checked: number;
      mismatches: DebtMismatchRow[];
      /** Строки 1С, для которых заказ в кабинете не нашёлся. */
      unmatched: number;
    }
  | { ok: false; error: 'not_implemented' | 'transport'; message: string };

/** Заказы, по которым ещё ждут денег: у оплаченных сверять нечего. */
const UNPAID_STATUSES = ['billed', 'partially_paid'] as const;

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export async function reconcileDebts(
  prisma: PrismaClient,
  opts: { adapter?: OneCAdapter | undefined; since?: Date | undefined } = {}
): Promise<ReconcileDebtsResult> {
  const startedAt = Date.now();
  const adapter = opts.adapter ?? getOneCAdapter();

  let raw: unknown[];
  try {
    raw = await adapter.pullDebts(opts.since ? { since: opts.since.toISOString() } : {});
  } catch (err) {
    const notImplemented = err instanceof OneCMethodNotImplementedError;
    const message = err instanceof Error ? err.message : String(err);
    // Оба случая — строка в истории обмена, но разного смысла: «метод не
    // подключён» админу чинить нечего, «не отвечает» — есть.
    await writeSyncLog(
      {
        entity: 'debt',
        direction: 'inbound',
        operation: 'reconcile',
        status: notImplemented ? 'warn' : 'error',
        errorMessage: notImplemented
          ? 'Сверка дебиторки: метод не подключён на стороне 1С'
          : `Сверка дебиторки: 1С не ответила — ${message}`,
        payload: { channel: 'debts', notImplemented },
        durationMs: Date.now() - startedAt,
      },
      prisma
    );
    if (!notImplemented) {
      log.error('[oneCSync/reconcileDebts] 1С не ответила', { error: message });
    }
    return { ok: false, error: notImplemented ? 'not_implemented' : 'transport', message };
  }

  // Кривая строка не роняет сверку целиком: остальные долги полезны и без неё.
  const debts = raw.flatMap((item) => {
    const parsed = OneCDebtSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

  const byOrder = new Map<string, number>();
  const byInn = new Map<string, number>();
  for (const debt of debts) {
    if (debt.orderExternalId) byOrder.set(debt.orderExternalId, debt.debt);
    else if (debt.organizationInn) byInn.set(normalizeInn(debt.organizationInn), debt.debt);
  }

  const orders = await prisma.order.findMany({
    where: { financialStatus: { in: [...UNPAID_STATUSES] } },
    select: {
      id: true,
      orderNumber: true,
      externalId: true,
      totalAmount: true,
      paidAmount: true,
      organization: { select: { name: true, inn: true } },
    },
  });

  const mismatches: DebtMismatchRow[] = [];
  let checked = 0;
  const matchedKeys = new Set<string>();

  for (const order of orders) {
    // Ключ заказа точнее ключа контрагента: у организации может быть несколько
    // неоплаченных заказов, и общий долг по ИНН к одному из них не отнести.
    const orderKey = order.externalId;
    const innKey = order.organization?.inn ? normalizeInn(order.organization.inn) : null;
    const theirsRaw =
      orderKey && byOrder.has(orderKey)
        ? byOrder.get(orderKey)
        : innKey && byInn.has(innKey)
          ? byInn.get(innKey)
          : undefined;
    if (theirsRaw === undefined) continue;

    if (orderKey && byOrder.has(orderKey)) matchedKeys.add(`order:${orderKey}`);
    else if (innKey) matchedKeys.add(`inn:${innKey}`);

    checked += 1;
    const ours = order.totalAmount.minus(order.paidAmount);
    const theirs = new Prisma.Decimal(theirsRaw);
    const diff = ours.minus(theirs);
    if (diff.abs().lessThan(DEBT_MISMATCH_THRESHOLD)) continue;

    mismatches.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      organizationName: order.organization?.name ?? null,
      ours: money(ours),
      theirs: money(theirs),
      diff: money(diff),
    });
  }

  const unmatched = byOrder.size + byInn.size - matchedKeys.size;

  await writeSyncLog(
    {
      entity: 'debt',
      direction: 'inbound',
      operation: 'reconcile',
      status: mismatches.length > 0 ? 'warn' : 'success',
      errorMessage:
        mismatches.length > 0
          ? `Расхождения по дебиторке: ${mismatches.length}`
          : 'Расхождений по дебиторке нет',
      payload: { channel: 'debts', checked, unmatched, mismatches },
      durationMs: Date.now() - startedAt,
    },
    prisma
  );

  return { ok: true, checked, mismatches, unmatched };
}
