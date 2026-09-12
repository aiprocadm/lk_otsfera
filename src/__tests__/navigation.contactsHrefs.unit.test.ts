import { describe, it, expect } from 'vitest';
import type { ContactTabKey } from '@/lib/services/contacts/get';
import {
  contactHref,
  contactsBase,
  contactTabItemHref,
  organizationHref,
  writeToContactHref,
  type ContactsCabinet,
} from '@/lib/navigation/contactsHrefs';

/**
 * Адреса справочника контактов в трёх зеркальных кабинетах (этап 1 ТЗ
 * 12.09.2026, `У-178`, `У-179`, `Р-23`, `Р-М-5`; спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3, §3.12):
 * список, карточка и организация ведут в СВОЙ кабинет; строки вкладок
 * мессенджеров, звонков и входящих — в кабинет менеджера («играющий тренер»
 * для руководителя), а администратору такой ссылки нет; «Написать» кодирует
 * идентификатор контакта в адресе.
 */
const CABINETS: ContactsCabinet[] = ['manager', 'leader', 'admin'];

describe('базовые адреса', () => {
  it.each(CABINETS)('кабинет %s: список, карточка, организация', (cabinet) => {
    expect(contactsBase(cabinet)).toBe(`/${cabinet}/contacts`);
    expect(contactHref(cabinet, 'k1')).toBe(`/${cabinet}/contacts/k1`);
    expect(organizationHref(cabinet, 'o1')).toBe(`/${cabinet}/organizations/o1`);
  });
});

describe('contactTabItemHref', () => {
  const matrix: Record<ContactTabKey, Record<ContactsCabinet, string | null>> = {
    dialogs: {
      manager: '/manager/messengers/d1',
      leader: '/manager/messengers/d1',
      admin: null,
    },
    calls: { manager: '/manager/calls', leader: '/manager/calls', admin: null },
    inbound: { manager: '/manager/inbox', leader: '/manager/inbox', admin: null },
    deals: { manager: '/manager/deals', leader: '/leader/deals', admin: null },
    orders: {
      manager: '/manager/orders/d1',
      leader: '/leader/orders/d1',
      admin: '/admin/orders/d1',
    },
    history: { manager: null, leader: null, admin: null },
  };

  it.each(Object.keys(matrix) as ContactTabKey[])('вкладка %s — по кабинетам', (kind) => {
    for (const cabinet of CABINETS) {
      expect(contactTabItemHref(cabinet, kind, 'd1')).toBe(matrix[kind][cabinet]);
    }
  });

  it('у администратора нет ссылок в разделы менеджера, но есть заказы', () => {
    const admin = (['dialogs', 'calls', 'inbound', 'deals', 'history'] as ContactTabKey[]).map(
      (k) => contactTabItemHref('admin', k, 'x')
    );
    expect(admin).toEqual([null, null, null, null, null]);
    expect(contactTabItemHref('admin', 'orders', 'x')).toBe('/admin/orders/x');
  });
});

describe('writeToContactHref', () => {
  it('ведёт на новый диалог с предвыбранным контактом; идентификатор кодируется', () => {
    expect(writeToContactHref('k1')).toBe('/manager/messengers?new=k1');
    expect(writeToContactHref('a b/c&d')).toBe('/manager/messengers?new=a%20b%2Fc%26d');
  });
});
