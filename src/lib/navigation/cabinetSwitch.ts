import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Переключение кабинетов «играющего тренера» (`У-111`).
 *
 * У руководителя два кабинета, и раньше переход между ними был спрятан в
 * пункты меню: «Кабинет руководителя» лежал у менеджера в самом низу, а «Мои
 * заказы» — в меню руководителя. Два разных названия для одного действия, оба
 * выглядят как разделы работы, хотя это смена кабинета.
 *
 * Теперь переключатель один и живёт в шапке, а этот модуль отвечает на
 * единственный вопрос: куда именно вести.
 */
export const CABINET_SWITCH = [
  { cabinet: 'leader', label: 'Руководитель' },
  { cabinet: 'manager', label: 'Менеджер' },
] as const;

export type SwitchableCabinet = (typeof CABINET_SWITCH)[number]['cabinet'];

/** Кабинет, в котором человек сейчас находится, — по адресу страницы. */
export function cabinetOfPath(pathname: string): SwitchableCabinet | null {
  for (const { cabinet } of CABINET_SWITCH) {
    if (pathname === `/${cabinet}` || pathname.startsWith(`/${cabinet}/`)) return cabinet;
  }
  return null;
}

/**
 * Куда вести при переключении на `target`.
 *
 * Раздел сохраняется, только если он есть в **обоих** кабинетах
 * (`/leader/orders` ↔ `/manager/orders`); иначе — главная целевого кабинета.
 * Ведём именно на корень раздела, а не на текущий адрес целиком: карточка,
 * видимая руководителю по всей компании, может быть не видна ему же как
 * рядовому менеджеру — и переключение упиралось бы в «не найдено».
 */
export function switchCabinetHref(pathname: string, target: SwitchableCabinet): string {
  const home = `/${target}/dashboard`;
  const from = cabinetOfPath(pathname);
  if (!from || from === target) return home;

  const segment = pathname.slice(`/${from}`.length).split('/').filter(Boolean)[0];
  if (!segment) return home;

  const candidate = `/${target}/${segment}`;
  const exists = navByRole[target].some((item) => item.href === candidate);
  return exists ? candidate : home;
}
