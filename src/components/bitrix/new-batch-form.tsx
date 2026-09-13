'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBitrixBatchAction } from '@/server-actions/admin/bitrix';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { batchHref } from './hrefs';

/**
 * Форма «Новый пакет» (`У-193`, вкладка «Пакеты»).
 *
 * Пакет — это не «нажать и ждать»: сначала всегда сухой прогон, который
 * ничего не пишет и показывает, что получится. Поэтому главная кнопка
 * называется «Посчитать предпросмотр», а не «Перенести»: человек должен
 * понимать, что данные ещё не тронуты.
 */
export type ManagerOption = { id: string; name: string };
export type UploadedFileKey = { key: string; name: string; entity: string };

const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.',
  invalid: 'Проверьте настройки пакета: для переноса из файлов нужны загруженные выгрузки.',
  not_found: 'Пакет не найден.',
  mapping_incomplete: 'Сначала сопоставьте все стадии сделок и статусы лидов.',
};

export function NewBatchForm({
  managers,
  fileKeys,
  hasConnection,
}: {
  managers: ManagerOption[];
  fileKeys: UploadedFileKey[];
  hasConnection: boolean;
}) {
  const router = useRouter();
  const [source, setSource] = useState<'rest' | 'file'>(hasConnection ? 'rest' : 'file');
  const { formAction, pending, errorText } = useFormAction<{ batchId?: string }>({
    action: createBitrixBatchAction,
    errorMap: ERROR_LABELS,
    onSuccess: (data) => {
      if (data.batchId) router.push(batchHref(data.batchId));
    },
  });

  const fileSourceReady = fileKeys.length > 0;
  const disabled = pending || (source === 'rest' ? !hasConnection : !fileSourceReady);

  return (
    <form action={formAction} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="font-medium text-gray-900">Новый пакет</h2>
        <p className="text-sm text-gray-600">
          Сначала посчитаем предпросмотр: что перенесётся, что обновится и о чём нужно решить.
          Данные при этом не меняются.
        </p>
      </div>

      <input type="hidden" name="fileKeys" value={JSON.stringify(fileKeys)} />

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="bitrix-batch-source" className="text-xs text-gray-500">
            Откуда берём данные
          </label>
          <Select
            id="bitrix-batch-source"
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value === 'file' ? 'file' : 'rest')}
          >
            <option value="rest">Портал по вебхуку</option>
            <option value="file">Загруженные выгрузки</option>
          </Select>
        </div>

        <div className="flex flex-col gap-0.5">
          <label htmlFor="bitrix-batch-manager" className="text-xs text-gray-500">
            Менеджер по умолчанию
          </label>
          <Select id="bitrix-batch-manager" name="defaultManagerId" defaultValue="">
            <option value="">— не выбран —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-gray-500">
            Ему достанутся записи, чей ответственный не нашёлся среди сотрудников.
          </p>
        </div>

        <div className="flex flex-col gap-0.5">
          <label htmlFor="bitrix-batch-from" className="text-xs text-gray-500">
            Период с
          </label>
          <input
            id="bitrix-batch-from"
            type="date"
            name="from"
            className="border border-gray-200 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor="bitrix-batch-to" className="text-xs text-gray-500">
            по
          </label>
          <input
            id="bitrix-batch-to"
            type="date"
            name="to"
            className="border border-gray-200 rounded px-2 py-1 text-sm"
          />
          <p className="text-xs text-gray-500">Пустые даты — переносим всю историю.</p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="openOnly" />
          Только открытые сделки и незавершённые задачи
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="withFiles" defaultChecked />
          Переносить файлы, прикреплённые к сделкам и компаниям
        </label>
      </div>

      {source === 'rest' && !hasConnection && (
        <p className="text-sm text-amber-700">
          Портал не подключён: заполните адрес и вебхук на вкладке «Подключение» — или переносите из
          выгрузок.
        </p>
      )}
      {source === 'file' && !fileSourceReady && (
        <p className="text-sm text-amber-700">
          Сначала загрузите выгрузки формой выше — тогда пакет из файлов можно будет посчитать.
        </p>
      )}

      <p role="alert" className={errorText ? 'text-sm text-red-600' : 'sr-only'}>
        {errorText}
      </p>

      <Button type="submit" disabled={disabled}>
        {pending ? 'Считаем…' : 'Посчитать предпросмотр'}
      </Button>
    </form>
  );
}
