'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Select } from '@/components/ui';
import { useFormAction } from '@/lib/ui/useFormAction';
import { assignDialogAction, takeDialogAction } from '@/server-actions/messengers';
import type { AssignableStaff } from '@/lib/services/messengers/assign';

/**
 * Ответственный за диалог (`У-206`): «Взять себе» одним нажатием и выбор
 * коллеги из списка. Список приходит с сервера уже отобранным по компании —
 * на клиенте права не проверяются, их держит сервис `assignDialog`.
 *
 * Пустое значение селекта — «Без ответственного»: снять ответственного надо
 * уметь так же просто, как назначить, иначе диалог навсегда останется за
 * уволившимся сотрудником.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет доступа к диалогу.',
  not_found: 'Диалог не найден.',
  invalid_assignee: 'Этот сотрудник не может вести диалог: он не из вашей компании или отключён.',
};

export function DialogAssigneePanel({
  dialogId,
  assignee,
  staff,
}: {
  dialogId: string;
  assignee: { id: string; name: string } | null;
  staff: AssignableStaff[];
}) {
  const [value, setValue] = useState(assignee?.id ?? '');

  const { formAction, pending, errorText } = useFormAction<object>({
    action: (formData) => {
      const raw = String(formData.get('assigneeId') ?? '');
      return assignDialogAction({ dialogId, assigneeId: raw === '' ? null : raw });
    },
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('Ответственный обновлён'),
  });

  const take = useFormAction<object>({
    action: () => takeDialogAction({ dialogId }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('Диалог теперь ваш'),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Ответственный</h2>
        {assignee ? (
          <span className="text-sm text-gray-700">{assignee.name}</span>
        ) : (
          <Badge tone="warning">Никто не взял</Badge>
        )}
      </div>

      {!assignee && (
        <form action={take.formAction}>
          <Button type="submit" variant="secondary" disabled={take.pending}>
            Взять себе
          </Button>
        </form>
      )}

      <form action={formAction} className="flex flex-col gap-2">
        <Select
          name="assigneeId"
          disabled={pending}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Ответственный за диалог"
        >
          <option value="">Без ответственного</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Сохраняем…' : 'Назначить'}
        </Button>
      </form>

      {errorText && (
        <p role="alert" className="text-xs text-red-600">
          {errorText}
        </p>
      )}
      {take.errorText && (
        <p role="alert" className="text-xs text-red-600">
          {take.errorText}
        </p>
      )}
    </div>
  );
}
