'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { claimIntakeAction, closeCallIntakeAction } from '@/server-actions/intake';
import { CreateLeadFromSourceDialog, type LeadPrefill, type LeadSourceKind } from './create-lead-from-source-dialog';
import { QuickTaskDialog } from './quick-task-dialog';
import type { IntakeItem, IntakeSlaLevel, IntakeType } from '@/lib/services/intake/list';

/**
 * Этап 7 (ФТ-8.1/8.2) — таблица «Входящие в работу»: тип, от кого, суть,
 * ожидание с подсветкой SLA, ответственный, действия по типу строки.
 * «Привязать»/«Отклонить» — на карточке источника («Открыть», 1 клик).
 */

const TYPE_LABEL: Record<IntakeType, string> = {
  client_request: 'Заявка клиента',
  enrollment: 'Заявка на обучение',
  inbound: 'Обращение',
  call: 'Звонок'
};

const CLAIM_ERRORS: Record<string, string> = {
  already_assigned: 'Уже взято другим сотрудником.',
  lifecycle_violation: 'Единица уже разобрана.',
  not_found: 'Не найдено или недоступно.',
  forbidden: 'Нет доступа.',
  validation: 'Некорректный запрос.'
};

/** Человеческое «сколько ждёт»: минуты → часы → дни. */
export function waitingLabel(waitingMs: number): string {
  const minutes = Math.floor(waitingMs / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

/** «Открыть» → экран источника; inbox/calls живут только в кабинете менеджера. */
export function sourceHref(type: IntakeType, viewerPrefix: string): string {
  if (type === 'inbound') return '/manager/inbox';
  if (type === 'call') return '/manager/calls';
  if (type === 'enrollment') return `${viewerPrefix}/enrollments`;
  return `${viewerPrefix}/requests`;
}

const SLA_CLASS: Record<IntakeSlaLevel, string> = {
  ok: 'text-gray-600',
  warning: 'text-amber-600 font-medium',
  breach: 'text-red-600 font-semibold'
};

type LeadDialogState = { kind: LeadSourceKind; sourceId: string; prefill: LeadPrefill };
type TaskDialogState = { title: string; organizationId: string | null };

export function IntakeTable({
  items,
  viewerPrefix,
  currentUserId
}: {
  items: IntakeItem[];
  /** '/manager' | '/leader' | '/admin' — для ссылок «Открыть». */
  viewerPrefix: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [leadDialog, setLeadDialog] = useState<LeadDialogState | null>(null);
  const [taskDialog, setTaskDialog] = useState<TaskDialogState | null>(null);

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData, okMsg: string, id: string) {
    setBusyId(id);
    const res = await action(fd);
    setBusyId(null);
    if (!res.ok) {
      toast.error(CLAIM_ERRORS[res.error ?? ''] ?? 'Не удалось выполнить действие.');
      return;
    }
    toast.success(okMsg);
    startTransition(() => router.refresh());
  }

  function claim(item: IntakeItem) {
    const fd = new FormData();
    fd.set('type', item.type);
    fd.set('id', item.id);
    void run(claimIntakeAction, fd, 'Взято в работу.', item.id);
  }

  function closeCall(item: IntakeItem) {
    const fd = new FormData();
    fd.set('id', item.id);
    void run(closeCallIntakeAction, fd, 'Звонок закрыт.', item.id);
  }

  async function convertRequest(item: IntakeItem) {
    setBusyId(item.id);
    // Триаж ClientRequest — существующий API-роут (тот же, что очередь заявок).
    const res = await fetch(`/api/client-requests/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'convertToLead' })
    });
    setBusyId(null);
    if (!res.ok) {
      toast.error('Не удалось создать лид из заявки.');
      return;
    }
    const data = (await res.json().catch(() => null)) as { leadId?: string } | null;
    toast.success('Лид создан.');
    if (data?.leadId) router.push(`/manager/leads/${data.leadId}`);
    else startTransition(() => router.refresh());
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm font-medium text-[#111111]">Всё разобрано</p>
        <p className="text-sm text-gray-500 mt-1">Новые заявки, обращения и звонки появятся здесь автоматически.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-[#F3F4F6] text-left text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Тип</th>
            <th className="px-4 py-2 font-medium">От кого</th>
            <th className="px-4 py-2 font-medium">Суть</th>
            <th className="px-4 py-2 font-medium">Ждёт</th>
            <th className="px-4 py-2 font-medium">Ответственный</th>
            <th className="px-4 py-2 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const busy = busyId === item.id;
            const mine = item.responsibleUserId === currentUserId;
            return (
              <tr key={`${item.type}:${item.id}`} className="align-top">
                <td className="px-4 py-2.5">
                  <Badge tone="neutral">{TYPE_LABEL[item.type]}</Badge>
                </td>
                <td className="px-4 py-2.5 font-medium text-[#111111]">{item.from}</td>
                <td className="px-4 py-2.5 text-gray-600 max-w-md truncate">{item.essence}</td>
                <td className={`px-4 py-2.5 whitespace-nowrap ${SLA_CLASS[item.slaLevel]}`}>
                  {waitingLabel(item.waitingMs)}
                </td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                  {item.responsibleName ?? (item.responsibleUserId ? '…' : <span className="text-gray-400">нет</span>)}
                  {mine && <span className="text-xs text-gray-400"> (вы)</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {!item.responsibleUserId && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => claim(item)}>
                        Взять в работу
                      </Button>
                    )}
                    {item.type === 'client_request' && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void convertRequest(item)}>
                        Создать лид
                      </Button>
                    )}
                    {item.leadPrefill && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          setLeadDialog({
                            kind: item.type === 'call' ? 'call' : 'inbound',
                            sourceId: item.id,
                            prefill: item.leadPrefill!
                          })
                        }
                      >
                        Создать лид
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setTaskDialog({ title: item.taskTitle, organizationId: item.organizationId })}
                    >
                      Задача
                    </Button>
                    {item.type === 'call' && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => closeCall(item)}>
                        Закрыть
                      </Button>
                    )}
                    <Link
                      href={sourceHref(item.type, viewerPrefix)}
                      className="inline-flex items-center px-2 py-1 text-sm text-[#F97316] hover:underline"
                    >
                      Открыть →
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {leadDialog && (
        <CreateLeadFromSourceDialog
          kind={leadDialog.kind}
          sourceId={leadDialog.sourceId}
          prefill={leadDialog.prefill}
          onClose={() => setLeadDialog(null)}
        />
      )}
      {taskDialog && (
        <QuickTaskDialog
          titlePrefill={taskDialog.title}
          organizationId={taskDialog.organizationId}
          currentUserId={currentUserId}
          onClose={() => setTaskDialog(null)}
        />
      )}
    </div>
  );
}
