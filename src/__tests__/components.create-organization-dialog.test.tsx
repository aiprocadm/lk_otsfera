// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { createOrganizationAction } = vi.hoisted(() => ({ createOrganizationAction: vi.fn() }));
vi.mock('@/server-actions/admin/organizations', () => ({ createOrganizationAction }));

import { CreateOrganizationDialog } from '@/components/admin/create-organization-dialog';

describe('CreateOrganizationDialog', () => {
  beforeEach(() => {
    createOrganizationAction.mockReset();
    push.mockReset();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the trigger; dialog is closed initially', () => {
    render(React.createElement(CreateOrganizationDialog));
    expect(screen.getByRole('button', { name: '+ Добавить организацию' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Новая организация' })).toBeNull();
  });

  it('opens the dialog with the create form on click', async () => {
    render(React.createElement(CreateOrganizationDialog));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая организация' });
    expect(within(dialog).getByText(/Организация создаётся вручную/)).toBeTruthy();
  });

  it('success: submits, navigates to the new org card', async () => {
    createOrganizationAction.mockResolvedValue({ ok: true, id: 'org-new' });
    render(React.createElement(CreateOrganizationDialog));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая организация' });

    fireEvent.submit(within(dialog).getByText('Создать').closest('form')!);

    await waitFor(() => expect(createOrganizationAction).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/organizations/org-new'));
  });

  it('подсказка ДаДаты заполняет название, ИНН и КПП; поля правятся руками', async () => {
    // Организацию заводят вручную редко и обычно по подсказке. Если бы её
    // обработчик потерялся, админ вводил бы реквизиты руками и не заметил, что
    // автозаполнение сломано — поля просто остались бы пустыми.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          { name: 'ООО Ромашка', inn: '7707083893', kpp: '770701001', ogrn: null, address: 'г. Москва' },
          // ИП не имеет КПП — поле должно очиститься, а не сохранить чужое значение.
          { name: 'ИП Иванов', inn: '770708389312', kpp: null, ogrn: null, address: null }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(React.createElement(CreateOrganizationDialog));
      fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));

      const combo = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(combo, { target: { value: 'ромашка' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.mouseDown(screen.getAllByRole('option')[0]);

      expect(combo.value).toBe('ООО Ромашка');
      const kpp = document.querySelector('input[name="kpp"]') as HTMLInputElement;
      expect(kpp.value).toBe('770701001');

      // ИНН и КПП правятся руками — подсказка бывает неточной или устаревшей.
      const innField = document.querySelector('input[name="inn"]') as HTMLInputElement;
      fireEvent.change(innField, { target: { value: '7707083894' } });
      expect((document.querySelector('input[name="inn"]') as HTMLInputElement).value).toBe('7707083894');
      // КПП можно поправить руками (подсказка бывает неточной).
      fireEvent.change(kpp, { target: { value: '997950001' } });
      expect((document.querySelector('input[name="kpp"]') as HTMLInputElement).value).toBe('997950001');

      // Выбор ИП (без КПП) обязан очистить поле, иначе в карточку уедет КПП
      // прошлой организации.
      fireEvent.change(combo, { target: { value: 'иванов' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.mouseDown(screen.getAllByRole('option')[1]);
      expect((document.querySelector('input[name="kpp"]') as HTMLInputElement).value).toBe('');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('закрытие диалога сбрасывает введённые поля', async () => {
    // Диалог остаётся в разметке. Если бы сброс потерялся, при повторном
    // открытии админ увидел бы данные прошлой организации и мог случайно
    // создать дубль.
    render(React.createElement(CreateOrganizationDialog));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));
    const combo = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(combo, { target: { value: 'Черновик' } });

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));

    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  });

  it('error inn_exists: shows the mapped Russian message and stays open', async () => {
    createOrganizationAction.mockResolvedValue({ ok: false, error: 'inn_exists' });
    render(React.createElement(CreateOrganizationDialog));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить организацию' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая организация' });

    fireEvent.submit(within(dialog).getByText('Создать').closest('form')!);

    expect(
      await within(dialog).findByText('Организация с таким ИНН уже есть в системе — найдите её в списке.')
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
