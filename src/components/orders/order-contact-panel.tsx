'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { contactHref, type ContactsCabinet } from '@/lib/navigation/contactsHrefs';
import { ContactFormDialog } from '@/components/manager/contacts/contact-form-dialog';
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
  /**
   * `У-276` (`Д-51`): организация заказа для окна «Добавить контакт». Раньше
   * здесь была ссылка в карточку организации — туда сотрудника могла не пустить
   * проверка доступа, и он оказывался на главной.
   */
  organization?: { id: string; name: string } | null | undefined;
};

/**
 * «Контакт заказа» (`У-180`, `Order.primaryContactId`) — один компонент на
 * три кабинета ЦО (правило зеркала §0.2): кто со стороны клиента ведёт заказ,
 * выбор из контактов организации заказа, ссылка на карточку. Данные и права
 * даёт сервис `getOrderContactPanel`; здесь — только выбор и сохранение.
 */
export function OrderContactPanel({
  orderId,
  cabinet,
  organizationId,
  current,
  options,
  organization,
}: Props) {
  const router = useRouter();
  // Создание на месте с уже выбранной организацией заказа; после сохранения —
  // остаёмся в заказе, новый человек появляется в выборе.
  const addContact = organization ? (
    <ContactFormDialog
      cabinet={cabinet}
      mode="create"
      orgOptions={[organization]}
      defaultOrganizationId={organization.id}
      afterCreate="stay"
    />
  ) : null;
  const [value, setValue] = useState(current?.id ?? '');
  const [pending, startTransition] = useTransition();
  const dirty = value !== (current?.id ?? '');
  // Текущий контакт, которого среди вариантов нет (в архиве или уехал в другую
  // организацию), показываем отдельной строкой: иначе селект молча встал бы на
  // «— не указан —», а снять человека было бы нечем — кнопка считала бы форму
  // нетронутой.
  const selectOptions: ContactOption[] =
    current && !options.some((o) => o.id === current.id)
      ? [
          {
            id: current.id,
            name: current.isArchived
              ? `${current.name} (в архиве)`
              : `${current.name} (не из этой организации)`,
            position: current.position,
            organizationId: current.organizationId,
          },
          ...options,
        ]
      : options;

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
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            У организации заказа контактов нет. Добавьте человека — он сразу появится здесь, и его
            можно будет выбрать.
          </p>
          {addContact}
        </div>
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
              {selectOptions.map((o) => (
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
          {addContact}
        </div>
      )}
    </div>
  );
}
