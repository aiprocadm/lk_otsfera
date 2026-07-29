// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { saveCustomFieldsAction } = vi.hoisted(() => ({ saveCustomFieldsAction: vi.fn() }));
vi.mock('@/server-actions/customFields', () => ({ saveCustomFieldsAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderCustomFields } from '@/components/orders/order-custom-fields';
import type { FieldWithValue } from '@/lib/services/customFields';

const textField: FieldWithValue = {
  definition: { id: 'def-text', key: 'project_code', label: 'Код проекта', fieldType: 'text', options: [], required: false, sortOrder: 1, helpText: null, editable: true },
  value: 'ABC-123'
};

const boolField: FieldWithValue = {
  definition: { id: 'def-bool', key: 'urgent', label: 'Срочный', fieldType: 'boolean', options: [], required: false, sortOrder: 2, helpText: null, editable: true },
  value: 'false'
};

const selectField: FieldWithValue = {
  definition: { id: 'def-select', key: 'priority', label: 'Приоритет', fieldType: 'select', options: ['Низкий', 'Высокий'], required: true, sortOrder: 4, helpText: null, editable: true },
  value: ''
};

const nullTextField: FieldWithValue = {
  definition: { id: 'def-null', key: 'note', label: 'Заметка', fieldType: 'text', options: [], required: false, sortOrder: 5, helpText: null, editable: true },
  value: null
};

const requiredBoolFieldEmpty: FieldWithValue = {
  definition: { id: 'def-bool-req', key: 'confirmed', label: 'Подтверждено', fieldType: 'boolean', options: [], required: true, sortOrder: 6, helpText: null, editable: true },
  value: null
};

const numberField: FieldWithValue = {
  definition: { id: 'def-number', key: 'qty', label: 'Количество', fieldType: 'number', options: [], required: true, sortOrder: 7, helpText: null, editable: true },
  value: '5'
};

describe('OrderCustomFields — EditForm interactions (Pattern I)', () => {
  beforeEach(() => {
    refresh.mockClear();
    saveCustomFieldsAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('typing in a text input updates its value (handleChange)', () => {
    render(React.createElement(OrderCustomFields, { fields: [textField], orderId: 'o1', editable: true }));
    const input = screen.getByDisplayValue('ABC-123') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'XYZ-999' } });
    expect(input.value).toBe('XYZ-999');
  });

  it('toggling a checkbox updates its checked state (handleChange, boolean branch)', () => {
    render(React.createElement(OrderCustomFields, { fields: [boolField], orderId: 'o1', editable: true }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it('changing a select updates its value (handleChange, select branch)', () => {
    render(React.createElement(OrderCustomFields, { fields: [selectField], orderId: 'o1', editable: true }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Высокий' } });
    expect(select.value).toBe('Высокий');
  });

  it('submit success: converts empty string to null, shows busy label, toasts success, and refreshes', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(React.createElement(OrderCustomFields, { fields: [textField], orderId: 'order-1', editable: true }));

    const input = screen.getByDisplayValue('ABC-123') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    expect(await screen.findByRole('button', { name: 'Сохранение…' })).toBeTruthy();
    await waitFor(() => expect(saveCustomFieldsAction).toHaveBeenCalledWith('order', 'order-1', { 'def-text': null }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Дополнительные поля сохранены.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('submit with a non-empty value sends the trimmed string as-is', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: true });
    render(React.createElement(OrderCustomFields, { fields: [textField], orderId: 'order-2', editable: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() => expect(saveCustomFieldsAction).toHaveBeenCalledWith('order', 'order-2', { 'def-text': 'ABC-123' }));
  });

  it('submit error: toasts the mapped error message and does not refresh', async () => {
    saveCustomFieldsAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(OrderCustomFields, { fields: [textField], orderId: 'order-3', editable: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поля' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a field with a null initial value initialises to an empty-string control (?? \'\' branch)', () => {
    render(React.createElement(OrderCustomFields, { fields: [nullTextField], orderId: 'o1', editable: true }));
    const input = screen.getByLabelText('Заметка') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('required boolean field with an empty value renders as HTML-required (required-when-empty branch)', () => {
    render(React.createElement(OrderCustomFields, { fields: [requiredBoolFieldEmpty], orderId: 'o1', editable: true }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.required).toBe(true);
    // Required marker asterisk renders for the boolean branch's label too
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('a number-type field renders a number input (inputType ternary, number branch)', () => {
    render(React.createElement(OrderCustomFields, { fields: [numberField], orderId: 'o1', editable: true }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('5');
    // Required marker asterisk renders for the text/number/date branch's label too
    expect(screen.getByText('*')).toBeTruthy();
  });
});
