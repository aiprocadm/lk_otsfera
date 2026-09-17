import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  DIALOG_CHANNEL_LABELS,
  isDialogChannel,
  type DialogChannel,
} from '@/lib/services/messengers/channels';

/**
 * Карточка переписки клиента (`У-234`, `Р-Э6-1`).
 *
 * **Внутренние заметки сотрудников сюда не попадают никогда.** Фильтр
 * `direction: { in: ['in', 'out'] }` стоит внутри самого запроса сообщений, а
 * не «где-то в файле»: страж `messengers.cabinet-notes-not-served` читает
 * запрос целиком, а интеграционный тест проверяет это на данных (`У-209`).
 *
 * Сообщения берутся отдельным запросом, а не вложенным `select` диалога,
 * намеренно: вложенную выборку страж не видит, и фильтр можно было бы потерять
 * при первой же правке.
 */
type CabinetDialogMessage = {
  id: string;
  /** `in` — реплика клиента, `out` — ответ менеджера. Заметок здесь нет. */
  direction: 'in' | 'out';
  body: string;
  createdAt: Date;
  /** Имя файла, если он был в сообщении; скачивание — в канале, не в кабинете. */
  attachmentName: string | null;
};

export type CabinetDialogView = {
  id: string;
  channel: DialogChannel;
  channelLabel: string;
  isCabinet: boolean;
  messages: CabinetDialogMessage[];
  /** Сколько реплик старше показанных не вошло в карточку. */
  hiddenCount: number;
};

export type GetCabinetDialogResult =
  { ok: true; dialog: CabinetDialogView } | { ok: false; error: 'not_found' };

/** Столько последних реплик показываем; остальное — счётчиком сверху. */
const MESSAGES_CAP = 100;

export async function getCabinetDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  dialogId: string
): Promise<GetCabinetDialogResult> {
  if (session.role !== 'organization' && session.role !== 'partner') {
    return { ok: false, error: 'not_found' };
  }

  // Чужой диалог отвечает «не найдено», а не «нет прав»: разные ответы выдали
  // бы существование чужой переписки (§16, краевой путь).
  const dialog = await prisma.messengerDialog.findFirst({
    where: { id: dialogId, userId: session.sub },
    select: { id: true, channel: true },
  });
  if (!dialog) return { ok: false, error: 'not_found' };

  const [rows, total] = await Promise.all([
    prisma.messengerMessage.findMany({
      where: { dialogId: dialog.id, direction: { in: ['in', 'out'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MESSAGES_CAP,
      select: {
        id: true,
        direction: true,
        body: true,
        createdAt: true,
        attachmentName: true,
      },
    }),
    // Фильтр повторён внутри вызова намеренно: вынесенный в переменную, он
    // не виден стражу — а именно так заметка и утекла бы при правке.
    prisma.messengerMessage.count({
      where: { dialogId: dialog.id, direction: { in: ['in', 'out'] } },
    }),
  ]);

  const channel: DialogChannel = isDialogChannel(dialog.channel) ? dialog.channel : 'cabinet';
  return {
    ok: true,
    dialog: {
      id: dialog.id,
      channel,
      channelLabel: DIALOG_CHANNEL_LABELS[channel],
      isCabinet: channel === 'cabinet',
      // Свежие снизу: человек читает переписку сверху вниз, как в мессенджере.
      messages: rows
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          direction: m.direction === 'out' ? 'out' : 'in',
          body: m.body,
          createdAt: m.createdAt,
          attachmentName: m.attachmentName,
        })),
      hiddenCount: Math.max(0, total - rows.length),
    },
  };
}
