import React from 'react';
import Link from 'next/link';
import { INTAKE_CHANNELS, INTAKE_CHANNEL_LABEL, type IntakeChannel } from '@/lib/intake/intakeView';

/**
 * Фильтр «Входящих обращений» по каналу и «Только важные» (этап 7 ТЗ
 * 13.10.2026, `У-318`): ссылки, а не скрипт — состояние в адресе, им можно
 * поделиться. Смена фильтра сбрасывает страницу списка; прочие параметры
 * (ответственный) сохраняются.
 */
export function IntakeChannelFilter({
  basePath,
  searchParams,
  channel,
  onlyImportant,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  channel: IntakeChannel | undefined;
  onlyImportant: boolean;
}) {
  const href = (patch: { channel?: IntakeChannel | null; important?: boolean }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === 'string' && v && k !== 'skip' && k !== 'channel' && k !== 'important') {
        q.set(k, v);
      }
    }
    const nextChannel = patch.channel === undefined ? channel : patch.channel;
    const nextImportant = patch.important === undefined ? onlyImportant : patch.important;
    if (nextChannel) q.set('channel', nextChannel);
    if (nextImportant) q.set('important', '1');
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${
      active
        ? 'border-[#F97316] bg-[#F97316] text-white'
        : 'border-gray-200 bg-white text-[#111111] hover:border-[#F97316]'
    }`;

  return (
    <nav aria-label="Фильтр входящих обращений" className="flex flex-wrap items-center gap-2">
      <Link
        href={href({ channel: null })}
        aria-current={!channel ? 'page' : undefined}
        className={pill(!channel)}
      >
        Все каналы
      </Link>
      {INTAKE_CHANNELS.map((c) => (
        <Link
          key={c}
          href={href({ channel: c })}
          aria-current={channel === c ? 'page' : undefined}
          className={pill(channel === c)}
        >
          {INTAKE_CHANNEL_LABEL[c]}
        </Link>
      ))}
      <Link
        href={href({ important: !onlyImportant })}
        aria-pressed={onlyImportant}
        className={`ml-auto ${pill(onlyImportant)}`}
      >
        ★ Только важные
      </Link>
    </nav>
  );
}
