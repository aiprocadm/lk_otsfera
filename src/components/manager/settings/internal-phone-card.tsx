'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { toast } from '@/lib/ui/toast';
import { updateInternalPhoneAction } from '@/server-actions/staff-profile';

type Props = { initialInternalPhone: string | null };

/**
 * Карточка настроек: внутренний (АТС-добавочный) номер сотрудника. Используется
 * click-to-call (M2): при звонке из карточки сделки номер берётся отсюда —
 * серверно, из `User.internalPhone`, а не с клиента. Пустое значение очищает
 * номер. Валидация — только защита от абсурдной длины (>32); сам номер хранится
 * сырым (это внутренний extension, не клиентский телефон).
 */
export function InternalPhoneCard({ initialInternalPhone }: Props) {
  const [value, setValue] = useState(initialInternalPhone ?? '');
  const [isPending, startTransition] = useTransition();

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Внутренний номер</h2>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            htmlFor="internal-phone"
            label="Внутренний номер"
            hint="Добавочный номер вашей АТС — с него звонит click-to-call из карточки сделки. Оставьте пустым, чтобы очистить."
          >
            <Input
              id="internal-phone"
              placeholder="Например, 101"
              value={value}
              disabled={isPending}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={isPending}
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateInternalPhoneAction({ internalPhone: value });
              if (result.ok) {
                toast.success('Внутренний номер сохранён');
              } else {
                toast.error('Внутренний номер слишком длинный (не больше 32 символов).');
              }
            })
          }
        >
          Сохранить
        </Button>
      </div>
    </div>
  );
}
