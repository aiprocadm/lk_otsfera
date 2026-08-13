import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { QuickTasks } from '@/components/dashboard/quick-tasks';

/**
 * Блок «Частые задачи» (`У-71`) — презентационный, поэтому проверяем то, что
 * видит человек: заголовок, пояснение и рабочие ссылки.
 */
const TASKS = [
  { href: '/partner/enrollments', title: 'Подать заявку на обучение', hint: 'Список сотрудников' },
  { href: '/partner/finance', title: 'Проверить начисления', hint: 'Комиссия по периодам' },
];

describe('QuickTasks (У-71)', () => {
  it('показывает заголовок, пояснение и все плитки со ссылками', () => {
    const html = renderToString(<QuickTasks tasks={TASKS} />);
    expect(html).toContain('Частые задачи');
    // §15: подзаголовок объясняет, зачем блок.
    expect(html).toContain('С чего обычно начинают');
    expect(html).toContain('Подать заявку на обучение');
    expect(html).toContain('href="/partner/enrollments"');
    expect(html).toContain('Комиссия по периодам');
    // Плитка — действие, поэтому у неё есть явный призыв.
    expect(html).toContain('Перейти');
  });

  it('пустой список не рисует пустую карточку', () => {
    // Такое возможно, если все разделы роли выключены флагами: пустая рамка
    // с заголовком «Частые задачи» была бы шумом.
    expect(renderToString(<QuickTasks tasks={[]} />)).toBe('');
  });
});
