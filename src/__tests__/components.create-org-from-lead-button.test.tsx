// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { createOrgFromLeadAction } = vi.hoisted(() => ({ createOrgFromLeadAction: vi.fn() }));
vi.mock('@/server-actions/manager/leads', () => ({ createOrgFromLeadAction }));

import { CreateOrgFromLeadButton } from '@/components/manager/create-org-from-lead-button';

/**
 * `У-161` — «Завести организацию» на карточке лида.
 *
 * Проверяем то, что человек читает после нажатия: он должен понять, создали
 * ему карточку или привязали существующую (у второй уже есть чужая история) и
 * сколько бумаг переехало.
 */
beforeEach(() => vi.clearAllMocks());

describe('CreateOrgFromLeadButton', () => {
  it('создание и привязка существующей описываются РАЗНЫМИ словами', async () => {
    createOrgFromLeadAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-1',
      created: true,
      transferred: 2,
    });
    render(React.createElement(CreateOrgFromLeadButton, { leadId: 'lead-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завести организацию' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]![0])).toContain('Организация создана');

    vi.clearAllMocks();
    createOrgFromLeadAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-1',
      created: false,
      transferred: 0,
    });
    render(React.createElement(CreateOrgFromLeadButton, { leadId: 'lead-2' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Завести организацию' })[0]!);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]![0])).toContain('существующей организации');
  });

  it('число переехавших бумаг называется ВСЕГДА, в том числе ноль', async () => {
    // Ноль — это тоже ответ: иначе человек пойдёт искать предложения на
    // карточке организации и не найдёт.
    createOrgFromLeadAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-1',
      created: true,
      transferred: 0,
    });
    render(React.createElement(CreateOrgFromLeadButton, { leadId: 'lead-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завести организацию' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]![0])).toContain('Предложений перенесено: 0');
  });

  it('отказ показывается РУССКОЙ строкой, а не кодом', async () => {
    createOrgFromLeadAction.mockResolvedValue({ ok: false, error: 'already_linked' });
    render(React.createElement(CreateOrgFromLeadButton, { leadId: 'lead-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завести организацию' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]![0])).toContain('организация уже есть');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('после успеха карточка обновляется — организация должна появиться на экране', async () => {
    createOrgFromLeadAction.mockResolvedValue({
      ok: true,
      organizationId: 'org-1',
      created: true,
      transferred: 1,
    });
    render(React.createElement(CreateOrgFromLeadButton, { leadId: 'lead-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завести организацию' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
