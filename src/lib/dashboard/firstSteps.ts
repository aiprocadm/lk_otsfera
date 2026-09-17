/**
 * «Первые шаги» на главной заказчика и партнёра (этап 6 ТЗ 12.09.2026,
 * `У-239`, решение `Р-Э6-5`).
 *
 * Выполненность пунктов **не хранится** — считается по данным при каждом
 * показе (заполнены ли реквизиты, есть ли сотрудники, привязан ли бот …).
 * Хранится только одно: «Закрыть» — отметка `onboardingDismissedAt` на
 * членстве (в организации или у партнёра), не на пользователе: один человек
 * в двух организациях закрывает блок в каждой отдельно.
 *
 * Здесь — общая для двух кабинетов часть: вид блока и правило видимости.
 * Пункты и их проверки собирают сервисы ролей (`Р-23`: общий компонент
 * презентационный, данные и права даёт сервис роли).
 */
export type FirstStepItem = {
  key: string;
  title: string;
  /** Одна строка: зачем это нужно. */
  hint: string;
  /** Экран, где шаг выполняется. */
  href: string;
  done: boolean;
};

export type FirstStepsView = {
  items: FirstStepItem[];
  doneCount: number;
  dismissed: boolean;
  /** Показывать ли блок: не закрыт и не всё выполнено. */
  visible: boolean;
};

export function buildFirstStepsView(
  items: FirstStepItem[],
  dismissedAt: Date | null | undefined
): FirstStepsView {
  const doneCount = items.filter((i) => i.done).length;
  const dismissed = dismissedAt != null;
  return { items, doneCount, dismissed, visible: !dismissed && doneCount < items.length };
}
