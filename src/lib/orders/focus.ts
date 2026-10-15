/**
 * «Фокус» списка заказов менеджера — подписи и адреса (этап 4 ТЗ 13.10.2026,
 * `У-295`, `У-297`, `Р-4-3`). Чистый модуль без базы: им пользуются и экраны,
 * и сервис условий ([orderFocus.ts](../services/manager/orderFocus.ts)).
 */

export const ORDER_FOCUS = ['active', 'overdue', 'due_soon', 'ready'] as const;
export type OrderFocus = (typeof ORDER_FOCUS)[number];

export function isOrderFocus(value: unknown): value is OrderFocus {
  return typeof value === 'string' && (ORDER_FOCUS as readonly string[]).includes(value);
}

/** Подпись фокуса — одна на карточку главной и на пометку над списком. */
export const ORDER_FOCUS_LABEL: Record<OrderFocus, string> = {
  active: 'Заказы в работе',
  overdue: 'Просроченные заказы',
  due_soon: 'Срок в ближайшие 3 дня',
  ready: 'Готово к передаче',
};

/** Куда ведёт карточка главной: список заказов с уже выставленным фокусом. */
export function orderFocusHref(focus: OrderFocus): string {
  return `/manager/orders?focus=${focus}`;
}
