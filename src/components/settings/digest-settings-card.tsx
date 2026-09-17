'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type { DigestSettings } from '@/lib/services/notifications/digest';
import { updateDigestSettingsAction } from '@/server-actions/notification-digest';

/**
 * Карточка «Дайджест раз в день» во вкладке «Уведомления» заказчика и партнёра
 * (`У-230`, `Р-Э5-6`). Включён — несрочные письма не приходят по одному, а
 * собираются в одно письмо в выбранный час; срочные (документ, оплаченный
 * счёт, сообщение, статус заявки) по-прежнему приходят сразу.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function DigestSettingsCard({ settings }: { settings: DigestSettings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [hour, setHour] = useState(settings.hourMsk);

  if (!settings.eligible) return null;

  function save(nextEnabled: boolean, nextHour: number) {
    setEnabled(nextEnabled);
    setHour(nextHour);
    startTransition(async () => {
      const res = await updateDigestSettingsAction(nextEnabled, nextHour);
      if (!res.ok) {
        toast.error(errorMessageRu(res.error, 'Не удалось сохранить настройку.'));
        setEnabled(settings.enabled);
        setHour(settings.hourMsk);
        return;
      }
      toast.success(
        nextEnabled ? `Дайджест включён — в ${hourLabel(nextHour)}` : 'Дайджест выключен'
      );
      router.refresh();
    });
  }

  return (
    <section
      data-testid="digest-settings-card"
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Дайджест раз в день</h2>
        <p className="text-sm text-gray-500">
          Вместо писем по каждому событию — одно письмо в выбранный час по Москве. Срочное (новый
          документ, оплаченный счёт, сообщение, статус заявки) приходит сразу.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={isPending}
          onChange={(e) => save(e.target.checked, hour)}
          aria-label="Получать письма дайджестом раз в день"
        />
        Получать письма дайджестом раз в день
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <span>Час отправки</span>
        <Select
          aria-label="Час отправки дайджеста"
          value={String(hour)}
          disabled={isPending || !enabled}
          onChange={(e) => save(enabled, Number(e.target.value))}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </Select>
        <span className="text-gray-500">по Москве</span>
      </label>
    </section>
  );
}
