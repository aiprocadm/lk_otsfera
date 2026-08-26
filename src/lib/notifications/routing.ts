import type { PrismaClient } from '@prisma/client';
import type { ChannelKey } from './channels/types';
import { NOTIFICATION_TYPES, type NotificationAudience } from './registry';
import { log } from '@/lib/logging';

/**
 * Правила маршрутизации уведомлений (`У-127`).
 *
 * **Что было.** Куда уходит каждое событие, было зашито в коде: письмо и все
 * привязанные мессенджеры сразу. Отключить, например, письма о смене статуса
 * заказа, оставив уведомление в кабинете, было нельзя.
 *
 * **Что стало.** Реестр в коде остаётся значением по умолчанию, а в базе
 * хранятся **только отклонения**. Пустая таблица = ровно прежнее поведение,
 * поэтому включение механизма ничего не меняет само по себе.
 *
 * Приоритет: **правило компании → правило платформы → код.** Руководитель
 * правит свою компанию, администратор — платформу.
 *
 * ---
 *
 * **Про уведомление в кабинете (in-app).** Оно намеренно **не выключается** и
 * в правилах не участвует. Причина техническая, а не «не успели»: запись
 * уведомления служит якорем защиты от повторов — её идентификатор становится
 * ключом задачи доставки (`dedupKey`). Без записи повторная попытка отправки
 * прислала бы второе письмо об одном и том же. Экран говорит об этом прямо, а
 * не молчит.
 */

/** Каналы, которыми управляют правила. In-app сюда не входит — см. выше. */
export const ROUTABLE_CHANNELS = ['email', 'telegram', 'max', 'whatsapp'] as const;

export type RoutableChannel = (typeof ROUTABLE_CHANNELS)[number];

export function isRoutableChannel(value: string): value is RoutableChannel {
  return (ROUTABLE_CHANNELS as readonly string[]).includes(value);
}

export function isKnownAudience(value: string): value is NotificationAudience {
  return ['organization', 'partner', 'manager', 'staff', 'admin'].includes(value);
}

export type RoutingKey = {
  eventType: string;
  audience: NotificationAudience;
  /** `null`/не задан — правила только платформенного уровня. */
  companyId?: string | null | undefined;
};

/**
 * Каналы, разрешённые для события и роли.
 *
 * Возвращает `undefined`, когда ограничений нет — вызывающий тогда не
 * передаёт `channels` вовсе, и поведение точно такое же, как до `У-127`.
 * Возвращать полный список вместо `undefined` было бы тоньше по смыслу, но
 * приравняло бы «правил нет» к «правила разрешают всё», а это разные вещи:
 * список каналов может вырасти, и старое правило не должно его запрещать.
 */
export async function allowedChannels(
  prisma: PrismaClient,
  key: RoutingKey
): Promise<ChannelKey[] | undefined> {
  // Сбой чтения правил не должен останавливать уведомления (§3, degrade
  // gracefully). Направление отказа выбрано осознанно: **доставить по
  // умолчанию**, а не промолчать — не пришедшее уведомление о новом заказе
  // хуже, чем пришедшее лишним каналом.
  let rules: Array<{ companyId: string | null; channel: string; enabled: boolean }>;
  try {
    rules = await prisma.notificationRule.findMany({
      where: {
        eventType: key.eventType,
        audience: key.audience,
        OR: [{ companyId: null }, ...(key.companyId ? [{ companyId: key.companyId }] : [])],
      },
      select: { companyId: true, channel: true, enabled: true },
    });
  } catch (err) {
    log.warn('[notifications] правила недоступны — доставляем по умолчанию', {
      eventType: key.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
  if (rules.length === 0) return undefined;

  // Компания перекрывает платформу: сначала кладём платформенные, потом свои.
  const effective = new Map<string, boolean>();
  for (const r of rules.filter((x) => x.companyId === null)) effective.set(r.channel, r.enabled);
  for (const r of rules.filter((x) => x.companyId !== null)) effective.set(r.channel, r.enabled);

  const disabled = [...effective.entries()].filter(([, on]) => !on).map(([ch]) => ch);
  if (disabled.length === 0) return undefined;

  return (ROUTABLE_CHANNELS as readonly ChannelKey[]).filter((ch) => !disabled.includes(ch));
}

export type RuleRow = {
  eventType: string;
  eventLabel: string;
  audience: NotificationAudience;
  channel: RoutableChannel;
  enabled: boolean;
  /** Откуда взялось значение — чтобы человек видел, что он перекрыл. */
  source: 'company' | 'platform' | 'default';
};

/**
 * Полная таблица правил для экрана: каждое событие × каждая его роль ×
 * каждый канал, с пометкой источника значения.
 *
 * Роли берутся из реестра события, а не перечисляются заново: иначе экран
 * предложил бы настроить доставку той роли, которой событие не адресовано.
 */
export async function listRoutingRules(
  prisma: PrismaClient,
  companyId?: string | null
): Promise<RuleRow[]> {
  // Экран настроек: сбой чтения показывает умолчания, а не пустую страницу.
  let stored: Array<{
    companyId: string | null;
    eventType: string;
    audience: string;
    channel: string;
    enabled: boolean;
  }> = [];
  try {
    stored = await prisma.notificationRule.findMany({
      where: { OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      select: { companyId: true, eventType: true, audience: true, channel: true, enabled: true },
    });
  } catch (err) {
    log.warn('[notifications] правила недоступны — показываем умолчания', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const at = (
    scope: 'company' | 'platform',
    eventType: string,
    audience: string,
    channel: string
  ) =>
    stored.find(
      (r) =>
        r.eventType === eventType &&
        r.audience === audience &&
        r.channel === channel &&
        (scope === 'company' ? r.companyId !== null : r.companyId === null)
    );

  const rows: RuleRow[] = [];
  for (const [eventType, spec] of Object.entries(NOTIFICATION_TYPES)) {
    for (const audience of spec.audience) {
      for (const channel of ROUTABLE_CHANNELS) {
        const own = companyId ? at('company', eventType, audience, channel) : undefined;
        const platform = at('platform', eventType, audience, channel);
        const hit = own ?? platform;
        rows.push({
          eventType,
          eventLabel: spec.label,
          audience,
          channel,
          enabled: hit?.enabled ?? true,
          source: own ? 'company' : platform ? 'platform' : 'default',
        });
      }
    }
  }
  return rows;
}
