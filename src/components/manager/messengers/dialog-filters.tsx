import React from 'react';
import Link from 'next/link';
import { MESSENGER_CHANNELS, MESSENGER_LABELS } from '@/lib/services/messengers/channels';

/**
 * Фильтры списка диалогов (спека 2026-09-12 §5.1) — ссылки с query-параметрами,
 * без клиентского JS; тот же приём, что у фильтров «Входящих писем».
 */

const STATUSES: { value: string; label: string }[] = [
  { value: 'open', label: 'Открытые' },
  { value: 'closed', label: 'Закрытые' },
];

function buildHref(channel: string | undefined, status: string | undefined): string {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (status) params.set('status', status);
  const qs = params.toString();
  return qs ? `/manager/messengers?${qs}` : '/manager/messengers';
}

function Pill({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </Link>
  );
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
        <Pill href={buildFor(undefined)} active={!active}>
          Все
        </Pill>
        {options.map((opt) => (
          <Pill key={opt.value} href={buildFor(opt.value)} active={active === opt.value}>
            {opt.label}
          </Pill>
        ))}
      </div>
    </div>
  );
}

export function DialogFiltersBar({
  channel,
  status,
}: {
  channel?: string | undefined;
  status?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:gap-8">
      <FilterGroup
        label="Мессенджер"
        options={MESSENGER_CHANNELS.map((c) => ({ value: c, label: MESSENGER_LABELS[c] }))}
        active={channel}
        buildFor={(value) => buildHref(value, status)}
      />
      <FilterGroup
        label="Состояние"
        options={STATUSES}
        active={status}
        buildFor={(value) => buildHref(channel, value)}
      />
    </div>
  );
}
