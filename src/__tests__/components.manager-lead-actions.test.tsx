// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

import { ManagerLeadActions } from '@/components/manager/manager-lead-actions';

describe('ManagerLeadActions (SSR structure)', () => {
  it('promoted_to_order with promotedOrderId: renders "Открыть заказ" link', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'promoted_to_order',
        hasOrganization: true,
        promotedOrderId: 'o1'
      })
    );
    expect(html).toContain('href="/manager/orders/o1"');
    expect(html).toContain('Открыть заказ');
  });

  it('promoted_to_order without promotedOrderId: renders fallback text', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'promoted_to_order',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Заявка преобразована в заказ');
  });

  it('rejected: renders read-only text', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'rejected',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Заявка отклонена');
  });

  it('in_review: renders qualify button; new/qualified extra buttons absent', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'in_review',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Квалифицировать');
    expect(html).not.toContain('Вернуть на рассмотрение');
  });

  it('qualified: renders "Вернуть на рассмотрение" button', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'qualified',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Вернуть на рассмотрение');
    expect(html).not.toContain('Квалифицировать');
  });

  it('new: neither in_review nor qualified button rendered', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).not.toContain('Квалифицировать');
    expect(html).not.toContain('Вернуть на рассмотрение');
  });

  it('hasOrganization=false: "Преобразовать в заказ" is disabled with a title hint', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: false,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Сначала привяжите организацию к заявке');
    expect(html).toContain('disabled');
  });

  it('hasOrganization=true: no disabled-hint title on the promote button', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).not.toContain('Сначала привяжите организацию к заявке');
  });
});

describe('ManagerLeadActions (interactive, jsdom)', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('"Взять в работу" success path: PATCHes assign, toasts success, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Взять в работу'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка взята в работу'));
    expect(fetchMock).toHaveBeenCalledWith('/api/manager/leads/l1', expect.objectContaining({ method: 'PATCH' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'assign' });
    expect(refresh).toHaveBeenCalled();
  });

  it('non-ok response with json error body: toasts the error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad_request' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Взять в работу'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось выполнить действие: bad_request'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('non-ok response with unparsable json body: falls back to res.status in the message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Взять в работу'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось выполнить действие: 500'));
  });

  it('network failure: catch branch toasts a generic network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Взять в работу'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('"Отклонить": prompt returning a reason sends reject action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Не подходит');

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Отклонить'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка отклонена'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'reject', reason: 'Не подходит' });
    promptSpy.mockRestore();
  });

  it('"Отклонить": prompt cancelled (null) does not call fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Отклонить'));

    expect(fetchMock).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('"Квалифицировать" (in_review) sends setStatus=qualified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'in_review',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Квалифицировать'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка квалифицирована'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'setStatus', status: 'qualified' });
  });

  it('"Вернуть на рассмотрение" (qualified) sends setStatus=in_review', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'qualified',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Вернуть на рассмотрение'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Возвращено на рассмотрение'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'setStatus', status: 'in_review' });
  });

  it('"Преобразовать в заказ" sends promote action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    fireEvent.click(screen.getByText('Преобразовать в заказ'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Создан заказ из заявки'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'promote' });
  });
});
