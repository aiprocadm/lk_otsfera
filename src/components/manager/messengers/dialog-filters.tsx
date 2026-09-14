import React from 'react';
import Link from 'next/link';
import { DIALOG_CHANNELS, DIALOG_CHANNEL_LABELS } from '@/lib/services/messengers/channels';
import { DIALOG_STATUS_LABELS } from '@/lib/services/messengers/dialogStatus';

/**
 * Фильтры списка диалогов (спека 2026-09-12 §5.1) — ссылки с query-параметрами,
 * без клиентского JS; тот же приём, что у фильтров «Входящих писем».
 */

const STATUSES: { value: string; label: string }[] = [
  { value: 'waiting_staff', label: DIALOG_STATUS_LABELS.waiting_staff },
  { value: 'waiting_client', label: DIALOG_STATUS_LABELS.waiting_client },
  { value: 'open', label: DIALOG_STATUS_LABELS.open },
  { value: 'closed', label: DIALOG_STATUS_LABELS.closed },
];

/** Фильтр по ответственному (`У-206`). «Все» — значение по умолчанию. */
const ASSIGNEES: { value: string; label: string }[] = [
  { value: 'mine', label: 'Мои' },
  { value: 'unassigned', label: 'Без ответственного' },
];

function buildHref(
  channel: string | undefined,
  status: string | undefined,
  assignee: string | undefined
): string {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (status) params.set('status', status);
  if (assignee) params.set('assignee', assignee);
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
  assignee,
}: {
  channel?: string | undefined;
  status?: string | undefined;
  assignee?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:gap-8">
      <FilterGroup
        label="Канал"
        options={DIALOG_CHANNELS.map((c) => ({ value: c, label: DIALOG_CHANNEL_LABELS[c] }))}
        active={channel}
        buildFor={(value) => buildHref(value, status, assignee)}
      />
      <FilterGroup
        label="Состояние"
        options={STATUSES}
        active={status}
        buildFor={(value) => buildHref(channel, value, assignee)}
      />
      <FilterGroup
        label="Ответственный"
        options={ASSIGNEES}
        active={assignee}
        buildFor={(value) => buildHref(channel, status, value)}
      />
    </div>
  );
}
