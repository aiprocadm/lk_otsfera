'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { moveTaskAction } from '@/server-actions/tasks';
import type { TaskBoard as TaskBoardData, TaskCard } from '@/lib/services/tasks/board';
import { TaskDialog, type TaskFormOptions } from '@/components/tasks/task-dialog';

const MOVE_ERRORS: Record<string, string> = {
  invalid_column: 'Неизвестная колонка.',
  not_found: 'Задача не найдена или недоступна.',
  forbidden: 'Нет доступа.'
};

const PRIORITY_LABEL: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { low: 'neutral', medium: 'warning', high: 'danger' };

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString('ru-RU');
}

export function TaskBoard({ board, options }: { board: TaskBoardData; options: TaskFormOptions }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ target: TaskCard | null } | null>(null);

  async function doMove(taskId: string, toColumnId: string) {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('toColumnId', toColumnId);
    const res = await moveTaskAction(fd);
    if (!res.ok) {
      toast.error(MOVE_ERRORS[res.error] ?? 'Не удалось переместить задачу.');
      return;
    }
    toast.success('Задача перемещена.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing({ target: null })}>
          + Новая задача
        </Button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {board.board.map((col) => (
          <div
            key={col.column.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(col.column.id);
            }}
            onDragLeave={() => setDragOver((s) => (s === col.column.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const taskId = e.dataTransfer.getData('text/plain');
              if (taskId) void doMove(taskId, col.column.id);
            }}
            className={`min-w-[280px] w-[280px] shrink-0 rounded-xl p-3 transition-colors ${
              dragOver === col.column.id ? 'bg-[#FFF7ED] ring-2 ring-[#F97316]' : 'bg-[#F3F4F6]'
            }`}
          >
            {/* Полоска рендерится ВСЕГДА (transparent-плейсхолдер) — иначе заголовки цветных
                и бесцветных колонок разъезжаются по вертикали. Цвет — data-driven из БД
                (TaskColumnView.color), не brand-hex UI-палитры. */}
            <div
              aria-hidden
              data-testid="column-color-strip"
              className="h-1 rounded-full mb-2"
              style={{ background: col.column.color ?? 'transparent' }}
            />
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[#111111]">{col.column.name}</h3>
              <Badge tone="neutral">{col.cards.length}</Badge>
            </div>
            <div className="space-y-2">
              {col.cards.map((card) => (
                <article
                  key={card.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                  onClick={() => setEditing({ target: card })}
                  className="bg-white border border-gray-200 rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm hover:border-[#F97316]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[#111111]">{card.title}</p>
                    {card.priority && (
                      <Badge tone={PRIORITY_TONE[card.priority] ?? 'neutral'}>{PRIORITY_LABEL[card.priority]}</Badge>
                    )}
                  </div>
                  {(card.linkedOrganizationName || card.linkedOrderTitle || card.linkedLeadSubject || card.linkedDealTitle) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {[
                        card.linkedOrganizationName,
                        card.linkedOrderTitle,
                        card.linkedLeadSubject && `Лид: ${card.linkedLeadSubject}`,
                        card.linkedDealTitle && `Сделка: ${card.linkedDealTitle}`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                    <span>{card.assigneeNames.length > 0 ? card.assigneeNames.join(', ') : 'без исполнителя'}</span>
                    {fmtDate(card.dueDate) && <span>до {fmtDate(card.dueDate)}</span>}
                  </div>
                </article>
              ))}
              {col.cards.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Пусто</p>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TaskDialog
          key={editing.target?.id ?? 'new'}
          target={editing.target}
          columns={board.columns}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}
