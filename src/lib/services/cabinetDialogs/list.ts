import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  DIALOG_CHANNEL_LABELS,
  isDialogChannel,
  type DialogChannel,
} from '@/lib/services/messengers/channels';

/**
 * «Переписка с менеджером» — список диалогов клиента (этап 6 ТЗ 12.09.2026,
 * `У-234`, решение `Р-Э6-1`).
 *
 * Одна лента на все каналы: вопрос из кабинета, Telegram, MAX, WhatsApp,
 * почта. Скоуп — `MessengerDialog.userId = session.sub`: диалог принадлежит
 * человеку, а не организации, поэтому коллега по организации чужую переписку
 * не видит (§4, скоуп держит сервис).
 *
 * Превью последней реплики берётся с самого диалога. Если последней была
 * **внутренняя заметка сотрудников**, превью не показывается вовсе: в поле
 * лежит нейтральная пометка (`note.ts`), но клиенту незачем видеть даже её —
 * это обсуждение коллег, а не его переписка (`У-209`).
 */
export type CabinetDialogRow = {
  id: string;
  channel: DialogChannel;
  channelLabel: string;
  /** Канал кабинета — в него клиент пишет; остальные каналы он только читает. */
  isCabinet: boolean;
  lastMessageAt: Date;
  /** Начало последней реплики; `null` — последней была внутренняя заметка. */
  preview: string | null;
  /** `in` — написал клиент, `out` — ответил менеджер; `null` — заметка. */
  lastDirection: 'in' | 'out' | null;
};

/** Больше полусотни переписок в кабинете не бывает; список не резиновый. */
const LIST_CAP = 50;

export async function listCabinetDialogs(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<CabinetDialogRow[]> {
  // Кабинет клиента: у сотрудников свой раздел «Мессенджеры» со своим скоупом.
  if (session.role !== 'organization' && session.role !== 'partner') return [];

  const rows = await prisma.messengerDialog.findMany({
    where: { userId: session.sub },
    // Хвост `id` — устойчивый порядок при одинаковом времени (бэкфилл писем).
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: LIST_CAP,
    select: {
      id: true,
      channel: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      lastMessageDirection: true,
    },
  });

  return rows.map((r) => {
    // Канал в базе — строка: у старых строк может оказаться значение, которое
    // реестр уже не знает. Показываем его как «Кабинет»-нейтральный, но не
    // роняем экран из-за справочника.
    const channel: DialogChannel = isDialogChannel(r.channel) ? r.channel : 'cabinet';
    const isNote = r.lastMessageDirection === 'note';
    return {
      id: r.id,
      channel,
      channelLabel: DIALOG_CHANNEL_LABELS[channel],
      isCabinet: channel === 'cabinet',
      lastMessageAt: r.lastMessageAt,
      preview: isNote ? null : r.lastMessagePreview,
      lastDirection:
        r.lastMessageDirection === 'in' || r.lastMessageDirection === 'out'
          ? r.lastMessageDirection
          : null,
    };
  });
}
