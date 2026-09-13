/**
 * Реестр плиток-счётчиков карточки организации (`У-102`, дефект `Д-29`).
 *
 * До этапа 2 плитки жили в компонентах и считали разное под похожими
 * подписями: «Пользователи» у менеджера — это связь `Organization.users`
 * (`User.organizationId`), «в кабинете» у админа — `OrganizationUser`. Человек
 * видел два числа про один объект и не мог понять, какое верное.
 *
 * Теперь подпись, порядок и **источник числа** заданы здесь; сервис роли
 * обязан отдать ровно эти четыре величины (объём данных зависит от скоупа,
 * смысл — нет).
 */
import { fmtMoney } from '@/lib/format';
import type { OrgCardTabKey } from './orgCardTabs';

export type OrgCardTileKey = 'orders' | 'students' | 'cabinetUsers' | 'debt' | 'contacts';

export type OrgCardTileSpec = {
  key: OrgCardTileKey;
  label: string;
  /** Откуда берётся число — фиксируем в реестре, чтобы не разошлось снова. */
  source: string;
  /**
   * Плитка показывается только там, где положена одноимённая вкладка:
   * внутренние счётчики продавца клиенту и партнёру не показывают (`У-182`).
   */
  onlyWithTab?: OrgCardTabKey;
};

export const ORG_CARD_TILES: readonly OrgCardTileSpec[] = [
  { key: 'orders', label: 'Заказы', source: 'Organization._count.orders' },
  { key: 'students', label: 'Сотрудники', source: 'Organization._count.students' },
  {
    key: 'cabinetUsers',
    label: 'Доступ в кабинет',
    // Именно активные `OrganizationUser`, а НЕ `Organization.users`.
    source: 'OrganizationUser (isActive)',
  },
  { key: 'debt', label: 'Задолженность', source: 'sum(Order.totalAmount - Order.paidAmount)' },
  // `У-182` (этап 1 ТЗ 12.09.2026): не архивные контакты организации.
  {
    key: 'contacts',
    label: 'Контакты',
    source: 'Organization._count.contacts (isArchived = false)',
    onlyWithTab: 'contacts',
  },
];

export type OrgCardCounts = {
  orders: number;
  students: number;
  cabinetUsers: number;
  /** Уже посчитанная сумма строкой: деньги не переводим в number (Decimal). */
  debt: string;
  contacts: number;
};

export function orgCardTiles(
  counts: OrgCardCounts,
  opts: { tabs?: ReadonlyArray<{ key: OrgCardTabKey }> } = {}
): Array<{
  key: OrgCardTileKey;
  label: string;
  value: number | string;
}> {
  const tabKeys = opts.tabs?.map((t) => t.key);
  return ORG_CARD_TILES.filter(
    (tile) => !tile.onlyWithTab || tabKeys === undefined || tabKeys.includes(tile.onlyWithTab)
  ).map((tile) => ({
    key: tile.key,
    label: tile.label,
    // `У-175`: сумма пишется как везде в кабинетах — с пробелами между
    // разрядами и без копеек («100 000 ₽», а не «100000.00 ₽»).
    value: tile.key === 'debt' ? fmtMoney(counts.debt) : counts[tile.key],
  }));
}
