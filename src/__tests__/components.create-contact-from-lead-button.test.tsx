// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { createContactAction } = vi.hoisted(() => ({ createContactAction: vi.fn() }));
vi.mock('@/server-actions/contacts', () => ({ createContactAction }));

import { CreateContactFromLeadButton } from '@/components/manager/create-contact-from-lead-button';

/**
 * `У-180` — «Создать контакт из данных лида» на карточке лида.
 *
 * Кнопка без формы: имя, телефон и почта уже видны на карточке, организация —
 * та, к которой привязан лид. Проверяем, что в контакт уезжают ровно те
 * каналы, которые у лида есть, и куда человека ведут после нажатия.
 */

const BUTTON = 'Создать контакт из данных лида';

function renderButton(
  overrides: Partial<React.ComponentProps<typeof CreateContactFromLeadButton>> = {}
) {
  return render(
    React.createElement(CreateContactFromLeadButton, {
      name: 'Анна Иванова',
      phone: '+79990001122',
      email: 'anna@example.com',
      organizationId: 'org-1',
      ...overrides,
    })
  );
}

function click() {
  fireEvent.click(screen.getByRole('button', { name: BUTTON }));
}

beforeEach(() => vi.clearAllMocks());

describe('CreateContactFromLeadButton', () => {
  describe('какие каналы уезжают в контакт', () => {
    it('телефон и почта — оба канала, имя и организация лида', async () => {
      createContactAction.mockResolvedValue({ ok: true, contactId: 'c-new' });
      renderButton();
      click();
      await waitFor(() => expect(createContactAction).toHaveBeenCalledTimes(1));
      expect(createContactAction).toHaveBeenCalledWith({
        name: 'Анна Иванова',
        organizationId: 'org-1',
        channels: [
          { type: 'phone', value: '+79990001122' },
          { type: 'email', value: 'anna@example.com' },
        ],
      });
    });

    it('только телефон — один канал phone', async () => {
      createContactAction.mockResolvedValue({ ok: true, contactId: 'c-new' });
      renderButton({ email: null });
      click();
      await waitFor(() => expect(createContactAction).toHaveBeenCalledTimes(1));
      expect(createContactAction.mock.calls[0]![0].channels).toEqual([
        { type: 'phone', value: '+79990001122' },
      ]);
    });

    it('только почта — один канал email', async () => {
      createContactAction.mockResolvedValue({ ok: true, contactId: 'c-new' });
      renderButton({ phone: null });
      click();
      await waitFor(() => expect(createContactAction).toHaveBeenCalledTimes(1));
      expect(createContactAction.mock.calls[0]![0].channels).toEqual([
        { type: 'email', value: 'anna@example.com' },
      ]);
    });

    it('ни телефона, ни почты — контакт без каналов, организация может быть пустой', async () => {
      // Лид без контактов — не повод отказать: человека заведут по имени, а
      // канал допишут в карточке контакта, куда кнопка и ведёт.
      createContactAction.mockResolvedValue({ ok: true, contactId: 'c-new' });
      renderButton({ phone: null, email: null, organizationId: null });
      click();
      await waitFor(() => expect(createContactAction).toHaveBeenCalledTimes(1));
      expect(createContactAction).toHaveBeenCalledWith({
        name: 'Анна Иванова',
        organizationId: null,
        channels: [],
      });
    });
  });

  describe('что видит человек после нажатия', () => {
    it('успех: toast «Контакт создан.» и переход на карточку нового контакта', async () => {
      createContactAction.mockResolvedValue({ ok: true, contactId: 'c-new' });
      renderButton();
      click();
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Контакт создан.'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/manager/contacts/c-new'));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('канал уже у другого контакта — не ошибка, а «вот он»: называем владельца и открываем его карточку', async () => {
      // Один и тот же телефон у двух людей одной компании быть не может (это
      // держит база). Для человека это не отказ, а находка: контакт уже есть.
      createContactAction.mockResolvedValue({
        ok: false,
        error: 'contact_channel_taken',
        conflict: { contactId: 'c-owner', name: 'Борис Петров' },
      });
      renderButton();
      click();
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
      expect(String(toastSuccess.mock.calls[0]![0])).toBe(
        'Этот телефон или почта уже у контакта «Борис Петров» — открываю его.'
      );
      await waitFor(() => expect(push).toHaveBeenCalledWith('/manager/contacts/c-owner'));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('другой отказ — русский текст из общего словаря, перехода нет', async () => {
      createContactAction.mockResolvedValue({ ok: false, error: 'forbidden' });
      renderButton();
      click();
      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });

    it('незнакомый код отказа → «Не удалось создать контакт.»', async () => {
      createContactAction.mockResolvedValue({ ok: false, error: 'weird_code' });
      renderButton();
      click();
      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось создать контакт.'));
      expect(push).not.toHaveBeenCalled();
    });

    it('пока запрос идёт, кнопка заблокирована — второй клик не создаст дубль', async () => {
      let resolve!: (v: { ok: true; contactId: string }) => void;
      createContactAction.mockReturnValue(
        new Promise<{ ok: true; contactId: string }>((r) => {
          resolve = r;
        })
      );
      renderButton();
      click();
      const button = screen.getByRole('button', { name: BUTTON }) as HTMLButtonElement;
      await waitFor(() => expect(button.disabled).toBe(true));
      fireEvent.click(button);
      expect(createContactAction).toHaveBeenCalledTimes(1);

      resolve({ ok: true, contactId: 'c-new' });
      await waitFor(() => expect(push).toHaveBeenCalled());
      await waitFor(() => expect(button.disabled).toBe(false));
    });
  });
});
