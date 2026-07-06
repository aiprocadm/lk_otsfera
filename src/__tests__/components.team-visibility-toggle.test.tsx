// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setTeamVisibilityAction } = vi.hoisted(() => ({ setTeamVisibilityAction: vi.fn() }));
vi.mock('@/server-actions/manager/teamVisibility', () => ({ setTeamVisibilityAction }));

import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';

describe('TeamVisibilityToggle', () => {
  beforeEach(() => {
    setTeamVisibilityAction.mockReset();
  });

  it('initial=true: renders "Включено" state with aria-pressed=true', () => {
    render(React.createElement(TeamVisibilityToggle, { initial: true }));
    const button = screen.getByRole('button', { name: 'Включено' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/каждый менеджер видит все заказы компании/)).toBeTruthy();
  });

  it('initial=false: renders "Выключено" state with aria-pressed=false', () => {
    render(React.createElement(TeamVisibilityToggle, { initial: false }));
    const button = screen.getByRole('button', { name: 'Выключено' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/каждый менеджер видит только свои назначения/)).toBeTruthy();
  });

  it('toggle success: flips to the opposite state', async () => {
    setTeamVisibilityAction.mockResolvedValue({ ok: true });
    render(React.createElement(TeamVisibilityToggle, { initial: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Выключено' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Включено' })).toBeTruthy());
    expect(setTeamVisibilityAction).toHaveBeenCalledWith({ enabled: true });
  });

  it('toggle failure: shows an error alert and does not flip state', async () => {
    setTeamVisibilityAction.mockResolvedValue({ ok: false });
    render(React.createElement(TeamVisibilityToggle, { initial: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Выключено' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Не удалось изменить режим')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выключено' })).toBeTruthy();
  });

  it('a second toggle attempt clears a previous error', async () => {
    setTeamVisibilityAction.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(React.createElement(TeamVisibilityToggle, { initial: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Выключено' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Выключено' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
