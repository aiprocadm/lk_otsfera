import React from 'react';
import Link from 'next/link';

/**
 * Фильтры инбокса — link-based query-param навигация (без клиентского JS),
 * тот же паттерн, что табы `org-card-tabs.tsx`. Сервер-компонент.
 */

const CHANNELS: { value: string; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'max', label: 'MAX' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  // Этап 9 (ФТ-11.1): вопросы из кабинета клиента.
  { value: 'cabinet', label: 'Из кабинета' },
];

const STATUSES: { value: string; label: string }[] = [
  { value: 'unresolved', label: 'Не распознано' },
  { value: 'bound', label: 'Привязано' },
  { value: 'archived', label: 'В архиве' },
];

function buildHref(channel: string | undefined, status: string | undefined): string {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (status) params.set('status', status);
  const qs = params.toString();
  return qs ? `/manager/inbox?${qs}` : '/manager/inbox';
}

function FilterGroup({
  label,
  options,
  active,
  buildFor,
}: {
  label: string;
  options: { value: string; label: string }[];
  active: string | undefined;
  buildFor: (value: string | undefined) => string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <Link
          href={buildFor(undefined)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !active
              ? 'bg-[#F97316] text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Все
        </Link>
        {options.map((opt) => (
          <Link
            key={opt.value}
            href={buildFor(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active === opt.value
                ? 'bg-[#F97316] text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function InboxFiltersBar({
  channel,
  status,
}: {
  channel?: string | undefined;
  status?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:gap-8">
      <FilterGroup
        label="Канал"
        options={CHANNELS}
        active={channel}
        buildFor={(value) => buildHref(value, status)}
      />
      <FilterGroup
        label="Статус"
        options={STATUSES}
        active={status}
        buildFor={(value) => buildHref(channel, value)}
      />
    </div>
  );
}
