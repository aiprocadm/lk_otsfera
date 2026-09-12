'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { bindDialogAction } from '@/server-actions/messengers';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Select, Button } from '@/components/ui';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Привязка ничьего диалога к организации (спека 2026-09-12 §5.2).
 * `organizations` — уже отобранный по скоупу список от `listOrganizations`;
 * на клиенте RBAC не повторяется — его держит сервис `bindDialog`.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Организация вне вашей зоны видимости.',
  not_found: 'Диалог или организация не найдены.',
};

export function DialogBindForm({
  dialogId,
  organizations,
}: {
  dialogId: string;
  organizations: ManagerOrgListRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [organizationId, setOrganizationId] = useState('');

  const { formAction, pending, errorText } = useFormAction<object>({
    action: (formData) =>
      bindDialogAction({
        dialogId,
        organizationId: String(formData.get('organizationId') ?? ''),
      }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Диалог привязан');
      formRef.current?.reset();
      setOrganizationId('');
    },
  });

  if (organizations.length === 0) {
    return <p className="text-xs text-gray-400">Нет доступных организаций для привязки.</p>;
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <Select
        name="organizationId"
        required
        disabled={pending}
        value={organizationId}
        onChange={(e) => setOrganizationId(e.target.value)}
        aria-label="Организация"
      >
        <option value="">Организация…</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" loading={pending} disabled={pending || !organizationId}>
        Привязать
      </Button>
      {errorText && (
        <p role="alert" className="text-xs text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}
