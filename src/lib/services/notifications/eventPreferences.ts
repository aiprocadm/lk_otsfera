import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import {
  NOTIFICATION_TYPES,
  notificationAudienceForRole,
  notificationTypesForRole,
  type NotificationRoleKey,
  type NotificationTypeKey,
} from '@/lib/notifications/registry';
import {
  ROUTABLE_CHANNELS,
  isRoutableChannel,
  listRoutingRules,
  type RoutableChannel,
} from '@/lib/notifications/routing';
import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';

/**
 * Личные настройки «событие × канал» (`У-229`, решение `Р-Э5-4`).
 *
 * **Правило одно: настройка только сужает.** Значение по умолчанию — правило
 * компании (`У-127`); человек может выключить канал у события, но не может
 * включить то, что компания запретила. Проверка живёт ЗДЕСЬ, на сервере, а не
 * только в отключённой галочке формы (§4, defense-in-depth).
 *
 * Потолок считается один раз на весь экран (`listRoutingRules`), а не запросом
 * на каждое событие: у сотрудника до тридцати событий, и тридцать запросов ради
 * одной вкладки — это то, от чего уходили в прогоне сопровождения №26.
 */

export type PreferenceErrorCode =
  'unknown_event' | 'invalid_channel' | 'channel_disabled_by_company';

type PreferenceChannelCell = {
  key: RoutableChannel;
  /** Разрешён правилом компании — это потолок настройки. */
  allowedByCompany: boolean;
  enabled: boolean;
};

export type PreferenceRow = {
  eventType: NotificationTypeKey;
  label: string;
  icon: string;
  channels: PreferenceChannelCell[];
};

export type NotificationPreferenceMatrix = {
  /** Колонки экрана: только привязанные и доступные каналы (почта — всегда). */
  columns: RoutableChannel[];
  rows: PreferenceRow[];
};

const USER_SELECT = {
  telegramChatId: true,
  maxChatId: true,
  whatsappPhone: true,
  notificationPreferences: { select: { eventType: true, channels: true } },
} as const;

/**
 * Компания, чьи правила — потолок настройки. Сотрудник — своя; заказчик —
 * компания его организации; у партнёра и слушателя своей компании нет — для
 * них действуют только правила платформы (`companyId = null`).
 */
async function ceilingCompanyId(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<string | null> {
  if (session.role === 'organization') {
    if (!session.organizationId) return null;
    const org = await prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { companyId: true },
    });
    return org?.companyId ?? null;
  }
  // Контур ЦО: админ + менеджерская сторона (менеджер ∨ руководитель, §4).
  if (session.role === 'admin' || isStaffManagerSide(session)) {
    return session.companyId ?? null;
  }
  return null;
}

/** Каналы, которые у пользователя есть куда доставлять. */
function linkedChannels(user: {
  telegramChatId: string | null;
  maxChatId: string | null;
  whatsappPhone: string | null;
}): RoutableChannel[] {
  return ROUTABLE_CHANNELS.filter((ch) => {
    if (ch === 'email') return true;
    if (ch === 'telegram') return !!user.telegramChatId && isTelegramEnabled();
    if (ch === 'max') return !!user.maxChatId && isMaxEnabled();
    return !!user.whatsappPhone && isWhatsAppEnabled();
  });
}

/** Потолок по правилам компании для события и аудитории роли. */
function ceilingFor(
  rules: Awaited<ReturnType<typeof listRoutingRules>>,
  eventType: NotificationTypeKey,
  role: NotificationRoleKey
): Set<RoutableChannel> {
  const audience = notificationAudienceForRole(eventType, role);
  const allowed = new Set<RoutableChannel>();
  for (const ch of ROUTABLE_CHANNELS) {
    const row = rules.find(
      (r) => r.eventType === eventType && r.audience === audience && r.channel === ch
    );
    // Правила нет — компания ничего не запрещала.
    if (!row || row.enabled) allowed.add(ch);
  }
  return allowed;
}

export async function getNotificationPreferenceMatrix(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; matrix: NotificationPreferenceMatrix }> {
  await primeIntegrationSettingsCache(prisma);
  const role = session.role as NotificationRoleKey;
  const [user, companyId] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.sub }, select: USER_SELECT }),
    ceilingCompanyId(prisma, session),
  ]);
  const rules = await listRoutingRules(prisma, companyId);
  const columns = user ? linkedChannels(user) : ROUTABLE_CHANNELS.filter((ch) => ch === 'email');
  const prefs = new Map(
    (user?.notificationPreferences ?? []).map((p) => [p.eventType, p.channels])
  );

  const rows: PreferenceRow[] = notificationTypesForRole(role).map((eventType) => {
    const spec = NOTIFICATION_TYPES[eventType];
    const ceiling = ceilingFor(rules, eventType, role);
    const own = prefs.get(eventType);
    return {
      eventType,
      label: spec.label,
      icon: spec.icon,
      channels: columns.map((key) => {
        const allowedByCompany = ceiling.has(key);
        // Своя строка — её значение; нет строки — как решила компания.
        const enabled = allowedByCompany && (own ? own.includes(key) : true);
        return { key, allowedByCompany, enabled };
      }),
    };
  });

  return { ok: true, matrix: { columns, rows } };
}

/**
 * Сохранить настройку одного события: список ВКЛЮЧЁННЫХ каналов.
 *
 * Канал, запрещённый компанией, отвергается кодом `channel_disabled_by_company`
 * — даже если форма его не показывала: гард на сервере, а не в разметке.
 */
export async function saveNotificationPreference(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { eventType: string; channels: string[] }
): Promise<{ ok: true; channels: RoutableChannel[] } | { ok: false; error: PreferenceErrorCode }> {
  const role = session.role as NotificationRoleKey;
  const allowedTypes = notificationTypesForRole(role) as string[];
  if (!allowedTypes.includes(args.eventType)) return { ok: false, error: 'unknown_event' };
  const eventType = args.eventType as NotificationTypeKey;

  const channels = [...new Set(args.channels)];
  if (!channels.every(isRoutableChannel)) return { ok: false, error: 'invalid_channel' };
  const wanted = channels as RoutableChannel[];

  const companyId = await ceilingCompanyId(prisma, session);
  const ceiling = ceilingFor(await listRoutingRules(prisma, companyId), eventType, role);
  if (wanted.some((ch) => !ceiling.has(ch))) {
    return { ok: false, error: 'channel_disabled_by_company' };
  }

  const before = await prisma.userNotificationPreference.findUnique({
    where: { userId_eventType: { userId: session.sub, eventType } },
    select: { channels: true },
  });
  await prisma.userNotificationPreference.upsert({
    where: { userId_eventType: { userId: session.sub, eventType } },
    create: { userId: session.sub, eventType, channels: wanted },
    update: { channels: wanted },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'notification_preferences_changed',
    entity: 'user',
    entityId: session.sub,
    before: { eventType, channels: before?.channels ?? null },
    after: { eventType, channels: wanted },
  });
  return { ok: true, channels: wanted };
}
