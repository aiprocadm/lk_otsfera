import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/roleModel';
import { DIALOG_CHANNELS, type DialogChannel } from './channels';

/**
 * Светофор каналов переписки (`У-213`).
 *
 * Отвечает на два вопроса, которые администратор задаёт, когда «мессенджеры не
 * работают»:
 *
 *  1. **Приходит ли к нам что-нибудь?** — когда в последний раз принято входящее
 *     сообщение по этому каналу. Если вчера, а клиенты пишут — сломан вебхук.
 *  2. **Уходит ли от нас что-нибудь?** — последняя ошибка отправки, с текстом
 *     провайдера и временем. Раньше эта причина нигде не жила вовсе.
 *
 * Считается по `MessengerMessage` — тому же журналу, который видит сотрудник в
 * переписке. Каналы берутся ВСЕ, какие бывают у диалога, а не только боты:
 * причина отказа пишется и у почты, и у кабинета, и прятать её от светофора
 * значило бы, что «не доставлено» по почте не видно нигде, кроме одной ленты.
 *
 * Отдельного счётчика не заводим: расходящиеся цифры хуже, чем их отсутствие,
 * а `SyncLog` здесь ни при чём (он про обмен с 1С).
 *
 * Данные общие по компании, без ПДн: только время и текст ошибки. Поэтому
 * светофор доступен и руководителю (`Р-22`) — секреты ему по-прежнему не видны.
 */
export type ChannelHealthRow = {
  channel: DialogChannel;
  /** Когда в последний раз пришло входящее. `null` — не приходило ни разу. */
  lastInboundAt: Date | null;
  /** Когда в последний раз не удалось отправить. */
  lastErrorAt: Date | null;
  /** Текст последней ошибки — уже очищенный от секретов при записи. */
  lastError: string | null;
};

export type ChannelHealthResult =
  { ok: true; rows: ChannelHealthRow[] } | { ok: false; error: 'forbidden' };

export async function getChannelHealth(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ChannelHealthResult> {
  // Как и у общего светофора интеграций: администратор и руководитель.
  if (session.role !== 'admin' && !isManagerLeader(session)) {
    return { ok: false, error: 'forbidden' };
  }
  // Сессия без компании ничего не считает: у неё нет своей переписки.
  const companyId = session.role === 'admin' ? undefined : session.companyId;
  if (session.role !== 'admin' && !companyId) return { ok: true, rows: [] };

  const rows = await Promise.all(
    DIALOG_CHANNELS.map(async (channel): Promise<ChannelHealthRow> => {
      const channelScope = { dialog: { ...(companyId ? { companyId } : {}), channel } };
      const [lastIn, lastFail] = await Promise.all([
        prisma.messengerMessage.findFirst({
          where: { ...channelScope, direction: 'in' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        prisma.messengerMessage.findFirst({
          where: { ...channelScope, direction: 'out', deliveryStatus: 'failed' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, deliveryError: true },
        }),
      ]);
      return {
        channel,
        lastInboundAt: lastIn?.createdAt ?? null,
        lastErrorAt: lastFail?.createdAt ?? null,
        lastError: lastFail?.deliveryError ?? null,
      };
    })
  );

  return { ok: true, rows };
}
