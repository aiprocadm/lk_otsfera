import React from 'react';
import Link from 'next/link';
import type { QuickTask } from '@/lib/quickTasks';

/**
 * Блок «Частые задачи» на стартовом экране (`У-71`, этап 9).
 *
 * Строго презентационный и domain-agnostic (принимает готовый список) —
 * поэтому сознательно общий для всех кабинетов, как исключение
 * sibling-паттерна (§4 CLAUDE.md). Состав задач собирает `quickTasksFor`.
 *
 * Разметка — тот же приём, что у навигатора обмена с 1С: плитка отвечает на
 * вопрос «что вы хотите сделать», а не называет раздел.
 */
export function QuickTasks({ tasks }: { tasks: QuickTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5" data-testid="quick-tasks">
      <h2 className="font-semibold text-[#111111]">Частые задачи</h2>
      <p className="text-xs text-gray-500 mt-0.5">С чего обычно начинают работу в этом кабинете.</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
        {tasks.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="block h-full border border-gray-200 rounded-lg p-3 hover:border-[#F97316] transition-colors"
              data-testid={`quick-task-${t.href}`}
            >
              <div className="text-sm font-medium text-[#111111]">{t.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t.hint}</div>
              <div className="text-xs text-[#F97316] mt-2">Перейти →</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
