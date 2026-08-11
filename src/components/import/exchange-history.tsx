'use client';

import React, { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import {
  CHANNEL_LABEL,
  type ExchangeChannel,
  type ExchangeHistoryItem,
} from '@/lib/services/import/history';

/**
 * Общая история обмена с 1С (`У-48`, этап 7).
 *
 * До этого история была только у Excel-канала: загрузив выписку, человек не мог
 * даже убедиться, что файл вообще приняли. Здесь три канала в одном списке с
 * фильтром; откат живёт на своей странице — сюда он приедет вместе с `У-59`.
 */
const STATUS_RU: Record<string, string> = {
  committed: 'выполнен',
  rolled_back: 'откачен',
  rollback_partial: 'откачен частично',
  success: 'успешно',
  warn: 'с замечаниями',
  error: 'ошибка',
};

const ROLLBACK_RU: Record<ExchangeHistoryItem['rollback'], string> = {
  available: 'можно отменить',
  expired: 'срок отмены истёк',
  already_rolled_back: 'уже отменён',
  unsupported: 'отмена не предусмотрена',
};

const FILTERS: Array<{ value: ExchangeChannel | 'all'; label: string }> = [
  { value: 'all', label: 'Все каналы' },
  { value: 'excel', label: CHANNEL_LABEL.excel },
  { value: 'statement', label: CHANNEL_LABEL.statement },
  { value: 'auto', label: CHANNEL_LABEL.auto },
];

/** Итоги батча — только числа, без сырого JSON на экране. */
function summarize(counts: unknown): string {
  if (!counts || typeof counts !== 'object') return '';
  const pairs = Object.entries(counts as Record<string, unknown>).filter(
    ([, v]) => typeof v === 'number' && v > 0
  );
  if (!pairs.length) return '';
  const LABEL: Record<string, string> = {
    totalRows: 'строк',
    imported: 'импортировано',
    refunds: 'возвратов',
    queued: 'в очередь',
    excluded: 'исключено',
    parseErrors: 'ошибок разбора',
    created: 'создано',
    updated: 'обновлено',
    skipped: 'пропущено',
  };
  return pairs.map(([k, v]) => `${LABEL[k] ?? k}: ${v as number}`).join(' · ');
}

export function ExchangeHistory({ items }: { items: ExchangeHistoryItem[] }) {
  const [channel, setChannel] = useState<ExchangeChannel | 'all'>('all');
  const visible = useMemo(
    () => (channel === 'all' ? items : items.filter((i) => i.channel === channel)),
    [items, channel]
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-gray-700" htmlFor="history-channel">
          Канал
        </label>
        <select
          id="history-channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ExchangeChannel | 'all')}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F97316]"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">Записей: {visible.length}</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="🗂"
          message={
            channel === 'all'
              ? 'Обменов пока не было — загрузите файл на вкладке «Загрузка Excel» или «Выписка».'
              : 'По этому каналу записей нет — выберите «Все каналы».'
          }
        />
      ) : (
        <ul className="space-y-2" data-testid="exchange-history-list">
          {visible.map((item) => {
            const numbers = summarize(item.counts);
            return (
              <li
                key={`${item.channel}-${item.id}`}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[#111111]">{item.title}</span>
                  <span className="text-xs text-gray-500">{CHANNEL_LABEL[item.channel]}</span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-gray-500">Когда</dt>
                    <dd className="text-[#111111]">{fmtDateTime(item.createdAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">Кто</dt>
                    <dd className="text-[#111111]">{item.authorName ?? 'по расписанию'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">Итог</dt>
                    <dd className="text-[#111111]">{STATUS_RU[item.status] ?? item.status}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">Отмена</dt>
                    <dd className="text-[#111111]">{ROLLBACK_RU[item.rollback]}</dd>
                  </div>
                  {numbers && (
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="text-gray-500">Числа</dt>
                      <dd className="text-[#111111]">{numbers}</dd>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
