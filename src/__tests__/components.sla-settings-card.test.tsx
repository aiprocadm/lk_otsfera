// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setSlaSettingsAction } = vi.hoisted(() => ({ setSlaSettingsAction: vi.fn() }));
vi.mock('@/server-actions/manager/slaSettings', () => ({ setSlaSettingsAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { SlaSettingsCard } from '@/components/manager/sla-settings-card';

// Этап 7 (§4.4, PR-3) — карточка «SLA входящих» на /leader/team.
describe('SlaSettingsCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('префилл порогов; сабмит шлёт числа; успех — toast', async () => {
    setSlaSettingsAction.mockResolvedValue({ ok: true, changed: true });
    render(<SlaSettingsCard initial={{ slaResponseHours: 24, slaWarningHours: 4 }} />);

    expect((screen.getByLabelText(/Подсветка/) as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText(/Эскалация/) as HTMLInputElement).value).toBe('24');

    fireEvent.change(screen.getByLabelText(/Эскалация/), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(setSlaSettingsAction).toHaveBeenCalledWith({
        slaResponseHours: 48,
        slaWarningHours: 4,
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Пороги SLA сохранены.');
  });

  it('без изменений — отдельный toast; ошибка валидации — список role=alert', async () => {
    setSlaSettingsAction.mockResolvedValue({ ok: true, changed: false });
    render(<SlaSettingsCard initial={{ slaResponseHours: 24, slaWarningHours: 4 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Пороги SLA не изменились.'));

    setSlaSettingsAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Порог подсветки должен быть меньше'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('меньше'));
  });

  it('прочая ошибка — generic toast', async () => {
    setSlaSettingsAction.mockResolvedValue({ ok: false, error: 'no_company' });
    render(<SlaSettingsCard initial={{ slaResponseHours: 24, slaWarningHours: 4 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось сохранить пороги SLA.')
    );
  });
});
