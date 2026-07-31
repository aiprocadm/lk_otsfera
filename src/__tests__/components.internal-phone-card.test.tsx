// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { updateInternalPhoneAction } = vi.hoisted(() => ({ updateInternalPhoneAction: vi.fn() }));
vi.mock('@/server-actions/staff-profile', () => ({ updateInternalPhoneAction }));

import { InternalPhoneCard } from '@/components/manager/settings/internal-phone-card';

describe('InternalPhoneCard', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    updateInternalPhoneAction.mockReset();
  });

  it('prefills the input with the initial value', () => {
    render(<InternalPhoneCard initialInternalPhone="201" />);
    expect((screen.getByLabelText('Внутренний номер') as HTMLInputElement).value).toBe('201');
  });

  it('renders empty when there is no initial value (null)', () => {
    render(<InternalPhoneCard initialInternalPhone={null} />);
    expect((screen.getByLabelText('Внутренний номер') as HTMLInputElement).value).toBe('');
  });

  it('save success: calls the action with the typed value and toasts success', async () => {
    updateInternalPhoneAction.mockResolvedValue({ ok: true });
    render(<InternalPhoneCard initialInternalPhone={null} />);

    fireEvent.change(screen.getByLabelText('Внутренний номер'), { target: { value: '303' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(updateInternalPhoneAction).toHaveBeenCalledWith({ internalPhone: '303' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Внутренний номер сохранён'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('save error (invalid): toasts an error and does not toast success', async () => {
    updateInternalPhoneAction.mockResolvedValue({ ok: false, error: 'invalid' });
    render(<InternalPhoneCard initialInternalPhone="101" />);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Внутренний номер слишком длинный (не больше 32 символов).'
      )
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
