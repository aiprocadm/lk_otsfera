'use client';
import React from 'react';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { bindInboundMessageAction } from '@/server-actions/inbound';
import { createContactFromInboundAction } from '@/server-actions/contacts';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Select, Input, Button } from '@/components/ui';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Привязка нераспознанного (`status==='unresolved'`) обращения к организации
 * менеджера (+опционально к заказу этой организации). `organizations` — уже
 * company/team-scoped список от `listOrganizations` (сервер передаёт props,
 * без повторного RBAC-фильтра на клиенте).
 *
 * Task 11 — когда включён флаг `contacts` (`contactsEnabled`, передаётся
 * страницей), рядом с формой привязки появляется опциональный контрол
 * «Создать контакт из отправителя»: имя + кнопка, вызывающая
 * `createContactFromInboundAction` (создаёт Contact из личности отправителя
 * сообщения и сразу привязывает обращение к нему — learn-on-link захватывает
 * канал на сервере). Оба пути делят один выбор организации. Мирроит
 * `CallBindForm` (src/components/manager/contacts/call-bind-form.tsx) — тот же
 * приём, другая исходная сущность (InboundMessage vs Call).
 */

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Организация вне вашей зоны видимости.',
  not_found: 'Обращение или организация не найдены.'
};

const CREATE_CONTACT_ERROR_LABEL: Record<string, string> = {
  forbidden: 'Организация вне вашей зоны видимости.',
  not_found: 'Обращение или организация не найдены.',
  invalid: 'Введите имя контакта.'
};

function createContactErrorLabel(code: string): string {
  return CREATE_CONTACT_ERROR_LABEL[code] ?? 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function InboxBindForm({
  inboundMessageId,
  organizations,
  contactsEnabled = false
}: {
  inboundMessageId: string;
  organizations: ManagerOrgListRow[];
  contactsEnabled?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [contactName, setContactName] = useState('');
  const [creatingContact, startCreateContact] = useTransition();

  const { formAction, pending, errorText } = useFormAction<{ ok: true }>({
    action: (formData) => {
      const organizationId = String(formData.get('organizationId') ?? '');
      const orderId = String(formData.get('orderId') ?? '').trim();
      return bindInboundMessageAction({
        inboundMessageId,
        organizationId,
        ...(orderId ? { orderId } : {})
      });
    },
    errorMap: ERROR_LABEL,
    onSuccess: () => {
      toast.success('Привязано');
      formRef.current?.reset();
      setOrganizationId('');
    }
  });

  if (organizations.length === 0) {
    return <p className="text-xs text-gray-400">Нет доступных организаций для привязки.</p>;
  }

  function handleCreateContact() {
    if (!organizationId) {
      toast.error('Выберите организацию.');
      return;
    }
    const trimmedName = contactName.trim();
    if (!trimmedName) {
      toast.error('Введите имя контакта.');
      return;
    }
    startCreateContact(async () => {
      const result = await createContactFromInboundAction({
        inboundMessageId,
        organizationId,
        name: trimmedName
      });
      if (result.ok) {
        toast.success('Контакт создан, обращение привязано.');
        setContactName('');
      } else {
        toast.error(createContactErrorLabel(result.error));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <form ref={formRef} action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Select
          name="organizationId"
          required
          disabled={pending}
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          aria-label="Организация"
          className="sm:w-56"
        >
          <option value="">Организация…</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
        <Input
          name="orderId"
          placeholder="ID заказа (необязательно)"
          disabled={pending}
          aria-label="ID заказа"
          className="sm:w-48"
        />
        <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={pending || !organizationId}>
          Привязать
        </Button>
        {errorText && (
          <p role="alert" className="text-xs text-red-600 sm:self-center">
            {errorText}
          </p>
        )}
      </form>
      {contactsEnabled && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Имя контакта"
            aria-label="Имя контакта"
            disabled={creatingContact}
            className="sm:w-48"
          />
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={creatingContact}
            disabled={creatingContact}
            onClick={handleCreateContact}
          >
            Создать контакт из отправителя
          </Button>
        </div>
      )}
    </div>
  );
}
