import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

/**
 * Подразделы «Сообщений» сотрудника (этап 7 ТЗ 13.10.2026, `У-313`, `Р-7-1`):
 * «Комментарии по заказам», «Чаты с клиентами», «Чаты команды». Один список
 * на подпункты бокового меню и на вкладки над экраном — две копии подписей
 * разъехались бы при первой же правке.
 *
 * Подраздел с выключенным флагом не показывается нигде: ни в меню, ни во
 * вкладках, а его страница отвечает 404 (гард на странице).
 */
export type MessagesTabKey = 'comments' | 'chats' | 'team';

const MESSAGES_TABS: { key: MessagesTabKey; label: string; path: string; flag?: FeatureFlag }[] = [
  { key: 'comments', label: 'Комментарии по заказам', path: '' },
  { key: 'chats', label: 'Чаты с клиентами', path: '/chats', flag: 'chat' },
  { key: 'team', label: 'Чаты команды', path: '/team', flag: 'staff_chat' },
];

export type MessagesTab = { key: MessagesTabKey; label: string; href: string };

/** Подразделы для кабинета с базовым адресом `base` (`/manager/messages`), флаги — свежие. */
export function messagesTabsFor(base: string): MessagesTab[] {
  return MESSAGES_TABS.filter((t) => !t.flag || isFeatureEnabled(t.flag)).map((t) => ({
    key: t.key,
    label: t.label,
    href: `${base}${t.path}`,
  }));
}
