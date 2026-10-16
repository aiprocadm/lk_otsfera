// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * «Создать организацию» в «Организациях» (этап 6 ТЗ 13.10.2026, `У-308`):
 * после создания — карточка новой организации; уже заведённая — ссылка на
 * неё вместо дубля; прочие отказы — русской строкой.
 */
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const { createOrganizationAction } = vi.hoisted(() => ({ createOrganizationAction: vi.fn() }));
vi.mock('@/server-actions/organizations/create', () => ({ createOrganizationAction }));

import { CreateOrganizationButton } from '@/components/manager/create-organization-button';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => vi.clearAllMocks());

function openAndFill(name: string, inn = '') {
  render(<CreateOrganizationButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
  const dialog = document.querySelector('dialog[open]') as HTMLElement;
  fireEvent.change(within(dialog).getByLabelText('Название *'), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText('ИНН'), { target: { value: inn } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
  return dialog;
}

describe('CreateOrganizationButton', () => {
  it('создано — переход в карточку новой организации; пустой ИНН не отправляется', async () => {
    createOrganizationAction.mockResolvedValue({ ok: true, organizationId: 'o1', name: 'Ромашка' });
    openAndFill('Ромашка');
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/manager/organizations/o1'));
    expect(createOrganizationAction).toHaveBeenCalledWith({ name: 'Ромашка' });
  });

  it('ИНН передаётся без пробелов', async () => {
    createOrganizationAction.mockResolvedValue({ ok: true, organizationId: 'o2', name: 'Р' });
    openAndFill('Р', ' 7701234567 ');
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(createOrganizationAction).toHaveBeenCalledWith({ name: 'Р', inn: '7701234567' });
  });

  it('такая уже есть — объяснение и ссылка на неё, перехода нет', async () => {
    createOrganizationAction.mockResolvedValue({
      ok: false,
      error: 'org_exists',
      organizationId: 'o9',
    });
    const dialog = openAndFill('Ромашка');
    await waitFor(() => expect(within(dialog).getByText('Открыть')).toBeTruthy());
    expect(dialog.textContent).toContain('Такая организация уже есть.');
    expect(within(dialog).getByText('Открыть').getAttribute('href')).toBe(
      '/manager/organizations/o9'
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('ИНН у другой компании и кривой ИНН — русские объяснения; «Отмена» закрывает', async () => {
    createOrganizationAction.mockResolvedValue({ ok: false, error: 'org_in_other_company' });
    const dialog = openAndFill('Ромашка', '7701234567');
    await waitFor(() =>
      expect(dialog.textContent).toContain('ведётся другой компанией — обратитесь к администратору')
    );
    createOrganizationAction.mockResolvedValue({ ok: false, error: 'validation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(dialog.textContent).toContain('ИНН — 10 или 12 цифр'));
    createOrganizationAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(dialog.textContent).toContain('сотрудник своей компании'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('Esc закрывает окно', () => {
    render(<CreateOrganizationButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать организацию' }));
    fireEvent(
      document.querySelector('dialog[open]') as HTMLElement,
      new Event('cancel', { cancelable: true })
    );
    expect(document.querySelector('dialog[open]')).toBeNull();
  });
});
