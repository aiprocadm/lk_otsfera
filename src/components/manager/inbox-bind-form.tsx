'use client';
import React from 'react';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { bindInboundMessageAction } from '@/server-actions/inbound';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Select, Input, Button } from '@/components/ui';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Привязка нераспознанного (`status==='unresolved'`) обращения к организации
 * менеджера (+опционально к заказу этой организации). `organizations` — уже
 * company/team-scoped список от `listOrganizations` (сервер передаёт props,
 * без повторного RBAC-фильтра на клиенте).
 */

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Организация вне вашей зоны видимости.',
  not_found: 'Обращение или организация не найдены.'
};

export function InboxBindForm({
  inboundMessageId,
  organizations
}: {
  inboundMessageId: string;
  organizations: ManagerOrgListRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [organizationId, setOrganizationId] = useState('');

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

  return (
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
  );
}
