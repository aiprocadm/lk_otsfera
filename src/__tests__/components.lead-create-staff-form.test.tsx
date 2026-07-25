// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { createLeadAction } = vi.hoisted(() => ({ createLeadAction: vi.fn() }));
vi.mock('@/server-actions/manager/create-lead', () => ({
  createLeadByStaffAction: createLeadAction
}));

import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';

const orgs = [
  { id: 'org-1', name: 'ООО Заказчик' },
  { id: 'org-2', name: 'АО Вектор' }
];

function openDialog() {
  // Триггер и submit называются одинаково («Создать лид»); триггер рендерится первым.
  fireEvent.click(screen.getAllByRole('button', { name: 'Создать лид' })[0]);
}

function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function fillRequired() {
  fireEvent.change(input('Название компании *'), { target: { value: 'ООО Ромашка' } });
  fireEvent.change(input('Контактное лицо *'), { target: { value: 'Иван Петров' } });
  fireEvent.change(input('Тема *'), { target: { value: 'Обучение ОТ' } });
}

function submitForm() {
  fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);
}

describe('LeadCreateStaffForm', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    createLeadAction.mockReset();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('кнопка «Создать лид» есть, диалог по умолчанию закрыт', () => {
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    expect(screen.getAllByRole('button', { name: 'Создать лид' }).length).toBeGreaterThan(0);
    expect(showModal).not.toHaveBeenCalled();
  });

  it('клик по кнопке открывает диалог «Новый лид» с полями и списком организаций', async () => {
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Новый лид')).toBeTruthy();
    expect(input('Название компании *')).toBeTruthy();
    expect(input('Контактное лицо *')).toBeTruthy();
    expect(input('Тема *')).toBeTruthy();
    expect(screen.getByLabelText('Организация')).toBeTruthy();
    expect(screen.getByText('ООО Заказчик')).toBeTruthy();
    expect(screen.getByText('— без организации —')).toBeTruthy();
  });

  it('happy path: server-action получает все поля (пустые → null), диалог закрыт, тост, refresh, форма сброшена', async () => {
    createLeadAction.mockResolvedValue({ ok: true, leadId: 'lead-1' });
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fillRequired();
    fireEvent.change(input('ИНН'), { target: { value: '7701234567' } });
    fireEvent.change(input('Телефон'), { target: { value: '+79990001122' } });
    fireEvent.change(screen.getByLabelText('Примечание'), { target: { value: 'Срочно' } });
    submitForm();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Лид создан'));
    expect(createLeadAction).toHaveBeenCalledWith({
      companyName: 'ООО Ромашка',
      inn: '7701234567',
      contactName: 'Иван Петров',
      contactPhone: '+79990001122',
      contactEmail: null,
      subject: 'Обучение ОТ',
      notes: 'Срочно',
      organizationId: null
    });
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalled());

    // Повторное открытие — чистая форма
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect(input('Название компании *').value).toBe('');
    expect(input('ИНН').value).toBe('');
  });

  it('выбранная организация уходит в organizationId', async () => {
    createLeadAction.mockResolvedValue({ ok: true, leadId: 'lead-2' });
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fillRequired();
    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'org-2' } });
    submitForm();

    await waitFor(() => expect(createLeadAction).toHaveBeenCalled());
    expect(createLeadAction.mock.calls[0][0]).toMatchObject({ organizationId: 'org-2' });
  });

  it('validation-ошибки: messages показаны списком, диалог открыт, тоста и refresh нет', async () => {
    createLeadAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон или email', 'ИНН — 10 или 12 цифр']
    });
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fillRequired();
    submitForm();

    await waitFor(() => expect(screen.getByText('Укажите телефон или email')).toBeTruthy());
    expect(screen.getByText('ИНН — 10 или 12 цифр')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Введённые значения сохранены для исправления
    expect(input('Название компании *').value).toBe('ООО Ромашка');
  });

  it('forbidden без messages → «Не удалось создать лид — недостаточно прав»', async () => {
    createLeadAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fillRequired();
    submitForm();

    await waitFor(() =>
      expect(screen.getByText('Не удалось создать лид — недостаточно прав')).toBeTruthy()
    );
    expect(close).not.toHaveBeenCalled();
  });

  it('исключение server-action → «Сетевая ошибка — попробуйте ещё раз»', async () => {
    createLeadAction.mockRejectedValue(new Error('down'));
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fillRequired();
    submitForm();

    await waitFor(() =>
      expect(screen.getByText('Сетевая ошибка — попробуйте ещё раз')).toBeTruthy()
    );
  });

  it('пустой список организаций: селекта «Организация» нет, submit шлёт organizationId=null', async () => {
    createLeadAction.mockResolvedValue({ ok: true, leadId: 'lead-3' });
    render(React.createElement(LeadCreateStaffForm, { organizations: [] }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Организация')).toBeNull();

    fillRequired();
    submitForm();

    await waitFor(() => expect(createLeadAction).toHaveBeenCalled());
    expect(createLeadAction.mock.calls[0][0]).toMatchObject({ organizationId: null });
  });

  it('«Отмена» закрывает диалог и сбрасывает список ошибок', async () => {
    createLeadAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(LeadCreateStaffForm, { organizations: orgs }));
    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fillRequired();
    submitForm();
    await waitFor(() =>
      expect(screen.getByText('Не удалось создать лид — недостаточно прав')).toBeTruthy()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());

    openDialog();
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Не удалось создать лид — недостаточно прав')).toBeNull();
  });
});
