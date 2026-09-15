import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import type { TaskDetail } from '@/lib/services/tasks/detail';
import { TaskChecklist } from './task-checklist';
import { TaskComments } from './task-comments';

/**
 * Карточка задачи (`У-218`) — один экран на два кабинета сотрудников.
 *
 * Общий компонент здесь допустим по `Р-23`: он строго презентационный и
 * принимает доменный тип `TaskDetail`, а данные и права дал сервис роли. Так
 * же выполняется правило зеркала (§0.2): у менеджера и руководителя карточка
 * задачи обязана выглядеть одинаково, различаться может только набор задач,
 * которые роль видит.
 *
 * У администратора задач нет вовсе — это записанное исключение зеркала, а не
 * забытый экран.
 */

const PRIORITY_RU: Record<string, string> = {
  low: 'Низкий',
  medium: 'Обычный',
  high: 'Высокий',
};

function LinkHref(kind: TaskDetail['links'][number]['kind'], id: string, cabinet: Cabinet): string {
  switch (kind) {
    case 'order':
      return `/${cabinet}/orders/${id}`;
    case 'organization':
      return `/${cabinet}/organizations/${id}`;
    case 'lead':
      return `/${cabinet}/leads/${id}`;
    default:
      return `/${cabinet}/deals?dealId=${id}`;
  }
}

type Cabinet = 'manager' | 'leader';

export function TaskPageScreen({ task, cabinet }: { task: TaskDetail; cabinet: Cabinet }) {
  const crumbs = buildCabinetBreadcrumbs(cabinet, `/${cabinet}/tasks`, [{ label: task.title }]);
  const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : null;
  const overdue = task.dueDate !== null && !task.completedAt && new Date(task.dueDate) < new Date();

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={crumbs}
        title={task.title}
        subtitle="Что нужно сделать, кто делает и к какому сроку. Здесь же обсуждение и шаги."
        action={
          <div className="flex items-center gap-2">
            <Badge tone={task.completedAt ? 'success' : overdue ? 'danger' : 'neutral'}>
              {task.completedAt ? 'Выполнена' : overdue ? 'Просрочена' : task.columnName}
            </Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-[#111111]">Описание</h2>
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm text-gray-700">{task.description}</p>
            ) : (
              <p className="text-sm text-gray-500">Описания нет — всё в названии задачи.</p>
            )}
          </section>

          <TaskChecklist taskId={task.id} items={task.checklist} />
          <TaskComments taskId={task.id} comments={task.comments} />
        </div>

        <aside className="space-y-4">
          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">Коротко</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Срок</dt>
                <dd className={overdue ? 'text-red-600' : 'text-[#111111]'}>{due ?? 'не задан'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Приоритет</dt>
                <dd className="text-[#111111]">
                  {task.priority ? (PRIORITY_RU[task.priority] ?? task.priority) : 'обычный'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Исполнители</dt>
                <dd className="text-right text-[#111111]">
                  {task.assignees.length > 0
                    ? task.assignees.map((a) => a.name).join(', ')
                    : 'никто не назначен'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Автор</dt>
                <dd className="text-[#111111]">{task.createdByName}</dd>
              </div>
            </dl>
            {task.createdByRuleId && (
              <p className="text-xs text-gray-500">Задача создана правилом автоматизации.</p>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">Связи</h2>
            {task.links.length === 0 ? (
              <p className="text-sm text-gray-500">Задача ни к чему не привязана.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {task.links.map((l) => (
                  <li key={`${l.kind}:${l.id}`}>
                    <Link
                      href={LinkHref(l.kind, l.id, cabinet)}
                      className="text-[#EA580C] hover:underline"
                    >
                      {l.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">История</h2>
            {task.history.length === 0 ? (
              <p className="text-sm text-gray-500">Записей пока нет.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {task.history.map((h) => (
                  <li key={h.id} className="flex flex-col">
                    <span className="text-[#111111]">{h.action}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(h.at).toLocaleString('ru-RU')}
                      {h.actorName ? ` · ${h.actorName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
