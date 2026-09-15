import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  getCompanyTeamVisibility,
  isManagerLeader,
  isOrgInScope,
  managerOrgScope,
} from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { DIALOG_CHANNELS, type DialogChannel } from './channels';
import { isMessengerAvailable } from './availability';
import { upsertDialog } from './dialog';

/**
 * Канал в списке «кому написать» — вместе с ответом «почему нельзя» (`У-216`).
 *
 * Раньше недоступный канал просто не показывался, и человек оставался без
 * объяснения: кнопка «Написать» есть, а Telegram в списке нет — почему? Две
 * причины выглядят одинаково («нет канала»), а лечатся по-разному: адрес
 * неизвестен — это к клиенту («нажмите Старт в боте»), канал не подключён — к
 * администратору (настройки интеграции).
 */
type CandidateChannel = {
  channel: DialogChannel;
  /** Можно ли написать прямо сейчас. */
  available: boolean;
  /** Человеческое объяснение, когда нельзя; `null`, когда можно. */
  reason: string | null;
};

/** С кем можно начать диалог: человек и состояние каждого канала связи. */
export type DialogCandidate = {
  kind: 'user' | 'contact';
  id: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  channels: CandidateChannel[];
};

const CANDIDATES_CAP = 200;

/** Почему адреса нет — по каналам. Формулировки разные не для красоты: */
const NO_ADDRESS_REASON: Record<Exclude<DialogChannel, 'cabinet'>, string> = {
  // …в Telegram и MAX бот физически не может написать первым, пока человек не
  // нажал «Старт»: это правило самих мессенджеров, а не наша настройка.
  telegram: 'Человек не нажимал «Старт» в нашем боте Telegram — до этого написать ему нельзя.',
  max: 'Человек не нажимал «Старт» в нашем боте MAX — до этого написать ему нельзя.',
  // …в WhatsApp и почте нужен просто известный адрес, и его можно добавить.
  // «В карточке этого человека», а не «контакта»: в списке есть и пользователи
  // кабинета, у которых номер лежит в профиле, — прежняя формулировка
  // отправляла бы искать его не туда.
  whatsapp: 'Номер WhatsApp неизвестен — укажите его в карточке этого человека.',
  email: 'Адрес почты неизвестен — укажите его в карточке этого человека.',
};

const CHANNEL_OFF_REASON = 'Канал не подключён в настройках — обратитесь к администратору.';

/**
 * Каналы, которыми можно написать ПЕРВЫМ. Кабинет сюда не входит намеренно
 * (`У-212`): диалог канала «Кабинет» начинается вопросом клиента. Написать
 * первым «в кабинет» — это уведомление, а не переписка, и у него свой путь.
 */
type StartFirstChannel = Exclude<DialogChannel, 'cabinet'>;

// Непустой кортеж, а не просто массив: его читает `z.enum` в server-action, а
// тот требует хотя бы один элемент. Утверждение безопасно — `DIALOG_CHANNELS`
// начинается с мессенджеров, и «кабинет» не может остаться единственным.
export const START_FIRST_CHANNELS = DIALOG_CHANNELS.filter(
  (c): c is StartFirstChannel => c !== 'cabinet'
) as [StartFirstChannel, ...StartFirstChannel[]];

/** Состояние канала: адрес известен? канал включён? */
function channelState(
  channel: Exclude<DialogChannel, 'cabinet'>,
  address: string | null
): CandidateChannel {
  if (!address) return { channel, available: false, reason: NO_ADDRESS_REASON[channel] };
  if (!isMessengerAvailable(channel)) {
    return { channel, available: false, reason: CHANNEL_OFF_REASON };
  }
  return { channel, available: true, reason: null };
}

/**
 * Кандидаты для «Нового диалога» (Р-М-8, `У-216`): пользователи кабинетов и
 * контакты компании в охвате сотрудника, с состоянием каждого канала связи.
 *
 * `organizationId` сужает список до людей одной организации — так открывается
 * «Написать первым» с карточки организации. И тогда же меняется правило
 * отбора: показываем ВСЕХ её людей, даже тех, кому написать сейчас нельзя.
 * Человек пришёл сюда с конкретным вопросом «как связаться с этой
 * организацией» — пустой список не ответ, а причина у каждого канала ответ.
 *
 * Без фильтра список общий, и в нём остаются только те, кому написать можно:
 * иначе в справочник на тысячу контактов пришлось бы всматриваться, чтобы
 * найти доступных.
 */
export async function listDialogCandidates(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { organizationId?: string } = {}
): Promise<DialogCandidate[]> {
  if (!session.companyId) return [];
  // Локальная константа, а не `opts.organizationId` по месту: со строгими
  // необязательными полями (`exactOptionalPropertyTypes`) TypeScript иначе не
  // видит, что внутри ветки значение точно есть.
  const orgId = opts.organizationId;
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // Руководитель видит всю свою компанию — ровно как решает `startDialog` ниже
  // (`isManagerLeader` в `orgAllowed`). Без этой ветки `managerOrgScope` при
  // выключенной командной видимости возвращает список закреплённых организаций,
  // а у руководителя он обычно пуст: экран показывал бы «некому написать» там,
  // где сервер написать РАЗРЕШАЕТ. Экран и сервер обязаны говорить одно и то же.
  const orgScope: Prisma.OrganizationWhereInput = isManagerLeader(session)
    ? { companyId: session.companyId }
    : managerOrgScope(session, teamMode);

  const [users, contacts] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: 'organization',
        isActive: true,
        organization: orgId ? { AND: [orgScope, { id: orgId }] } : orgScope,
        // Отбора по «есть хоть один адрес» у пользователей кабинета нет
        // намеренно: адрес почты у них есть ВСЕГДА — это их логин, а с `У-205`
        // почта такой же канал диалога. Пока здесь стоял `OR` по трём
        // мессенджерам, сотрудник организации без бота в списке не появлялся,
        // хотя написать ему было можно — и соседняя ветка контактов, которая
        // отбирает по `DIALOG_CHANNELS`, его бы показала. Асимметрия по одному
        // и тому же правилу — худший вид расхождения: оба места выглядят
        // правильными по отдельности.
      },
      select: {
        id: true,
        name: true,
        email: true,
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take: CANDIDATES_CAP,
    }),
    prisma.contact.findMany({
      where: {
        companyId: session.companyId,
        isArchived: false,
        ...(orgId
          ? { organizationId: orgId, organization: orgScope }
          : {
              OR: [{ organizationId: null }, { organization: orgScope }],
              channels: { some: { type: { in: [...START_FIRST_CHANNELS] } } },
            }),
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        organization: { select: { name: true } },
        channels: {
          where: { type: { in: [...START_FIRST_CHANNELS] } },
          select: { type: true },
        },
      },
      orderBy: { name: 'asc' },
      take: CANDIDATES_CAP,
    }),
  ]);

  const out: DialogCandidate[] = [
    ...users.map((u) => ({
      kind: 'user' as const,
      id: u.id,
      name: u.name?.trim() || u.email,
      organizationId: u.organization?.id ?? null,
      organizationName: u.organization?.name ?? null,
      // Перебираем ТОТ ЖЕ список, что и у контакта ниже. Пока каналы были
      // перечислены здесь руками, новый канал контакт получал, а пользователь
      // кабинета — молча нет: два места, где написано одно и то же правило,
      // расходятся при первой же правке.
      channels: START_FIRST_CHANNELS.map((ch) =>
        channelState(
          ch,
          ch === 'telegram'
            ? u.telegramChatId
            : ch === 'max'
              ? u.maxChatId
              : ch === 'whatsapp'
                ? u.whatsappPhone
                : // Адрес почты у пользователя кабинета есть всегда — это логин.
                  u.email
        )
      ),
    })),
    ...contacts.map((c) => {
      const known = new Set(c.channels.map((ch) => ch.type));
      return {
        kind: 'contact' as const,
        id: c.id,
        name: c.name,
        organizationId: c.organizationId,
        organizationName: c.organization?.name ?? null,
        // Адрес сам по себе не нужен: наружу отдаётся только «можно/нельзя».
        // Писать телефон и chatId в список кандидатов значило бы разложить ПДн
        // по экранам без нужды.
        channels: START_FIRST_CHANNELS.map((ch) =>
          channelState(ch, known.has(ch) ? 'known' : null)
        ),
      };
    }),
  ];

  await recordPiiAccess(prisma, {
    session,
    context: 'messengers_candidates',
    subjectIds: out.map((c) => c.id),
  });

  return out;
}

export type StartDialogArgs = {
  kind: 'user' | 'contact';
  id: string;
  /**
   * `У-216`: с этапа 3 первым можно написать и по почте — после `У-205` она
   * такой же двусторонний канал диалога, как мессенджеры.
   */
  channel: Exclude<DialogChannel, 'cabinet'>;
};

export type StartDialogResult =
  | { ok: true; dialogId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'no_messenger_channel' };

type Target = {
  peerRef: string;
  peerDisplay: string | null;
  organizationId: string | null;
  contactId: string | null;
  userId: string | null;
};

/**
 * Начать диалог первым (Р-М-8). Адрес собеседника берётся С СЕРВЕРА из его
 * привязки — от клиента принимаются только «кто» и «в каком мессенджере»,
 * иначе можно было бы написать произвольному chatId от имени компании.
 * Диалог с этим собеседником может уже существовать: тогда открываем его;
 * ничей — привязываем; чужой компании — `forbidden`.
 */
export async function startDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  args: StartDialogArgs
): Promise<StartDialogResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const orgAllowed = (organizationId: string | null) =>
    organizationId === null ||
    teamMode ||
    isManagerLeader(session) ||
    isOrgInScope(session, organizationId);

  let target: Target;
  if (args.kind === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: args.id },
      select: {
        id: true,
        name: true,
        email: true,
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        organization: { select: { id: true, companyId: true } },
      },
    });
    if (!user) return { ok: false, error: 'not_found' };
    if (!user.organization || user.organization.companyId !== session.companyId) {
      return { ok: false, error: 'forbidden' };
    }
    if (!orgAllowed(user.organization.id)) return { ok: false, error: 'forbidden' };
    // Почта — отдельная ветка, а не «всё остальное»: при добавлении канала в
    // хвост тернарника письмо ушло бы на номер WhatsApp.
    const peerRef =
      args.channel === 'telegram'
        ? user.telegramChatId
        : args.channel === 'max'
          ? user.maxChatId
          : args.channel === 'whatsapp'
            ? user.whatsappPhone
            : normalizeChannelValue('email', user.email);
    if (!peerRef) return { ok: false, error: 'no_messenger_channel' };
    target = {
      peerRef,
      peerDisplay: user.name?.trim() || user.email,
      organizationId: user.organization.id,
      contactId: null,
      userId: user.id,
    };
  } else {
    const contact = await prisma.contact.findUnique({
      where: { id: args.id },
      select: {
        id: true,
        name: true,
        companyId: true,
        organizationId: true,
        isArchived: true,
        channels: { where: { type: args.channel }, select: { normalizedValue: true }, take: 1 },
      },
    });
    if (!contact || contact.isArchived) return { ok: false, error: 'not_found' };
    if (contact.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
    if (!orgAllowed(contact.organizationId)) return { ok: false, error: 'forbidden' };
    const peerRef = contact.channels[0]?.normalizedValue;
    if (!peerRef) return { ok: false, error: 'no_messenger_channel' };
    target = {
      peerRef,
      peerDisplay: contact.name,
      organizationId: contact.organizationId,
      contactId: contact.id,
      userId: null,
    };
  }

  const binding = {
    companyId: session.companyId,
    organizationId: target.organizationId,
    contactId: target.contactId,
    userId: target.userId,
  };
  const dialog = await upsertDialog(
    prisma,
    { channel: args.channel, peerRef: target.peerRef },
    {
      create: { peerDisplay: target.peerDisplay, ...binding, status: 'open', unreadCount: 0 },
      // Существующий диалог не трогаем: чей он — решается ниже.
      update: {},
    }
  );
  if (dialog.companyId !== null && dialog.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  if (dialog.companyId === null) {
    await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: binding,
    });
  }

  await recordAudit(prisma, {
    action: 'messenger_dialog_started',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { channel: args.channel, kind: args.kind, targetId: args.id },
  });

  return { ok: true, dialogId: dialog.id };
}
