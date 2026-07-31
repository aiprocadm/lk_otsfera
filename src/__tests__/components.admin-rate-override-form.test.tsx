// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { setOrgRateOverrideAction } = vi.hoisted(() => ({ setOrgRateOverrideAction: vi.fn() }));
vi.mock('@/server-actions/admin/organizations', () => ({ setOrgRateOverrideAction }));

import { AdminRateOverrideForm } from '@/components/admin/admin-rate-override-form';

describe('AdminRateOverrideForm', () => {
  beforeEach(() => {
    setOrgRateOverrideAction.mockReset();
    refresh.mockClear();
  });

  it('renders initial rate formatted as percent and the note, without the "reset" button hidden state', () => {
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: 0.08,
        initialNote: 'VIP',
      })
    );
    expect((screen.getByPlaceholderText('напр. 8.00') as HTMLInputElement).value).toBe('8.00');
    expect(screen.getByDisplayValue('VIP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вернуть базовую ставку' })).toBeTruthy();
  });

  it('when initialRate is null, renders empty rate field and no reset button', () => {
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    expect((screen.getByPlaceholderText('напр. 8.00') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Вернуть базовую ставку' })).toBeNull();
  });

  it('"Сохранить" is disabled until both rate and reason are filled', () => {
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'reason' },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('success path (set): submits set-shaped FormData then router.refresh()', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: true });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'my reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const fd = setOrgRateOverrideAction.mock.calls[0][0] as FormData;
    expect(fd.get('organizationId')).toBe('org1');
    expect(fd.get('reason')).toBe('my reason');
    expect(fd.get('ratePercent')).toBe('5');
    expect(fd.get('clear')).toBeNull();
  });

  it('success path (clear): submits clear=true and a default reason when the reason field is empty', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: true });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: 0.08,
        initialNote: null,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть базовую ставку' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const fd = setOrgRateOverrideAction.mock.calls[0][0] as FormData;
    expect(fd.get('clear')).toBe('true');
    expect(fd.get('reason')).toBe('Возврат к базовой ставке');
    expect(fd.get('ratePercent')).toBeNull();
  });

  it('error path (rate_out_of_range) renders the mapped alert text', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: false, error: 'rate_out_of_range' });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '500' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'Ставка должна быть строго между 0 и 100%.'
      )
    );
  });

  it('error path (not_found) renders the mapped alert text', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Организация не найдена.')
    );
  });

  it('error path (validation) renders the mapped alert text', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'Проверьте корректность полей.'
      )
    );
  });

  it('error path (unknown code) falls back to the generic "Ошибка: <code>" text', async () => {
    setOrgRateOverrideAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: null,
        initialNote: null,
      })
    );
    fireEvent.change(screen.getByPlaceholderText('напр. 8.00'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Например: VIP-клиент, индивидуальные условия'), {
      target: { value: 'reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByText('Ошибка: weird')).toBeTruthy());
  });

  it('busy state disables both action buttons while pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    setOrgRateOverrideAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(
      React.createElement(AdminRateOverrideForm, {
        organizationId: 'org1',
        initialRate: 0.08,
        initialNote: 'x',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть базовую ставку' }));

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
    expect(
      (screen.getByRole('button', { name: 'Вернуть базовую ставку' }) as HTMLButtonElement).disabled
    ).toBe(true);

    resolvePromise({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
