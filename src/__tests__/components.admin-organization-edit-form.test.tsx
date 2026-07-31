// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrgDetail } from '@/lib/services/admin/organizations';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { updateOrganizationAction } = vi.hoisted(() => ({ updateOrganizationAction: vi.fn() }));
vi.mock('@/server-actions/admin/organizations', () => ({ updateOrganizationAction }));

import { OrganizationEditForm } from '@/components/admin/organization-edit-form';

function org(overrides: Partial<OrgDetail> = {}): OrgDetail {
  return {
    id: 'org1',
    name: 'ООО Ромашка',
    inn: '1234567890',
    kpp: '123456789',
    externalId: 'EXT-1',
    partner: { id: 'p1', name: 'Партнёр Х' },
    ...overrides,
  } as OrgDetail;
}

describe('OrganizationEditForm', () => {
  beforeEach(() => {
    updateOrganizationAction.mockReset();
    refresh.mockClear();
  });

  it('renders the org name/inn/kpp as controlled inputs and read-only external id / partner', () => {
    render(React.createElement(OrganizationEditForm, { org: org() }));
    expect((screen.getByDisplayValue('ООО Ромашка') as HTMLInputElement).value).toBe('ООО Ромашка');
    expect((screen.getByDisplayValue('1234567890') as HTMLInputElement).value).toBe('1234567890');
    expect((screen.getByDisplayValue('123456789') as HTMLInputElement).value).toBe('123456789');
    expect(screen.getByDisplayValue('EXT-1')).toHaveProperty('readOnly', true);
    expect(screen.getByDisplayValue('Партнёр Х')).toHaveProperty('readOnly', true);
  });

  it('renders "—" for null externalId and "Без партнёра" for null partner', () => {
    render(
      React.createElement(OrganizationEditForm, {
        org: org({ externalId: null, partner: null, inn: null, kpp: null }),
      })
    );
    expect(screen.getByDisplayValue('—')).toBeTruthy();
    expect(screen.getByDisplayValue('Без партнёра')).toBeTruthy();
  });

  it('editing name/inn/kpp updates the controlled inputs', () => {
    render(React.createElement(OrganizationEditForm, { org: org() }));
    const nameInput = screen.getByDisplayValue('ООО Ромашка') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Новое имя' } });
    expect(nameInput.value).toBe('Новое имя');

    const innInput = screen.getByDisplayValue('1234567890') as HTMLInputElement;
    fireEvent.change(innInput, { target: { value: '9999999999' } });
    expect(innInput.value).toBe('9999999999');

    const kppInput = screen.getByDisplayValue('123456789') as HTMLInputElement;
    fireEvent.change(kppInput, { target: { value: '987654321' } });
    expect(kppInput.value).toBe('987654321');
  });

  it('success path: submits then shows a success status and router.refresh() (via useFormAction refresh not set, so no refresh call expected)', async () => {
    updateOrganizationAction.mockResolvedValue({ ok: true });
    render(React.createElement(OrganizationEditForm, { org: org() }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveProperty('textContent', 'Изменения сохранены.')
    );
    const fd = updateOrganizationAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('org1');
  });

  it('error path (not_found) renders the mapped alert', async () => {
    updateOrganizationAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(OrganizationEditForm, { org: org() }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Организация не найдена.')
    );
  });

  it('busy state shows "Сохраняю…" and disables the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    updateOrganizationAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(React.createElement(OrganizationEditForm, { org: org() }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохраняю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    resolvePromise({ ok: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
