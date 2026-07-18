// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MemberRowActions } from '@/components/partner/member-row-actions';

const orgs = [
  { id: 'org1', name: 'ООО Ромашка' },
  { id: 'org2', name: 'ООО Вторая' }
];

describe('MemberRowActions', () => {
  beforeEach(() => {
    showModalMock();
    refresh.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function showModalMock() {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }

  function renderActions(overrides: Partial<React.ComponentProps<typeof MemberRowActions>> = {}) {
    return render(
      React.createElement(MemberRowActions, {
        userId: 'u1',
        name: 'Иван Петров',
        initialAssignedOrgIds: [],
        orgs,
        ...overrides
      })
    );
  }

  it('renders "Доступ" and "Удалить" trigger buttons', () => {
    renderActions();
    expect(screen.getByText('Доступ')).toBeTruthy();
    expect(screen.getByText('Удалить')).toBeTruthy();
  });

  it('opening "Доступ" with no initialAssignedOrgIds checks "все организации"', async () => {
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    await waitFor(() => expect(screen.getByText('Доступ к организациям')).toBeTruthy());
    const dialog = screen.getByRole('dialog', { name: 'Доступ к организациям' });
    const allCheckbox = within(dialog).getByLabelText('Доступ ко всем организациям партнёра') as HTMLInputElement;
    expect(allCheckbox.checked).toBe(true);
    // per-org list hidden when allOrgs=true
    expect(within(dialog).queryByText('ООО Ромашка')).toBeNull();
  });

  it('opening "Доступ" with specific initialAssignedOrgIds unchecks "все" and pre-selects those orgs', async () => {
    renderActions({ initialAssignedOrgIds: ['org1'] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    const allCheckbox = within(dialog).getByLabelText('Доступ ко всем организациям партнёра') as HTMLInputElement;
    expect(allCheckbox.checked).toBe(false);
    const org1Checkbox = within(dialog).getByLabelText('ООО Ромашка') as HTMLInputElement;
    expect(org1Checkbox.checked).toBe(true);
  });

  it('shows the "no organizations" message when orgs is empty and allOrgs is unchecked', async () => {
    renderActions({ initialAssignedOrgIds: ['org1'], orgs: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    expect(within(dialog).getByText('В портфеле нет организаций.')).toBeTruthy();
  });

  it('toggling a per-org checkbox updates its checked state', async () => {
    renderActions({ initialAssignedOrgIds: ['org1'] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    const org2Checkbox = within(dialog).getByLabelText('ООО Вторая') as HTMLInputElement;
    expect(org2Checkbox.checked).toBe(false);
    fireEvent.click(org2Checkbox);
    expect(org2Checkbox.checked).toBe(true);
    // unchecking org1 too
    const org1Checkbox = within(dialog).getByLabelText('ООО Ромашка') as HTMLInputElement;
    fireEvent.click(org1Checkbox);
    expect(org1Checkbox.checked).toBe(false);
  });

  it('checking "все организации" back on hides the per-org list again', async () => {
    renderActions({ initialAssignedOrgIds: ['org1'] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    const allCheckbox = within(dialog).getByLabelText('Доступ ко всем организациям партнёра') as HTMLInputElement;
    fireEvent.click(allCheckbox);
    expect(allCheckbox.checked).toBe(true);
    expect(within(dialog).queryByText('ООО Ромашка')).toBeNull();
  });

  it('"Сохранить" is disabled when allOrgs is false and no org is selected', async () => {
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    const allCheckbox = within(dialog).getByLabelText('Доступ ко всем организациям партнёра') as HTMLInputElement;
    fireEvent.click(allCheckbox); // uncheck "all" -> 0 selected
    const save = within(dialog).getByText('Сохранить') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('saveOrgs success path: PUT assignedOrgIds=[] when allOrgs, closes dialog and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent.submit(within(dialog).getByText('Сохранить').closest('form')!);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/team/u1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ assignedOrgIds: [] }) })
    );
  });

  it('saveOrgs success path: PUT specific assignedOrgIds when allOrgs is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderActions({ initialAssignedOrgIds: ['org1'] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent.submit(within(dialog).getByText('Сохранить').closest('form')!);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/partner/team/u1',
      expect.objectContaining({ body: JSON.stringify({ assignedOrgIds: ['org1'] }) })
    );
  });

  it('saveOrgs error path (JSON body): shows the translated error and does not close the dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'org_out_of_scope' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent.submit(within(dialog).getByText('Сохранить').closest('form')!);

    expect(await within(dialog).findByText('Организация вне вашей зоны видимости.')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('saveOrgs error path (non-JSON body): falls back to the generic message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('x')) });
    vi.stubGlobal('fetch', fetchMock);
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent.submit(within(dialog).getByText('Сохранить').closest('form')!);

    expect(await within(dialog).findByText('Не удалось сохранить доступ. Попробуйте ещё раз.')).toBeTruthy();
  });

  it('"Отмена" in the access dialog closes it without saving', async () => {
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Доступ к организациям' })).toBeNull());
  });

  it('opening "Удалить" shows the confirmation dialog with the member name', async () => {
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    expect(within(dialog).getByText('Иван Петров')).toBeTruthy();
  });

  it('Escape (dialog cancel event) closes the edit dialog via Dialog.onClose', async () => {
    renderActions({ initialAssignedOrgIds: [] });
    fireEvent.click(screen.getByText('Доступ'));
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к организациям' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Доступ к организациям' })).toBeNull());
  });

  it('Escape (dialog cancel event) closes the deactivate dialog via Dialog.onClose', async () => {
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Деактивировать сотрудника?' })).toBeNull());
  });

  it('"Отмена" in the deactivate dialog closes it', async () => {
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Деактивировать сотрудника?' })).toBeNull());
  });

  it('deactivate success path (204 No Content): closes and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Деактивировать'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/partner/team/u1', { method: 'DELETE' });
  });

  it('deactivate success path (200 ok): closes and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Деактивировать'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('deactivate error path: last_admin_protected maps to a specific Russian message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'last_admin_protected' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Деактивировать'));

    expect(await within(dialog).findByText('Нельзя деактивировать последнего админа партнёра')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('deactivate error path: unknown error code falls back to the generic message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'other_error' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Деактивировать'));

    expect(await within(dialog).findByText('Не удалось деактивировать. Попробуйте ещё раз.')).toBeTruthy();
  });

  it('deactivate error path: non-JSON body falls back to the generic message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.reject(new Error('x')) });
    vi.stubGlobal('fetch', fetchMock);
    renderActions();
    fireEvent.click(screen.getByText('Удалить'));
    const dialog = await screen.findByRole('dialog', { name: 'Деактивировать сотрудника?' });
    fireEvent.click(within(dialog).getByText('Деактивировать'));

    expect(await within(dialog).findByText('Не удалось деактивировать. Попробуйте ещё раз.')).toBeTruthy();
  });
});
