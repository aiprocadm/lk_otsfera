// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Статус лида из списка (этап 6 ТЗ 13.10.2026, `У-307`): по клику на бейдж —
 * список статусов, куда лид можно перевести; смена — тот же PATCH, что в
 * карточке лида. Конечные статусы — просто бейдж, без выбора.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { LeadStatusPicker } from '@/components/manager/lead-status-picker';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('LeadStatusPicker', () => {
  it('конечный статус — просто бейдж, выбрать нечего', () => {
    render(<LeadStatusPicker leadId="l1" status="rejected" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Отклонена')).toBeTruthy();
  });

  it('клик по бейджу — только допустимые переходы; повторный клик закрывает', () => {
    render(<LeadStatusPicker leadId="l1" status="in_review" />);
    const badge = screen.getByRole('button', { name: 'Статус: На рассмотрении — сменить' });
    fireEvent.click(badge);
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Новая', 'Квалифицирована']);
    fireEvent.click(badge);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('выбор статуса — PATCH setStatus, тост и обновление страницы', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<LeadStatusPicker leadId="l1" status="new" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('На рассмотрении'));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/manager/leads/l1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setStatus', status: 'in_review' }),
    });
    expect(toastMock.success).toHaveBeenCalledWith('Статус: На рассмотрении');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('сервер отказал — объяснение, список остаётся открытым', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<LeadStatusPicker leadId="l1" status="qualified" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('На рассмотрении'));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Статус не сменился — обновите страницу: лид мог уже измениться.'
      )
    );
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('нет связи — своё объяснение', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<LeadStatusPicker leadId="l1" status="new" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('На рассмотрении'));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Нет связи с сервером — попробуйте ещё раз.')
    );
  });
});
