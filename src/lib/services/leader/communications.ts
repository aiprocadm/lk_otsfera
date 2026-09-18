import type { PrismaClient } from '@prisma/client';
import { DIALOG_CHANNEL_LABELS, isDialogChannel } from '@/lib/services/messengers/channels';

/**
 * Метрики переписки и звонков (`У-243`, этап 7).
 *
 * Времени первого ответа в системе не было: `waitingSince` — **скользящая**
 * метка «ждут сейчас», она обнуляется при каждом ответе, и история
 * длительностей нигде не копится. Нового поля не заводим — время считается из
 * уже хранимых сообщений.
 *
 * Определение (`В-7-4`): от **первого входящего** сообщения диалога до первого
 * исходящего после него. Диалог попадает в период по времени первого входящего.
 * Диалог без ответа считается в «без ответа», но в среднее не входит — иначе
 * среднее занижается тем, что ещё не случилось.
 */
type ChannelCommunicationRow = {
  channel: string;
  channelLabel: string;
  dialogs: number;
  answered: number;
  /** Среднее время первого ответа, минуты; `null` — отвечать было нечего. */
  avgFirstResponseMin: number | null;
  /** Сколько первых ответов вышли за порог компании. */
  overSla: number;
  waitingNoAnswer: number;
};

type ManagerCommunicationRow = {
  managerId: string | null;
  managerName: string;
  dialogs: number;
  avgFirstResponseMin: number | null;
  overSla: number;
};

export type CommunicationsResult = {
  byChannel: ChannelCommunicationRow[];
  byManager: ManagerCommunicationRow[];
  calls: { inbound: number; answered: number; missed: number; outbound: number };
  /** Порог компании в часах — им меряется просрочка. */
  slaHours: number;
};

type RawRow = {
  dialogId: string;
  channel: string;
  assigneeId: string | null;
  assigneeName: string | null;
  minutes: number | null;
};

/**
 * Один запрос на всю вкладку: пары «первое входящее → первый ответ» по всем
 * диалогам компании за период. Выборка по диалогу в цикле превратила бы отчёт
 * в сотни запросов (`У-248`, страж `reports.no-n-plus-one`).
 */
async function firstResponses(
  prisma: PrismaClient,
  args: { companyId: string; from: Date; to: Date }
): Promise<RawRow[]> {
  return prisma.$queryRaw<RawRow[]>`
    WITH first_in AS (
      SELECT DISTINCT ON (m."dialogId")
             m."dialogId", m."createdAt" AS in_at
        FROM "MessengerMessage" m
        JOIN "MessengerDialog" d ON d.id = m."dialogId"
       WHERE d."companyId" = ${args.companyId}
         AND m.direction = 'in'
       ORDER BY m."dialogId", m."createdAt"
    )
    SELECT fi."dialogId"                                   AS "dialogId",
           d.channel                                        AS channel,
           d."assigneeId"                                   AS "assigneeId",
           u.name                                           AS "assigneeName",
           EXTRACT(EPOCH FROM (
             (SELECT MIN(o."createdAt")
                FROM "MessengerMessage" o
               WHERE o."dialogId" = fi."dialogId"
                 AND o.direction = 'out'
                 AND o."createdAt" >= fi.in_at) - fi.in_at
           )) / 60                                          AS minutes
      FROM first_in fi
      JOIN "MessengerDialog" d ON d.id = fi."dialogId"
      LEFT JOIN "User" u ON u.id = d."assigneeId"
     WHERE fi.in_at >= ${args.from} AND fi.in_at < ${args.to}
  `;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export async function getCommunications(
  prisma: PrismaClient,
  args: { companyId: string; from: Date; to: Date }
): Promise<CommunicationsResult> {
  const [rows, company, calls] = await Promise.all([
    firstResponses(prisma, args),
    prisma.company.findUnique({
      where: { id: args.companyId },
      select: { slaResponseHours: true },
    }),
    prisma.call.findMany({
      where: { companyId: args.companyId, startedAt: { gte: args.from, lt: args.to } },
      select: { direction: true, answeredAt: true },
    }),
  ]);

  const slaHours = company?.slaResponseHours ?? 24;
  const slaMinutes = slaHours * 60;

  type ChannelAcc = { dialogs: number; answers: number[]; overSla: number; noAnswer: number };
  const byChannel = new Map<string, ChannelAcc>();
  type ManagerAcc = { name: string; dialogs: number; answers: number[]; overSla: number };
  const byManager = new Map<string, ManagerAcc>();

  for (const r of rows) {
    const channel = isDialogChannel(r.channel) ? r.channel : 'cabinet';
    const ch: ChannelAcc = byChannel.get(channel) ?? {
      dialogs: 0,
      answers: [],
      overSla: 0,
      noAnswer: 0,
    };
    ch.dialogs += 1;
    if (r.minutes === null) {
      ch.noAnswer += 1;
    } else {
      ch.answers.push(r.minutes);
      if (r.minutes > slaMinutes) ch.overSla += 1;
    }
    byChannel.set(channel, ch);

    // Ответственный берётся ТЕКУЩИЙ: истории назначений нет (`Р-Э7-7`).
    const key = r.assigneeId ?? '';
    const mg: ManagerAcc = byManager.get(key) ?? {
      name: r.assigneeName || 'Не назначен',
      dialogs: 0,
      answers: [],
      overSla: 0,
    };
    mg.dialogs += 1;
    if (r.minutes !== null) {
      mg.answers.push(r.minutes);
      if (r.minutes > slaMinutes) mg.overSla += 1;
    }
    byManager.set(key, mg);
  }

  let inbound = 0;
  let answered = 0;
  let outbound = 0;
  for (const c of calls) {
    if (c.direction === 'outbound') {
      outbound += 1;
      continue;
    }
    inbound += 1;
    // Принятый — это звонок, на который ответили. Именно этого не считал
    // прежний показатель «пропущенные» на дашборде менеджера (`Р-Э7-6`).
    if (c.answeredAt) answered += 1;
  }

  return {
    byChannel: [...byChannel]
      .map(([channel, a]) => ({
        channel,
        channelLabel: isDialogChannel(channel) ? DIALOG_CHANNEL_LABELS[channel] : channel,
        dialogs: a.dialogs,
        answered: a.answers.length,
        avgFirstResponseMin: average(a.answers),
        overSla: a.overSla,
        waitingNoAnswer: a.noAnswer,
      }))
      .sort((a, b) => b.dialogs - a.dialogs),
    byManager: [...byManager]
      .map(([id, a]) => ({
        managerId: id === '' ? null : id,
        managerName: a.name,
        dialogs: a.dialogs,
        avgFirstResponseMin: average(a.answers),
        overSla: a.overSla,
      }))
      .sort((a, b) => b.dialogs - a.dialogs),
    calls: { inbound, answered, missed: inbound - answered, outbound },
    slaHours,
  };
}
