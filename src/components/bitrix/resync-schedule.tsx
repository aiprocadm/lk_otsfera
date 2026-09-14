'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setBitrixResyncPausedAction } from '@/server-actions/admin/bitrix';
import { Button } from '@/components/ui/button';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { toast } from '@/lib/ui/toast';

/**
 * «Повторять еженедельно» (`У-203`) — рычаг параллельного периода.
 *
 * Две недели после первого переноса люди работают и в Битрикс24, и в кабинете.
 * Повтор держит кабинет в курсе: раз в неделю пакет пересчитывается по
 * настройкам последнего применённого. По умолчанию выключен — включать его
 * раньше, чем человек решил начать параллельный период, незачем.
 */
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.',
  unknown_schedule: 'Расписание не найдено — обновите страницу.',
  queue_unavailable: 'Очередь фоновых задач недоступна. Попробуйте позже.',
};

export function ResyncSchedule({ paused, pattern }: { paused: boolean; pattern: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);
    const res = await setBitrixResyncPausedAction(!paused);
    setPending(false);
    if (!res.ok) {
      setError(resolveErrorText(res.error, ERROR_LABELS));
      return;
    }
    toast.success(res.paused ? 'Еженедельный повтор выключен' : 'Еженедельный повтор включён');
    router.refresh();
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
      <h2 className="text-sm font-semibold text-[#111111]">Повторять перенос еженедельно</h2>
      <p className="text-sm text-gray-600">
        На время параллельного периода кабинет сам повторяет перенос по расписанию{' '}
        <code className="text-xs">{pattern}</code> и берёт настройки последнего применённого пакета.
        Повтор ничего не дублирует и не трогает поля, поправленные людьми.
      </p>
      <p className="text-sm text-gray-600">
        {paused
          ? 'Сейчас повтор выключен — переносы запускаются только вручную.'
          : 'Сейчас повтор включён. Выключите его, когда Битрикс24 отключат.'}
      </p>
      <div aria-live="polite" className={error ? 'text-sm text-red-600' : 'sr-only'}>
        {error ?? ''}
      </div>
      <Button type="button" onClick={() => void toggle()} disabled={pending}>
        {pending ? 'Сохраняем…' : paused ? 'Повторять еженедельно' : 'Выключить повтор'}
      </Button>
    </div>
  );
}
