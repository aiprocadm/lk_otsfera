// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PartnerDetail } from '@/lib/services/admin/partners';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { updatePartnerAction } = vi.hoisted(() => ({ updatePartnerAction: vi.fn() }));
vi.mock('@/server-actions/admin/partners', () => ({ updatePartnerAction }));

import { PartnerEditForm } from '@/components/admin/partner-edit-form';

function partner(overrides: Partial<PartnerDetail> = {}): PartnerDetail {
  return {
    id: 'p1',
    slug: 'partner-x',
    name: 'Партнёр Х',
    commissionRate: 0.08,
    isActive: true,
    ...overrides
  } as PartnerDetail;
}

describe('PartnerEditForm', () => {
  beforeEach(() => {
    updatePartnerAction.mockReset();
    refresh.mockClear();
  });

  it('renders slug as read-only and name/commissionRate/isActive as controlled', () => {
    render(React.createElement(PartnerEditForm, { partner: partner() }));
    expect(screen.getByDisplayValue('partner-x')).toHaveProperty('readOnly', true);
    expect((screen.getByDisplayValue('Партнёр Х') as HTMLInputElement).value).toBe('Партнёр Х');
    expect((screen.getByDisplayValue('8') as HTMLInputElement).value).toBe('8');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('renders empty commissionRate input when commissionRate is null', () => {
    render(React.createElement(PartnerEditForm, { partner: partner({ commissionRate: null }) }));
    const rateInput = document.querySelector('input[name="commissionRate"]') as HTMLInputElement;
    expect(rateInput.value).toBe('');
  });

  it('editing name/commissionRate updates controlled inputs; toggling checkbox updates the hidden isActive field', () => {
    render(React.createElement(PartnerEditForm, { partner: partner({ isActive: true }) }));
    const nameInput = screen.getByDisplayValue('Партнёр Х') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Новое имя' } });
    expect(nameInput.value).toBe('Новое имя');

    const rateInput = screen.getByDisplayValue('8') as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: '12.5' } });
    expect(rateInput.value).toBe('12.5');

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    const hiddenIsActive = document.querySelector('input[name="isActive"]') as HTMLInputElement;
    expect(hiddenIsActive.value).toBe('true');
    fireEvent.click(checkbox);
    expect(hiddenIsActive.value).toBe('false');
  });

  it('success path: submits id and shows the success status', async () => {
    updatePartnerAction.mockResolvedValue({ ok: true });
    render(React.createElement(PartnerEditForm, { partner: partner({ id: 'p9' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveProperty('textContent', 'Изменения сохранены.'));
    const fd = updatePartnerAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('p9');
  });

  it('error path (not_found) renders the mapped alert', async () => {
    updatePartnerAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(PartnerEditForm, { partner: partner() }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Партнёр не найден.')
    );
  });

  it('busy state shows "Сохраняю…" and disables the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    updatePartnerAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(React.createElement(PartnerEditForm, { partner: partner() }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохраняю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement).disabled).toBe(true);
    resolvePromise({ ok: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
