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
  // Этап 5 PR-3 (`Р-Э5-7`): в строке — идентификатор, адрес считает таблица маршрутов.
  meta: { taskId: 't1' },
  entityId: 't1',
  dedupCount: 1,
  lastOccurredAt: null,
  ...over,
});

const base = {
  basePath: '/manager/notifications',
  homeHref: '/manager',
  total: 1,
  unreadTotal: 1,
  page: 1,
  pageSize: 50,
  groupOptions: [
    { key: 'communication', label: 'Коммуникация', types: ['chat_message'] },
    { key: 'tasks', label: 'Задачи', types: ['task_assigned', 'task_due_soon'] },
  ] as never[],
  unreadOnly: false,
  group: null,
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

  it('повтор в окне: «×N» с подсказкой и дата последнего повтора, а не создания (У-231)', () => {
    render(
      <NotificationsScreen
        role="manager"
        {...base}
        rows={[row({ dedupCount: 3, lastOccurredAt: new Date('2026-09-17T12:34:00.000Z') })]}
      />
    );
    expect(screen.getByText('×3')).toBeTruthy();
    expect(screen.getByTitle('Повторилось 3 раз за час')).toBeTruthy();
    // 16.09 — создание; на экране — 17.09, последний повтор.
    expect(screen.getByText(/17\.09/)).toBeTruthy();
    expect(screen.queryByText(/16\.09/)).toBeNull();
  });

  it('без повторов значка «×N» нет', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row()]} />);
    expect(screen.queryByText(/^×\d+$/)).toBeNull();
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
        group={'tasks' as never}
        type={'task_assigned' as never}
      />
    );
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current.length).toBe(2); // «Непрочитанные» и тип
    // «Все» сохраняет группу и тип, снимает только «непрочитанные».
    expect(
      container.querySelector('a[href="/manager/notifications?group=tasks&type=task_assigned"]')
    ).toBeTruthy();
    expect(
      container.querySelector(
        'a[href="/manager/notifications?unread=1&group=tasks&type=task_due_soon"]'
      )
    ).toBeTruthy();
  });

  it('счётчик непрочитанных стоит прямо в фильтре', () => {
    render(<NotificationsScreen role="manager" {...base} rows={[row()]} unreadTotal={4} />);
    expect(screen.getByText('Непрочитанные (4)')).toBeTruthy();
  });

  it('этап 2 ТЗ 13.10.2026 (`У-286`): у слушателя — свои тексты, без заказов и обращений', () => {
    const { container } = render(
      <NotificationsScreen
        role="student"
        {...base}
        basePath="/student/notifications"
        homeHref="/student"
        groupOptions={[]}
        total={0}
        rows={[]}
      />
    );
    expect(
      screen.getByText(
        'Здесь отображаются уведомления о ваших учебных курсах, сроках прохождения обучения и других важных событиях.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Пока ничего не произошло')).toBeTruthy();
    expect(container.textContent).not.toMatch(/заказ|обращени/i);
  });

  it('`У-286`: строка слушателя о его обучении ведёт в «Мой профиль»', () => {
    const { container } = render(
      <NotificationsScreen
        role="student"
        {...base}
        basePath="/student/notifications"
        homeHref="/student"
        rows={[row({ type: 'training_assigned', meta: { enrollmentItemId: 'i1' } })]}
      />
    );
    expect(container.querySelector('a[href="/student/profile"]')).toBeTruthy();
  });

  it('у слушателя нет ни фильтра типов, ни ссылок в строках', () => {
    const { container } = render(
      <NotificationsScreen
        role="student"
        {...base}
        basePath="/student/notifications"
        homeHref="/student"
        groupOptions={[]}
        rows={[row()]}
      />
    );
    expect(screen.queryByText('Тип')).toBeNull();
    expect(container.querySelector('a[href="/manager/tasks/t1"]')).toBeNull();
  });

  describe('фильтр по группам (этап 4 ТЗ 28.10.2026, `У-348`)', () => {
    const groupNav = (c: HTMLElement) =>
      c.querySelector('nav[aria-label="Группа уведомлений"]') as HTMLElement | null;
    const typeNav = (c: HTMLElement) =>
      c.querySelector('nav[aria-label^="Типы уведомлений"]') as HTMLElement | null;

    it('сначала только группы роли в порядке настроек; узких типов не видно', () => {
      const { container } = render(<NotificationsScreen role="manager" {...base} rows={[row()]} />);
      const nav = groupNav(container);
      expect(nav).toBeTruthy();
      const links = Array.from(nav!.querySelectorAll('a')).map((a) => a.textContent);
      expect(links).toEqual(['любая', 'Коммуникация', 'Задачи']);
      expect(nav!.querySelector('a[aria-current="page"]')?.textContent).toBe('любая');
      expect(typeNav(container)).toBeNull();
      expect(container.textContent).not.toMatch(/Срок задачи подходит/);
    });

    it('выбрана группа: внизу — только её типы и «все «Задачи»»; ссылки помнят группу', () => {
      const { container } = render(
        <NotificationsScreen role="manager" {...base} rows={[row()]} group={'tasks' as never} />
      );
      const types = typeNav(container);
      expect(types?.getAttribute('aria-label')).toBe('Типы уведомлений: Задачи');
      const labels = Array.from(types!.querySelectorAll('a')).map((a) => a.textContent);
      expect(labels[0]).toBe('все «Задачи»');
      expect(labels).toHaveLength(3);
      expect(types!.textContent).not.toMatch(/Новое сообщение в чате/);
      expect(types!.querySelector('a[aria-current="page"]')?.textContent).toBe('все «Задачи»');
      expect(
        types!.querySelector('a[href="/manager/notifications?group=tasks&type=task_due_soon"]')
      ).toBeTruthy();
      // Группа залита: выбрана она сама, без узкого типа.
      const tasks = Array.from(groupNav(container)!.querySelectorAll('a')).find(
        (a) => a.textContent === 'Задачи'
      );
      expect(tasks?.getAttribute('aria-current')).toBe('page');
    });

    it('выбран тип: группа обведена (current), залит тип; «любая» снимает оба', () => {
      const { container } = render(
        <NotificationsScreen
          role="manager"
          {...base}
          rows={[row()]}
          group={'tasks' as never}
          type={'task_assigned' as never}
        />
      );
      const tasks = Array.from(groupNav(container)!.querySelectorAll('a')).find(
        (a) => a.textContent === 'Задачи'
      );
      expect(tasks?.getAttribute('aria-current')).toBe('true');
      expect(typeNav(container)!.querySelector('a[aria-current="page"]')?.textContent).toMatch(
        /Назначена задача/
      );
      expect(
        groupNav(container)!.querySelector('a[href="/manager/notifications"]')?.textContent
      ).toBe('любая');
    });

    it('«Непрочитанные» сохраняются при смене группы', () => {
      const { container } = render(
        <NotificationsScreen role="manager" {...base} rows={[row()]} unreadOnly />
      );
      expect(
        groupNav(container)!.querySelector(
          'a[href="/manager/notifications?unread=1&group=communication"]'
        )
      ).toBeTruthy();
    });

    it('одна группа у роли: ряда «Группа» нет, сразу типы, в адресе без group', () => {
      const { container } = render(
        <NotificationsScreen
          role="student"
          {...base}
          basePath="/student/notifications"
          homeHref="/student"
          groupOptions={[
            {
              key: 'enrollments',
              label: 'Заявки на обучение',
              types: ['training_assigned', 'certificate_expiring'],
            },
          ]}
          rows={[]}
          total={0}
        />
      );
      expect(groupNav(container)).toBeNull();
      const types = typeNav(container);
      expect(types?.querySelector('a[aria-current="page"]')?.textContent).toBe('любой');
      expect(
        types?.querySelector('a[href="/student/notifications?type=training_assigned"]')
      ).toBeTruthy();
      expect(container.innerHTML).not.toContain('group=');
    });

    it('пусто по группе — это фильтр: «Снимите фильтр», а не «Пока тихо»', () => {
      render(
        <NotificationsScreen
          role="manager"
          {...base}
          rows={[]}
          total={0}
          group={'tasks' as never}
        />
      );
      expect(screen.getByText(/Снимите фильтр/)).toBeTruthy();
      expect(screen.queryByText('Пока тихо')).toBeNull();
    });
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
