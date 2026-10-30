'use client';
import React from 'react';

import { useState } from 'react';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { updateStudentPositionAction } from '@/server-actions/organization/students';
import { Button, Input } from '@/components/ui';

/**
 * Должность сотрудника в его карточке (этап 9 PR-3, ФТ-12.2). Поле
 * необязательное (решение заказчика §9-1 спеки: обучаться могут физлица) —
 * пустое значение допустимо и очищает должность. Значение попадает в выгрузку
 * сотрудников организации.
 *
 * `У-330` (`Д-64`, ТЗ 28.10.2026): поле было открыто всегда, и после
 * сохранения текст оставался в поле ввода — непонятно, сохранилось ли.
 * Теперь два режима: просмотр («Изменить») и правка; после сохранения форма
 * закрывается и показывает сохранённое значение.
 */

const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Сотрудник не найден в вашей организации.',
  validation: 'Должность слишком длинная — не больше 200 символов.',
};

export function StudentPositionForm({
  organizationId,
  studentId,
  initialPosition,
}: {
  organizationId: string;
  studentId: string;
  initialPosition: string | null;
}) {
  const [saved, setSaved] = useState(initialPosition ?? '');
  const [position, setPosition] = useState(saved);
  const [editing, setEditing] = useState(false);

  const { formAction, pending, errorText } = useFormAction<{ ok: true }>({
    action: updateStudentPositionAction,
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      const value = position.trim();
      setSaved(value);
      setPosition(value);
      setEditing(false);
      toast.success('Должность сохранена');
    },
  });

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-xs text-gray-500">Должность</span>
        <span className={saved ? 'text-gray-900' : 'text-gray-400'}>{saved || 'не указана'}</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {saved ? 'Изменить' : 'Указать'}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col sm:flex-row sm:items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <label className="flex-1">
        <span className="block text-xs text-gray-500 mb-1">Должность</span>
        <Input
          name="position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="например, инженер по охране труда"
          maxLength={200}
          autoFocus
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Сохраняем…' : 'Сохранить'}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setPosition(saved);
          setEditing(false);
        }}
      >
        Отмена
      </Button>
      {errorText && (
        <p role="alert" className="text-sm text-red-600 sm:self-center">
          {errorText}
        </p>
      )}
    </form>
  );
}
