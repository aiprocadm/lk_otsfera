import type { ContactTabKey } from '@/lib/services/contacts/get';

/**
 * Адреса справочника контактов в трёх зеркальных кабинетах ЦО (этап 1 ТЗ
 * 12.09.2026, `У-178`, `У-179`; `Р-23`). Один компонент карточки — три
 * кабинета: ссылки на организации и заказы ведут в СВОЙ кабинет, а туда, где
 * раздела у кабинета нет (мессенджеры и лиды живут только у менеджера, `Р-М-5`),
 * руководитель идёт как «играющий тренер», администратор — не идёт вовсе.
 */
export type ContactsCabinet = 'manager' | 'leader' | 'admin';

export function contactsBase(cabinet: ContactsCabinet): string {
  return `/${cabinet}/contacts`;
}

export function contactHref(cabinet: ContactsCabinet, id: string): string {
  return `${contactsBase(cabinet)}/${id}`;
}

export function organizationHref(cabinet: ContactsCabinet, id: string): string {
  return `/${cabinet}/organizations/${id}`;
}

/** Куда ведёт строка вкладки; `null` — у этого кабинета такого раздела нет. */
export function contactTabItemHref(
  cabinet: ContactsCabinet,
  kind: ContactTabKey,
  id: string
): string | null {
  switch (kind) {
    case 'dialogs':
      return cabinet === 'admin' ? null : `/manager/messengers/${id}`;
    case 'calls':
      return cabinet === 'admin' ? null : '/manager/calls';
    case 'inbound':
      return cabinet === 'admin' ? null : '/manager/inbox';
    case 'deals':
      return cabinet === 'admin' ? null : `/${cabinet}/deals`;
    case 'orders':
      return `/${cabinet}/orders/${id}`;
    case 'history':
      return null;
  }
}

/** «Написать» — диалог в мессенджере с предвыбранным контактом (`Р-М-8`, `Р-М-5`). */
export function writeToContactHref(contactId: string): string {
  return `/manager/messengers?new=${encodeURIComponent(contactId)}`;
}
