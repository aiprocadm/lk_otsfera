'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { CRON_PRESETS, nextCronRuns, parseCron } from '@/lib/jobs/cron';
import { saveSchedulePatternAction } from '@/server-actions/admin/syncControl';
import { toast } from '@/lib/ui/toast';

/**
 * Редактор расписания задачи (`У-125`).
 *
 * Раньше расписание было литералом в коде: изменить «раз в 15 минут» на «раз в
 * час» мог только программист выкладкой. Теперь это поле — но пять звёздочек
 * читаются плохо, поэтому рядом всегда стоят **ближайшие три запуска**:
 * человек видит не выражение, а даты, и сразу замечает, что задал не то.
 *
 * Проверка идёт на клиенте (сразу) и на сервере (по-настоящему): клиентская
 * нужна для предпросмотра, серверная — потому что клиенту верить нельзя.
 */
export function SyncScheduleEditor({
  schedulerId,
  tz,
  current,
  isDefault,
}: {
  schedulerId: string;
  tz: string;
  current: string;
  /** Действует ли умолчание из кода — тогда «сбросить» показывать незачем. */
  isDefault: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => parseCron(value), [value]);
  const preview = useMemo(
    () => (parsed.ok ? nextCronRuns(value, tz, new Date(), 3) : []),
    [parsed.ok, value, tz]
  );

  function save(next: string) {
    startTransition(async () => {
      const res = await saveSchedulePatternAction(schedulerId, next);
      if (res.ok) {
        toast.success('Расписание сохранено. Оно применится при следующем запуске обмена.');
        setOpen(false);
        return;
      }
      toast.error(
        res.error === 'invalid_cron'
          ? (res.message ?? 'Расписание не разобрано.')
          : 'Неизвестная задача.'
      );
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-600 border border-gray-300 hover:border-gray-400 rounded-lg px-2.5 py-1"
      >
        Расписание: <code className="font-mono">{current}</code>
      </button>
    );
  }

  return (
    <div className="w-full mt-2 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setValue(p.value)}
            disabled={pending}
            className={`text-xs rounded-full px-2.5 py-1 border ${
              value === p.value
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="block text-xs text-gray-500 mb-1">
          Расписание (минуты часы день месяц день-недели)
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#F97316]"
        />
      </label>

      {parsed.ok ? (
        <div className="text-xs text-gray-600">
          <div className="text-gray-500 mb-0.5">Ближайшие запуски:</div>
          {preview.length > 0 ? (
            <ul className="space-y-0.5">
              {preview.map((d) => (
                <li key={d.toISOString()} className="font-mono">
                  {new Intl.DateTimeFormat('ru-RU', {
                    timeZone: tz,
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(d)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-amber-700">
              Ближайшие четыре года запусков не будет — проверьте выражение.
            </div>
          )}
        </div>
      ) : (
        <p role="alert" className="text-xs text-red-600">
          {parsed.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => save(value)}
          disabled={pending || !parsed.ok}
          className="text-xs font-medium px-3 py-1.5 bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Сохранение…' : 'Сохранить'}
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={() => save('')}
            disabled={pending}
            className="text-xs text-gray-600 underline disabled:opacity-50"
          >
            вернуть стандартное
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setValue(current);
            setOpen(false);
          }}
          disabled={pending}
          className="text-xs text-gray-500 underline disabled:opacity-50"
        >
          отмена
        </button>
      </div>
    </div>
  );
}
