import type { FeatureFlag } from '@/lib/featureFlags';
import type { ContactTabKey } from '@/lib/services/contacts/get';

/**
 * Реестр вкладок карточки контакта (`У-179`): название по глоссарию, порядок
 * и флаг раздела, без которого вкладки нет.
 *
 * Вкладка «Задачи» добавлена этапом 4 (`У-220`) вместе с
 * `Task.linkedContactId` — ровно тогда, когда обещал комментарий этапа 1.
 * Её флаг — `internal_tasks`, тот же, что у самого раздела задач: при
 * выключенном разделе вкладка ведёт в никуда.
 */
export type ContactCardTab = { key: ContactTabKey; label: string; flag?: FeatureFlag };

const CONTACT_CARD_TABS: readonly ContactCardTab[] = [
  { key: 'dialogs', label: 'Диалоги', flag: 'inbound_messaging' },
  { key: 'calls', label: 'Звонки', flag: 'telephony_mango' },
  { key: 'inbound', label: 'Входящие письма', flag: 'inbound_messaging' },
  { key: 'deals', label: 'Сделки', flag: 'deals_pipeline' },
  { key: 'orders', label: 'Заказы' },
  { key: 'tasks', label: 'Задачи', flag: 'internal_tasks' },
  { key: 'history', label: 'История' },
];

export function contactCardTabsFor(opts: {
  flags: (flag: FeatureFlag) => boolean;
}): ContactCardTab[] {
  return CONTACT_CARD_TABS.filter((t) => !t.flag || opts.flags(t.flag));
}
