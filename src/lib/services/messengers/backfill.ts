import type { Prisma, PrismaClient } from '@prisma/client';
import { MESSENGER_CHANNELS, type MessengerChannel } from './channels';
import { appendInboundToDialog } from './appendInbound';

export type BackfillReport = {
  /** Сколько писем из мессенджеров без реплики в диалоге просмотрено. */
  scanned: number;
  /** Сколько реплик добавлено. */
  appended: number;
};

const DEFAULT_BATCH = 200;

/** Письма из мессенджеров, которых ещё нет в диалогах — общее условие обоих режимов. */
const PENDING_WHERE: Prisma.InboundMessageWhereInput = {
  channel: { in: [...MESSENGER_CHANNELS] },
  dialogMessage: null,
};

/** Сколько писем сложится в диалоги при запуске (dry-run скрипта). */
export function countPendingBackfill(prisma: PrismaClient): Promise<number> {
  return prisma.inboundMessage.count({ where: PENDING_WHERE });
}

/**
 * Р-М-10: существующие письма из мессенджеров сворачиваются в диалоги. Тот же
 * `appendInboundToDialog`, что у вебхука, поэтому повторный запуск ничего не
 * двоит (реплика привязана к письму уникально), а пропуск вебхука («письмо
 * есть, диалога нет») чинится этим же кодом.
 *
 * Идём от старых к новым пачками: у диалога в итоге верное «последнее
 * сообщение», а память не зависит от размера архива. Курсора нет намеренно:
 * сложенное письмо выпадает из условия выборки, поэтому каждая пачка — снова
 * «первые N ещё не сложенных» (курсор со `skip: 1` здесь пропускал бы живую
 * строку, потому что строка-курсор из выборки уже исчезла). Старые письма не
 * считаются непрочитанными — они и так лежали во «Входящих».
 */
export async function backfillDialogsFromInbound(
  prisma: PrismaClient,
  opts: { batchSize?: number } = {}
): Promise<BackfillReport> {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH);
  const report: BackfillReport = { scanned: 0, appended: 0 };

  for (;;) {
    const rows = await prisma.inboundMessage.findMany({
      where: PENDING_WHERE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: {
        id: true,
        channel: true,
        senderRef: true,
        senderDisplay: true,
        body: true,
        externalId: true,
        sentAt: true,
        createdAt: true,
        companyId: true,
        resolvedOrgId: true,
        contactId: true,
        resolvedUserId: true,
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      report.scanned += 1;
      const result = await appendInboundToDialog(prisma, {
        inboundMessageId: row.id,
        // Условие выборки уже отобрало мессенджеры — приведение только для типа.
        channel: row.channel as MessengerChannel,
        peerRef: row.senderRef,
        peerDisplay: row.senderDisplay,
        body: row.body,
        externalId: row.externalId,
        sentAt: row.sentAt ?? row.createdAt,
        binding: row.companyId
          ? {
              companyId: row.companyId,
              organizationId: row.resolvedOrgId,
              contactId: row.contactId,
              userId: row.resolvedUserId,
            }
          : null,
        markUnread: false,
      });
      if (!result.deduped) report.appended += 1;
    }

    if (rows.length < batchSize) break;
  }

  return report;
}
