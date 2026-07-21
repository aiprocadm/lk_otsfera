// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

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
