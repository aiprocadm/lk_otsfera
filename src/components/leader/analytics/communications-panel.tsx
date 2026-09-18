import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import type { CommunicationsResult } from '@/lib/services/leader/communications';

/**
 * «Коммуникации» (`У-243`, этап 7): как быстро отвечаем и что со звонками.
 *
 * Оговорка про ответственного написана прямо на экране (`Р-Э7-7`): истории
 * назначений в системе нет, и диалог относится к тому, кто отвечает за него
 * сейчас. Без этой строки цифра выглядела бы точнее, чем есть.
 */
function minutes(v: number | null): string {
  if (v === null) return '—';
  if (v < 60) return `${v} мин`;
  const h = Math.floor(v / 60);
  const m = Math.round(v - h * 60);
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function CommunicationsPanel({ data }: { data: CommunicationsResult }) {
  const hasDialogs = data.byChannel.length > 0;
  const hasCalls = data.calls.inbound + data.calls.outbound > 0;

  if (!hasDialogs && !hasCalls) {
    return (
      <div data-testid="communications-panel">
        <EmptyState
          icon="💬"
          title="За этот период переписки и звонков не было"
          message="Выберите другой месяц вверху страницы — или подождите, пока клиенты напишут."
          className="p-6"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="communications-panel">
      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">По каналам</h3>
        <p className="text-xs text-gray-500">
          Первый ответ считается от первого сообщения клиента до первого ответа на него. Просрочка —
          дольше {data.slaHours} ч, как настроено у компании.
        </p>
        {hasDialogs ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <th className="py-2">Канал</th>
                <th className="py-2">Переписок</th>
                <th className="py-2">Ответили</th>
                <th className="py-2">Первый ответ</th>
                <th className="py-2">Просрочка</th>
                <th className="py-2">Без ответа</th>
              </tr>
            </thead>
            <tbody>
              {data.byChannel.map((r) => (
                <tr key={r.channel} className="border-b border-gray-100">
                  <td className="py-2">{r.channelLabel}</td>
                  <td className="py-2">{r.dialogs}</td>
                  <td className="py-2">{r.answered}</td>
                  <td className="py-2">{minutes(r.avgFirstResponseMin)}</td>
                  <td className={r.overSla > 0 ? 'py-2 text-red-700' : 'py-2'}>{r.overSla}</td>
                  <td className={r.waitingNoAnswer > 0 ? 'py-2 text-red-700' : 'py-2'}>
                    {r.waitingNoAnswer}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">Переписки за период не было.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">
          По сотрудникам
        </h3>
        <p className="text-xs text-gray-500">
          Переписка относится к тому, кто отвечает за неё сейчас: истории назначений система не
          хранит.
        </p>
        {data.byManager.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {data.byManager.map((r) => (
              <li key={r.managerId ?? 'none'} className="flex flex-wrap gap-x-3">
                <span className="min-w-[10rem] text-gray-700">{r.managerName}</span>
                <span className="text-gray-500">переписок: {r.dialogs}</span>
                <span className="text-gray-500">
                  первый ответ: {minutes(r.avgFirstResponseMin)}
                </span>
                {r.overSla > 0 && <span className="text-red-700">просрочек: {r.overSla}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Переписки за период не было.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">Звонки</h3>
        <p className="text-sm text-gray-700" data-testid="calls-summary">
          Входящих: {data.calls.inbound} · приняли: {data.calls.answered} ·{' '}
          <span className={data.calls.missed > 0 ? 'text-red-700' : undefined}>
            пропустили: {data.calls.missed}
          </span>{' '}
          · исходящих: {data.calls.outbound}
        </p>
        <p className="text-xs text-gray-500">
          Принятым считается звонок, на который ответили. Разбор звонка — отдельное дело, он живёт
          во «Входящих в работу».
        </p>
      </section>
    </div>
  );
}
