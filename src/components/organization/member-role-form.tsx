'use client';

import React, { useState } from 'react';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { updateOrgMemberRoleAction } from '@/server-actions/organization/team';

/**
 * Смена роли участника организации в «Доступе в кабинет» (`У-331`, `Д-65`,
 * ТЗ 28.10.2026).
 *
 * Раньше форма звала серверное действие-обёртку, которая при отказе только
 * писала в журнал, а страница после успеха не обновлялась: колонка «Роль»
 * показывала старую роль до перезагрузки, и человек видел, что роль
 * «отскакивает обратно», — хотя на сервере она уже сменилась (на стенде:
 * три успешные смены за 22 секунды). Теперь — подтверждение или понятная
 * ошибка, и обновление страницы после успеха.
 */

type Role = 'admin' | 'leader' | 'member';

const ERROR_LABEL: Record<string, string> = {
  last_admin_protected:
    'Нельзя понизить последнего администратора организации — сначала назначьте другого.',
};

export function MemberRoleForm({
  organizationId,
  orgUserId,
  role,
  canGrantAdmin,
}: {
  organizationId: string;
  orgUserId: string;
  role: Role;
  /** Назначить администратора может только администратор. */
  canGrantAdmin: boolean;
}) {
  const [value, setValue] = useState<Role>(role);
  const { formAction, pending, errorText } = useFormAction<object>({
    action: updateOrgMemberRoleAction,
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('Роль изменена'),
  });

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="orgUserId" value={orgUserId} />
      <select
        name="newRole"
        aria-label="Роль"
        value={value}
        onChange={(e) => setValue(e.target.value as Role)}
        className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
      >
        <option value="member">Сотрудник</option>
        <option value="leader">Руководитель</option>
        {(canGrantAdmin || role === 'admin') && <option value="admin">Администратор</option>}
      </select>
      <button
        type="submit"
        disabled={pending || value === role}
        className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? 'Сохраняем…' : 'Применить'}
      </button>
      {errorText && (
        <p role="alert" className="basis-full text-xs text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}
