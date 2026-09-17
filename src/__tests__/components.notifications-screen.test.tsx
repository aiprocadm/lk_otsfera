// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Notification } from '@prisma/client';
import { NotificationsScreen } from '@/components/notifications/notifications-screen';

/**
 * Экран «Уведомления» (`У-228`): три вопроса §15, пустое состояние со
 * словами (`У-74`), значок и подпись типа из реестра (`У-233`), ссылка строки
 * в кабинет роли, фильтры ссылками в адресе.
 */

vi.mock('@/components/notifications/mark-all-read-button', () => ({
  MarkAllReadButton: (p: { unreadTotal: number }) =>
    React.createElement(
      'button',
      { 'data-testid': 'mark-all', disabled: p.unreadTotal === 0 },
      'Отметить все'
    ),
}));

const row = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  createdAt: new Date('2026-09-16T10:00:00.000Z'),
  updatedAt: new Date('2026-09-16T10:00:00.000Z'),
  userId: 'u1',
  organizationId: null,
  partnerId: null,
  type: 'task_assigned',
  title: 'Назначена задача',
  body: 'Проверить документы',
  isRead: false,
  meta: { url: '/manager/tasks/t1' },
  ...over,
});

const base = {
  basePath: '/manager/notifications',
  homeHref: '/manager',
  total: 1,
  unreadTotal: 1,
  page: 1,
  pageSize: 50,
  typeOptions: ['task_assigned', 'task_due_soon'] as never[],
  unreadOnly: false,
  type: null,
  searchParams: {},
};

describe('NotificationsScreen', () => {
  it('три вопроса: заголовок, подзаголовок в одну строку, главное действие', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row()]} />);
    expect(screen.getByRole('heading', { name: 'Уведомления' })).toBeTruthy();
    expect(screen.getByText(/Всё, что произошло/)).toBeTruthy();
    expect(screen.getByTestId('mark-all')).toBeTruthy();
  });

  it('строка: значок и подпись типа из реестра, «новое» у непрочитанного, ссылка в кабинет', () => {
    const { container } = render(<NotificationsScreen role="manager" {...base} rows={[row()]} />);
    expect(screen.getByText('✔')).toBeTruthy();
    expect(screen.getByText(/Назначена задача ·/)).toBeTruthy();
    expect(screen.getByText('новое')).toBeTruthy();
    expect(container.querySelector('a[href="/manager/tasks/t1"]')).toBeTruthy();
  });

  it('прочитанная строка — без пометки «новое»', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row({ isRead: true })]} />);
    expect(screen.queryByText('новое')).toBeNull();
  });

  it('незнакомый тип не роняет ленту: точка вместо значка, ключ вместо подписи', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row({ type: 'что-то_новое' })]} />);
    expect(screen.getByText('•')).toBeTruthy();
    expect(screen.getByText(/что-то_новое ·/)).toBeTruthy();
  });

  it('пусто без фильтра — фраза пакета и кнопка «На главную» (`У-74`)', () => {
    const { container } = render(
      <NotificationsScreen role="partner" {...base} rows={[]} total={0} unreadTotal={0} />
    );
    expect(screen.getByText(/Пока ничего не произошло/)).toBeTruthy();
    expect(container.querySelector('a[href="/manager"]')).toBeTruthy();
  });

  it('пусто ПО ФИЛЬТРУ — объясняет, что снять фильтр, и ведёт на полный список', () => {
    const { container } = render(
      <NotificationsScreen role="manager" {...base} rows={[]} total={0} unreadOnly />
    );
    expect(screen.getByText(/Снимите фильтр/)).toBeTruthy();
    expect(container.querySelector('a[href="/manager/notifications"]')).toBeTruthy();
  });

  it('фильтры — ссылки в адрес; активный помечен aria-current', () => {
    const { container } = render(
      <NotificationsScreen
        role="manager"
        {...base}
        rows={[row()]}
        unreadOnly
        type={'task_assigned' as never}
      />
    );
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(2); // «Непрочитанные» и тип
    expect(
      container.querySelector('a[href="/manager/notifications?type=task_assigned"]')
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/manager/notifications?unread=1&type=task_due_soon"]')
    ).toBeTruthy();
  });

  it('счётчик непрочитанных стоит прямо в фильтре', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row()]} unreadTotal={4} />);
    expect(screen.getByText('Непрочитанные (4)')).toBeTruthy();
  });

  it('у слушателя нет ни фильтра типов, ни ссылок в строках', () => {
    const { container } = render(
      <NotificationsScreen
        role="student"
        {...base}
        basePath="/student/notifications"
        homeHref="/student"
        typeOptions={[]}
        rows={[row()]}
      />
    );
    expect(screen.queryByText('Тип')).toBeNull();
    expect(container.querySelector('a[href="/manager/tasks/t1"]')).toBeNull();
  });

  it('постраничность появляется только когда строк больше страницы', () => {
    const { container, rerender } = render(
      <NotificationsScreen role="manager" {...base} rows={[row()]} total={50} />
    );
    expect(
      container.querySelector(
        'nav[aria-label="Постраничная навигация"], nav[aria-label*="страниц"]'
      )
    ).toBeNull();
    rerender(<NotificationsScreen role="manager" {...base} rows={[row()]} total={51} />);
    expect(container.textContent).toMatch(/2/);
  });
});
