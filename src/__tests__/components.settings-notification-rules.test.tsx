// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * «Правила уведомлений» (`У-127`, решение `Р-23`): экран и таблица.
 *
 * Экран один на два кабинета, различается только подзаголовок и область
 * действия — её задаёт сервер по роли. Таблица отвечает сразу
 * (оптимистично), но при отказе **откатывает** переключатель: показывать
 * включённым то, что не сохранилось, — врать человеку.
 */
const actions = vi.hoisted(() => ({
  saveNotificationRuleAction: vi.fn(),
  resetNotificationRulesAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/notificationRules', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { NotificationRulesScreen } from '@/components/settings/notification-rules-screen';
import { NotificationRulesTable } from '@/components/settings/notification-rules-table';
import type { RuleRow } from '@/lib/notifications/routing';

const rule = (over: Partial<RuleRow> = {}): RuleRow =>
  ({
    eventType: 'order_status_changed',
    eventLabel: 'Статус заказа изменился',
    audience: 'organization',
    channel: 'email',
    enabled: true,
    source: 'default',
    ...over,
  }) as RuleRow;

beforeEach(() => {
  vi.clearAllMocks();
  actions.saveNotificationRuleAction.mockResolvedValue({ ok: true });
  actions.resetNotificationRulesAction.mockResolvedValue({ ok: true, removed: 3 });
});

describe('NotificationRulesScreen — оболочка экрана', () => {
  it('у администратора подзаголовок говорит про всю платформу', () => {
    render(<NotificationRulesScreen cabinet="admin" hasCompany={false} rows={[rule()]} />);

    expect(screen.getByText(/действуют на всей платформе/)).toBeTruthy();
    expect(screen.getByText('Статус заказа изменился')).toBeTruthy();
  });

  it('у руководителя подзаголовок говорит про его клиентов', () => {
    render(<NotificationRulesScreen cabinet="leader" hasCompany rows={[rule()]} />);

    expect(screen.getByText(/Ваши правила важнее общих/)).toBeTruthy();
  });

  it('руководитель без компании видит объяснение вместо таблицы', () => {
    render(<NotificationRulesScreen cabinet="leader" hasCompany={false} rows={[rule()]} />);

    expect(screen.getByRole('alert').textContent).toContain('не указана компания');
    expect(screen.queryByText('Статус заказа изменился')).toBeNull();
  });
});

describe('NotificationRulesTable — таблица «событие × роль × канал»', () => {
  it('колокольчик отключить нельзя, и это сказано прямо', () => {
    render(<NotificationRulesTable cabinet="admin" rows={[rule()]} />);

    expect(screen.getByText(/колокольчик.*приходит всегда/s)).toBeTruthy();
  });

  it('канал без правила оставляет клетку пустой, а не рисует ложный выключатель', () => {
    render(<NotificationRulesTable cabinet="admin" rows={[rule({ channel: 'email' })]} />);

    // Четыре канала в шапке, но правило только на почту.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('перекрытое значение помечено — видно, почему у соседа иначе', () => {
    render(
      <NotificationRulesTable
        cabinet="leader"
        rows={[
          rule({ channel: 'email', source: 'company' }),
          rule({ channel: 'telegram', source: 'platform' }),
        ]}
      />
    );

    expect(screen.getByText('изменено вами')).toBeTruthy();
    expect(screen.getByText('изменено платформой')).toBeTruthy();
  });

  it('неизвестная роль показывается как есть, а не пропадает', () => {
    render(
      <NotificationRulesTable cabinet="admin" rows={[rule({ audience: 'новая-роль' as never })]} />
    );

    expect(screen.getByText('новая-роль')).toBeTruthy();
  });

  it('переключатель отвечает сразу и сохраняет значение', async () => {
    render(<NotificationRulesTable cabinet="leader" rows={[rule({ enabled: true })]} />);

    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(box);

    expect(box.checked).toBe(false);
    await waitFor(() =>
      expect(actions.saveNotificationRuleAction).toHaveBeenCalledWith(
        'leader',
        'order_status_changed',
        'organization',
        'email',
        false
      )
    );
  });

  it('отказ откатывает переключатель — экран не врёт', async () => {
    actions.saveNotificationRuleAction.mockResolvedValue({ ok: false, error: 'company_required' });
    render(<NotificationRulesTable cabinet="leader" rows={[rule({ enabled: true })]} />);

    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(box);

    await waitFor(() => expect(box.checked).toBe(true));
    expect(toastMock.error).toHaveBeenCalledWith(
      'У вашей учётной записи не указана компания — обратитесь к администратору.'
    );
  });

  it('прочий отказ тоже откатывает и говорит понятно', async () => {
    actions.saveNotificationRuleAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(<NotificationRulesTable cabinet="admin" rows={[rule({ enabled: false })]} />);

    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(box);

    await waitFor(() => expect(box.checked).toBe(false));
    expect(toastMock.error).toHaveBeenCalledWith('Не удалось сохранить правило.');
  });

  it('«Вернуть стандартные» спрашивает подтверждение', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );
    render(<NotificationRulesTable cabinet="leader" rows={[rule()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть стандартные' }));

    expect(actions.resetNotificationRulesAction).not.toHaveBeenCalled();
  });

  it('после сброса сообщает, сколько изменений снято', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    render(<NotificationRulesTable cabinet="leader" rows={[rule()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть стандартные' }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Возвращены стандартные правила (снято изменений: 3).'
      )
    );
  });

  it('менять было нечего — так и говорит, а не «готово» в пустоту', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    actions.resetNotificationRulesAction.mockResolvedValue({ ok: true, removed: 0 });
    render(<NotificationRulesTable cabinet="leader" rows={[rule()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть стандартные' }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Всё и так по умолчанию — менять было нечего.')
    );
  });

  it('отказ сброса объясняется причиной', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    actions.resetNotificationRulesAction.mockResolvedValue({
      ok: false,
      error: 'company_required',
    });
    render(<NotificationRulesTable cabinet="leader" rows={[rule()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть стандартные' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'У вашей учётной записи не указана компания — обратитесь к администратору.'
      )
    );
  });

  it('несколько событий группируются в строки, а каналы — в колонки', () => {
    render(
      <NotificationRulesTable
        cabinet="admin"
        rows={[
          rule({ channel: 'email' }),
          rule({ channel: 'telegram' }),
          rule({
            eventType: 'payment_received',
            eventLabel: 'Оплата получена',
            audience: 'partner',
            channel: 'email',
          }),
        ]}
      />
    );

    expect(screen.getAllByRole('row')).toHaveLength(3); // шапка + два события
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Партнёр')).toBeTruthy();
  });
});
