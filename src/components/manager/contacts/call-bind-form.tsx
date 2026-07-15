'use client';

import React, { useState, useTransition } from 'react';
import { Select, Input, Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { bindCallAction, createContactFromCallAction } from '@/server-actions/contacts';

/**
 * Task 10 — call-triage UI on `/manager/calls`. Rendered only for UNRESOLVED
 * calls (`resolvedOrgId == null`) and only when the `contacts` flag is on
 * (parent decides — see `CallsList`). Two independent actions sharing the
 * org picker: bind-only (org already knows the caller) vs create-a-contact-
 * from-the-caller-number-and-bind (first time this number calls in). Mirrors
 * `InboxBindForm` (src/components/manager/inbox-bind-form.tsx) — same job,
 * different source entity (Call vs InboundMessage) — but uses `useTransition`
 * directly (not `useFormAction`) since the two buttons submit to two
 * different server actions rather than one `<form action>`.
 */

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Организация вне вашей зоны видимости.',
  not_found: 'Звонок или организация не найдены.',
  invalid: 'Введите имя контакта.'
};

function errorLabel(code: string): string {
  return ERROR_LABEL[code] ?? 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function CallBindForm({
  callId,
  callerNumber,
  orgs
}: {
  callId: string;
  callerNumber: string;
  orgs: { id: string; name: string }[];
}) {
  const [organizationId, setOrganizationId] = useState('');
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();

  if (orgs.length === 0) {
    return <p className="text-xs text-gray-400">Нет доступных организаций для привязки.</p>;
  }

  function handleBind() {
    if (!organizationId) {
      toast.error('Выберите организацию.');
      return;
    }
    startTransition(async () => {
      const result = await bindCallAction({ callId, organizationId });
      if (result.ok) {
        toast.success('Звонок привязан.');
      } else {
        toast.error(errorLabel(result.error));
      }
    });
  }

  function handleCreateContact() {
    if (!organizationId) {
      toast.error('Выберите организацию.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Введите имя контакта.');
      return;
    }
    startTransition(async () => {
      const result = await createContactFromCallAction({
        callId,
        organizationId,
        name: trimmedName,
        phone: callerNumber
      });
      if (result.ok) {
        toast.success('Контакт создан, звонок привязан.');
        setName('');
      } else {
        toast.error(errorLabel(result.error));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select
        aria-label="Организация"
        value={organizationId}
        onChange={(e) => setOrganizationId(e.target.value)}
        disabled={pending}
        className="sm:w-48"
      >
        <option value="">Организация…</option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Имя контакта"
        placeholder="Имя контакта"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={pending}
        className="sm:w-40"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={pending}
          onClick={handleBind}
        >
          Привязать
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          loading={pending}
          disabled={pending}
          onClick={handleCreateContact}
        >
          Создать контакт из номера
        </Button>
      </div>
    </div>
  );
}
