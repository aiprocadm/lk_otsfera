// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createFunnelStageAction, updateFunnelStageAction, deleteFunnelStageAction } = vi.hoisted(
  () => ({
    createFunnelStageAction: vi.fn(),
    updateFunnelStageAction: vi.fn(),
    deleteFunnelStageAction: vi.fn(),
  })
);
vi.mock('@/server-actions/funnel', () => ({
  createFunnelStageAction,
  updateFunnelStageAction,
  deleteFunnelStageAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { StageConfig } from '@/components/funnel/stage-config';
import type { FunnelStageView } from '@/lib/funnel/stages';

const stage: FunnelStageView = {
  id: 'st-1',
  name: 'Новый лид',
  position: 0,
  statusAnchor: 'new',
  isTerminal: false,
  color: null,
};

const terminalStage: FunnelStageView = {
  ...stage,
  id: 'st-2',
  name: 'Отказ',
  statusAnchor: 'rejected',
  isTerminal: true,
};

function renderConfig(props: React.ComponentProps<typeof StageConfig>) {
  return React.createElement(StageConfig, props);
}

describe('StageConfig', () => {
  beforeEach(() => {
    refresh.mockClear();
    createFunnelStageAction.mockReset();
    updateFunnelStageAction.mockReset();
    deleteFunnelStageAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('shows the default-stages hint when isDefault=true, and "по умолчанию" instead of action buttons', () => {
    render(renderConfig({ stages: [stage], isDefault: true }));
    expect(screen.getByText(/Сейчас используются стадии по умолчанию/)).toBeTruthy();
    expect(screen.getByText('по умолчанию')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('does not show the default-stages hint when isDefault=false, shows action buttons', () => {
    render(renderConfig({ stages: [stage], isDefault: false }));
    expect(screen.queryByText(/Сейчас используются стадии по умолчанию/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();
  });

  it('renders a row with position, name, anchor label, and terminal flag', () => {
    render(renderConfig({ stages: [stage, terminalStage], isDefault: false }));
    expect(screen.getByText('Новый лид', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Отказ', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Да')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('unknown anchor value falls back to the raw value (anchorLabel fallback)', () => {
    const weird: FunnelStageView = {
      ...stage,
      statusAnchor: 'weird_anchor' as FunnelStageView['statusAnchor'],
    };
    render(renderConfig({ stages: [weird], isDefault: false }));
    expect(screen.getByText('weird_anchor')).toBeTruthy();
  });

  it('opens the create dialog via "+ Стадия" with empty defaults', async () => {
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    expect(await screen.findByText('Новая стадия')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('opens the edit dialog pre-filled with the target stage, including the terminal checkbox', async () => {
    render(renderConfig({ stages: [terminalStage], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить стадию')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(nameInput.value).toBe('Отказ');
    const checkbox = screen.getByRole('checkbox', {
      name: 'Терминальная стадия',
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('create flow: submits form data (default color = «без цвета» → empty string), toasts success, and closes (triggers refresh)', async () => {
    createFunnelStageAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    const dialogTitle = await screen.findByText('Новая стадия');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Квалификация' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createFunnelStageAction).toHaveBeenCalledTimes(1));
    const fd = createFunnelStageAction.mock.calls[0][0] as FormData;
    expect(fd.get('name')).toBe('Квалификация');
    expect(fd.get('color')).toBe(''); // «Без цвета» по умолчанию; экшен маппит '' → null
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия создана.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Новая стадия')).toBeNull());
  });

  it('create flow: selecting a color swatch submits its hex in FormData', async () => {
    createFunnelStageAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    const dialogTitle = await screen.findByText('Новая стадия');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Цветная' } });
    fireEvent.click(within(dialogEl).getByRole('radio', { name: 'Синий' }));
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createFunnelStageAction).toHaveBeenCalledTimes(1));
    const fd = createFunnelStageAction.mock.calls[0][0] as FormData;
    expect(fd.get('color')).toBe('#3B82F6');
  });

  it('edit dialog pre-selects the stage color in the swatch picker', async () => {
    const colored: FunnelStageView = { ...stage, color: '#22C55E' };
    render(renderConfig({ stages: [colored], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить стадию');
    const swatch = screen.getByRole('radio', { name: 'Зелёный' }) as HTMLInputElement;
    expect(swatch.checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Без цвета' }) as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('edit flow: submits with the target id set and toasts "updated"', async () => {
    updateFunnelStageAction.mockResolvedValue({ ok: true });
    render(renderConfig({ stages: [stage], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialogTitle = await screen.findByText('Изменить стадию');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateFunnelStageAction).toHaveBeenCalledTimes(1));
    const fd = updateFunnelStageAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('st-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия обновлена.'));
  });

  it('create/edit error path: toasts the mapped message and keeps the dialog open', async () => {
    createFunnelStageAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    const dialogTitle = await screen.findByText('Новая стадия');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Новая стадия')).toBeTruthy();
  });

  it('create/edit error with an unmapped code falls back to the generic message', async () => {
    createFunnelStageAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    const dialogTitle = await screen.findByText('Новая стадия');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить стадию.'));
  });

  it('cancel button in the dialog closes without submitting', async () => {
    render(renderConfig({ stages: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Стадия' }));
    await screen.findByText('Новая стадия');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(createFunnelStageAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Новая стадия')).toBeNull());
  });

  it('delete flow: success calls deleteFunnelStageAction with id, toasts, and refreshes', async () => {
    deleteFunnelStageAction.mockResolvedValue({ ok: true });
    render(renderConfig({ stages: [stage], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteFunnelStageAction).toHaveBeenCalledTimes(1));
    const fd = deleteFunnelStageAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('st-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Стадия удалена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('delete flow: error path toasts the mapped message and does not refresh', async () => {
    deleteFunnelStageAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(renderConfig({ stages: [stage], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('delete flow: unknown error code falls back to the generic message', async () => {
    deleteFunnelStageAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderConfig({ stages: [stage], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось удалить стадию.'));
  });
});
