'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import {
  contactHref,
  organizationHref,
  type ContactsCabinet,
} from '@/lib/navigation/contactsHrefs';
import type { ContactOption } from '@/lib/services/contacts/options';
import type { OrderContactCurrent } from '@/lib/services/orders/primaryContact';
import { setOrderPrimaryContactAction } from '@/server-actions/orders/primaryContact';

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет прав менять контакт заказа.',
  not_found: 'Заказ не найден — обновите страницу.',
  contact_not_found:
    'Этот человек не относится к организации заказа или уже в архиве. Обновите страницу.',
  validation: 'Выберите контакт из списка.',
};

type Props = {
  orderId: string;
  /** Кабинет: ссылки на контакт и организацию ведут в свой раздел (`Р-23`). */
  cabinet: ContactsCabinet;
  organizationId: string | null;
  current: OrderContactCurrent | null;
  options: ContactOption[];
};

/**
 * «Контакт заказа» (`У-180`, `Order.primaryContactId`) — один компонент на
 * три кабинета ЦО (правило зеркала §0.2): кто со стороны клиента ведёт заказ,
 * выбор из контактов организации заказа, ссылка на карточку. Данные и права
 * даёт сервис `getOrderContactPanel`; здесь — только выбор и сохранение.
 */
export function OrderContactPanel({ orderId, cabinet, organizationId, current, options }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(current?.id ?? '');
  const [pending, startTransition] = useTransition();
  const dirty = value !== (current?.id ?? '');

  function save() {
    startTransition(async () => {
      const res = await setOrderPrimaryContactAction({ orderId, contactId: value || null });
      if (!res.ok) {
        toast.error(resolveErrorText(res.error, ERROR_LABEL));
        return;
      }
      toast.success(value ? 'Контакт заказа сохранён.' : 'Контакт заказа снят.');
      router.refresh();
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[#111111]">Контакт заказа</h2>
      <p className="text-xs text-gray-500">
        С кем со стороны клиента ведут этот заказ: ему звонят и пишут по нему.
      </p>

      {current ? (
        <p className="text-sm">
          <Link
            href={contactHref(cabinet, current.id)}
            className="font-medium text-[#F97316] hover:underline"
          >
            {current.name}
          </Link>
          {current.position && <span className="text-gray-500"> · {current.position}</span>}
          {current.isArchived && <span className="text-gray-500"> · в архиве</span>}
        </p>
      ) : (
        <p className="text-sm text-gray-600">Контакт не указан.</p>
      )}

      {!organizationId ? (
        <p className="text-xs text-gray-500">
          У заказа нет организации — выбирать контакт не из кого. Привяжите организацию, и здесь
          появится список её людей.
        </p>
      ) : options.length === 0 ? (
        <p className="text-xs text-gray-500">
          У организации заказа контактов нет.{' '}
          <Link
            href={`${organizationHref(cabinet, organizationId)}?tab=contacts`}
            className="text-[#F97316] hover:underline"
          >
            Добавить контакт
          </Link>{' '}
          в её карточке — и он появится здесь.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select
              aria-label="Контакт заказа"
              value={value}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">— не указан —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.position ? ` — ${o.position}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={save} disabled={!dirty || pending} loading={pending}>
            Сохранить
          </Button>
        </div>
      )}
    </div>
  );
}
