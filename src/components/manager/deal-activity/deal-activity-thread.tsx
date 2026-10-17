'use client';

import React, { useId, useRef, useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { addDealNoteAction, initiateCallAction } from '@/server-actions/deal-activity';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { ActivityItemView } from './activity-item';

/**
 * «Активность» заказа — только внутреннее (этап 6 ТЗ 13.10.2026, `У-310`,
 * `Р-6-10`): заметки, звонки и смены статуса. Отсюда клиенту не уходит
 * ничего — у формы одна цель, заметка, и переключателя «кому» нет вовсе.
 * Раньше здесь же был режим «Комментарий клиенту», и заметку можно было
 * отправить клиенту одним неверным нажатием; переписка теперь живёт в
 * отдельном блоке «Переписка с клиентом» (`OrderClientThread`).
 */

const INTERNAL_KINDS = new Set<ActivityItem['kind']>(['note', 'call', 'event']);

const NOTE_ERROR_LABEL: Record<string, string> = {
  invalid: 'Введите текст заметки.',
  not_found: 'Заказ не найден.',
};

const CALL_ERROR_LABEL: Record<string, string> = {
  disabled: 'Звонки недоступны (модуль не подключён).',
  not_found: 'Заказ не найден.',
  call_failed: 'Звонок недоступен (не настроено).',
  no_internal_phone: 'Укажите ваш внутренний номер в настройках, чтобы звонить.',
};

export function DealActivityThread({
  orderId,
  items,
  telephonyEnabled,
}: {
  orderId: string;
  items: ActivityItem[];
  telephonyEnabled: boolean;
}) {
  const [callFormOpen, setCallFormOpen] = useState(false);
  const noteFormRef = useRef<HTMLFormElement>(null);
  const callFormRef = useRef<HTMLFormElement>(null);
  const captionId = useId();

  const visible = items.filter(
    (item) => INTERNAL_KINDS.has(item.kind) && (telephonyEnabled || item.kind !== 'call')
  );

  const note = useFormAction<{ id: string }>({
    action: (formData) => addDealNoteAction({ orderId, body: String(formData.get('body') ?? '') }),
    errorMap: NOTE_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Заметка добавлена');
      noteFormRef.current?.reset();
    },
  });

  const call = useFormAction<{ callId: string }>({
    action: (formData) =>
      initiateCallAction({
        orderId,
        toNumber: String(formData.get('toNumber') ?? ''),
      }),
    errorMap: CALL_ERROR_LABEL,
    onSuccess: () => {
      toast.success('Звонок инициирован');
      callFormRef.current?.reset();
      setCallFormOpen(false);
    },
  });

  return (
    <section
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-4"
      aria-label="Активность"
    >
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Активность</h2>
        <p className="text-xs text-gray-500">
          Внутренние заметки, звонки и смены статуса — клиент их не видит.
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          Заметок пока нет. Запишите договорённость или напоминание для коллег — клиент её не
          увидит.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <ActivityItemView key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}

      <div className="border-t border-gray-100 pt-3 space-y-3">
        <form ref={noteFormRef} action={note.formAction} className="flex flex-col gap-2">
          <Textarea
            name="body"
            rows={2}
            required
            disabled={note.pending}
            placeholder="Внутренняя заметка — клиент её не видит…"
            aria-label="Текст заметки"
            aria-describedby={captionId}
          />
          <p id={captionId} className="text-xs text-gray-500">
            Заметку видят только сотрудники. Написать клиенту — в блоке «Переписка с клиентом».
          </p>
          <div className="flex items-center justify-between gap-2">
            <Button type="submit" size="sm" loading={note.pending} disabled={note.pending}>
              Добавить заметку
            </Button>
            {note.errorText && (
              <p role="alert" className="text-xs text-red-600">
                {note.errorText}
              </p>
            )}
          </div>
        </form>

        {telephonyEnabled && (
          <div>
            {!callFormOpen ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCallFormOpen(true)}
              >
                Позвонить
              </Button>
            ) : (
              <form
                ref={callFormRef}
                action={call.formAction}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  name="toNumber"
                  type="tel"
                  required
                  disabled={call.pending}
                  placeholder="Номер телефона"
                  aria-label="Номер телефона"
                  className="max-w-[200px]"
                />
                <Button type="submit" size="sm" loading={call.pending} disabled={call.pending}>
                  Позвонить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={call.pending}
                  onClick={() => setCallFormOpen(false)}
                >
                  Отмена
                </Button>
                {call.errorText && (
                  <p role="alert" className="text-xs text-red-600">
                    {call.errorText}
                  </p>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
