// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { setOrderPrimaryContactAction } = vi.hoisted(() => ({
  setOrderPrimaryContactAction: vi.fn(),
}));
vi.mock('@/server-actions/orders/primaryContact', () => ({ setOrderPrimaryContactAction }));

import { OrderContactPanel } from '@/components/orders/order-contact-panel';
import type { ContactOption } from '@/lib/services/contacts/options';
import type { OrderContactCurrent } from '@/lib/services/orders/primaryContact';

/**
 * `У-180` — панель «Контакт заказа» в карточке заказа (три кабинета ЦО).
 *
 * Проверяем то, что видит сотрудник: кто сейчас ведёт заказ со стороны
 * клиента, куда ведёт ссылка на него, почему список пуст (нет организации /
 * у организации нет людей) и что происходит после «Сохранить».
 */

const OPTIONS: ContactOption[] = [
  { id: 'c-1', name: 'Анна Иванова', position: 'директор', organizationId: 'org-1' },
  { id: 'c-2', name: 'Борис Петров', position: null, organizationId: 'org-1' },
];

const CURRENT: OrderContactCurrent = {
  id: 'c-1',
  name: 'Анна Иванова',
  position: 'директор',
  organizationId: 'org-1',
  isArchived: false,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof OrderContactPanel>> = {}) {
  return render(
    React.createElement(OrderContactPanel, {
      orderId: 'ord-1',
      cabinet: 'manager',
      organizationId: 'org-1',
      current: CURRENT,
      options: OPTIONS,
      ...overrides,
    })
  );
}

function select(): HTMLSelectElement {
  return screen.getByLabelText('Контакт заказа') as HTMLSelectElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
}

beforeEach(() => vi.clearAllMocks());

describe('OrderContactPanel', () => {
  describe('текущий контакт', () => {
    it('показывает имя ссылкой в СВОЙ кабинет, должность и заголовок панели', () => {
      renderPanel({ cabinet: 'leader' });
      expect(screen.getByText('Контакт заказа', { selector: 'h2' })).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Анна Иванова' }) as HTMLAnchorElement;
      // Руководитель уходит в /leader/contacts, а не к менеджеру (`Р-23`).
      expect(link.getAttribute('href')).toBe('/leader/contacts/c-1');
      expect(screen.getByText('· директор')).toBeTruthy();
      expect(screen.queryByText('· в архиве')).toBeNull();
      expect(screen.queryByText('Контакт не указан.')).toBeNull();
    });

    it('без должности — только имя; архивный контакт помечен « · в архиве»', () => {
      // Человек ушёл в архив, но заказ на нём остался: скрывать его нельзя —
      // иначе сотрудник не поймёт, почему заказ «без контакта» с историей.
      renderPanel({ current: { ...CURRENT, position: null, isArchived: true } });
      expect(screen.getByRole('link', { name: 'Анна Иванова' })).toBeTruthy();
      expect(screen.queryByText('· директор')).toBeNull();
      expect(screen.getByText('· в архиве')).toBeTruthy();
    });

    it('контакта нет — «Контакт не указан.», ссылки нет', () => {
      renderPanel({ current: null });
      expect(screen.getByText('Контакт не указан.')).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
      expect(select().value).toBe('');
    });
  });

  describe('почему выбирать не из кого', () => {
    it('у заказа нет организации — подсказка привязать её, селекта и кнопки нет', () => {
      renderPanel({ organizationId: null, current: null, options: [] });
      expect(
        screen.getByText(/У заказа нет организации — выбирать контакт не из кого/)
      ).toBeTruthy();
      expect(screen.queryByLabelText('Контакт заказа')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
      expect(screen.queryByText(/У организации заказа контактов нет/)).toBeNull();
    });

    it('у организации нет контактов — ссылка «Добавить контакт» ведёт на вкладку контактов её карточки', () => {
      // Тупик без выхода — дефект приёмки (§15): вместо пустого селекта
      // говорим, где завести человека, и даём ссылку прямо туда.
      renderPanel({ cabinet: 'admin', current: null, options: [] });
      expect(screen.getByText(/У организации заказа контактов нет/)).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Добавить контакт' }) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/admin/organizations/org-1?tab=contacts');
      expect(screen.queryByLabelText('Контакт заказа')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    });
  });

  describe('выбор и сохранение', () => {
    it('селект предвыбирает текущий контакт, варианты подписаны «имя — должность» (без должности — просто имя)', () => {
      renderPanel();
      const sel = select();
      expect(sel.value).toBe('c-1');
      const labels = Array.from(sel.options).map((o) => o.textContent);
      expect(labels).toEqual(['— не указан —', 'Анна Иванова — директор', 'Борис Петров']);
    });

    it('текущий контакт, которого нет среди вариантов, стоит в селекте отдельной строкой и снимается «— не указан —»', async () => {
      // Архив: иначе селект показал бы «— не указан —», а кнопка считала бы
      // форму нетронутой — снять человека было бы нечем.
      setOrderPrimaryContactAction.mockResolvedValue({ ok: true });
      renderPanel({ current: { ...CURRENT, id: 'c-9', name: 'Глеб Архивный', isArchived: true } });
      expect(select().value).toBe('c-9');
      const labels = Array.from(select().options).map((o) => o.textContent);
      expect(labels[1]).toBe('Глеб Архивный (в архиве) — директор');
      expect(saveButton().disabled).toBe(true);

      fireEvent.change(select(), { target: { value: '' } });
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(saveButton());
      await waitFor(() =>
        expect(setOrderPrimaryContactAction).toHaveBeenCalledWith({
          orderId: 'ord-1',
          contactId: null,
        })
      );
    });

    it('текущий контакт другой организации (не архив) подписан «(не из этой организации)»', () => {
      renderPanel({
        current: {
          ...CURRENT,
          id: 'c-9',
          name: 'Дарья Чужая',
          position: null,
          organizationId: 'org-2',
        },
      });
      const labels = Array.from(select().options).map((o) => o.textContent);
      expect(labels[1]).toBe('Дарья Чужая (не из этой организации)');
      expect(select().value).toBe('c-9');
    });

    it('кнопка «Сохранить» неактивна, пока значение не изменилось, и оживает после смены', () => {
      renderPanel();
      expect(saveButton().disabled).toBe(true);

      fireEvent.change(select(), { target: { value: 'c-2' } });
      expect(saveButton().disabled).toBe(false);

      // Вернули прежнего — сохранять снова нечего.
      fireEvent.change(select(), { target: { value: 'c-1' } });
      expect(saveButton().disabled).toBe(true);
      expect(setOrderPrimaryContactAction).not.toHaveBeenCalled();
    });

    it('сохранение нового контакта: экшен получает orderId и contactId, toast «сохранён», страница обновляется', async () => {
      setOrderPrimaryContactAction.mockResolvedValue({ ok: true });
      renderPanel();
      fireEvent.change(select(), { target: { value: 'c-2' } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(setOrderPrimaryContactAction).toHaveBeenCalledTimes(1));
      expect(setOrderPrimaryContactAction).toHaveBeenCalledWith({
        orderId: 'ord-1',
        contactId: 'c-2',
      });
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Контакт заказа сохранён.'));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('снятие контакта («— не указан —»): в экшен уходит contactId: null, toast «снят»', async () => {
      // Пустая строка селекта — это «снять», а не «контакт с пустым id»:
      // сервис ждёт null.
      setOrderPrimaryContactAction.mockResolvedValue({ ok: true });
      renderPanel();
      fireEvent.change(select(), { target: { value: '' } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(setOrderPrimaryContactAction).toHaveBeenCalledTimes(1));
      expect(setOrderPrimaryContactAction).toHaveBeenCalledWith({
        orderId: 'ord-1',
        contactId: null,
      });
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Контакт заказа снят.'));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it('пока сохранение идёт — селект и кнопка заблокированы, после ответа кнопка снова доступна', async () => {
      // Двойной клик не должен отправить два запроса.
      let resolve!: (v: { ok: true }) => void;
      setOrderPrimaryContactAction.mockReturnValue(
        new Promise<{ ok: true }>((r) => {
          resolve = r;
        })
      );
      renderPanel();
      fireEvent.change(select(), { target: { value: 'c-2' } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(saveButton().disabled).toBe(true));
      expect(select().disabled).toBe(true);
      expect(setOrderPrimaryContactAction).toHaveBeenCalledTimes(1);

      resolve({ ok: true });
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      await waitFor(() => expect(select().disabled).toBe(false));
    });

    it.each([
      ['forbidden', 'Нет прав менять контакт заказа.'],
      ['not_found', 'Заказ не найден — обновите страницу.'],
      [
        'contact_not_found',
        'Этот человек не относится к организации заказа или уже в архиве. Обновите страницу.',
      ],
      ['validation', 'Выберите контакт из списка.'],
    ])('отказ %s → русский toast «%s», без обновления страницы', async (code, message) => {
      setOrderPrimaryContactAction.mockResolvedValue({ ok: false, error: code });
      renderPanel();
      fireEvent.change(select(), { target: { value: 'c-2' } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('незнакомый код отказа не теряется — показывается общим текстом с кодом', async () => {
      setOrderPrimaryContactAction.mockResolvedValue({ ok: false, error: 'weird_code' });
      renderPanel();
      fireEvent.change(select(), { target: { value: 'c-2' } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Ошибка: weird_code'));
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
