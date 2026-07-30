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

const { convertLeadToDealAction } = vi.hoisted(() => ({ convertLeadToDealAction: vi.fn() }));
vi.mock('@/server-actions/deals', () => ({ convertLeadToDealAction }));

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

  it('in_review: renders qualify and "Вернуть в новые" buttons; qualified extra button absent', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'in_review',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).toContain('Квалифицировать');
    expect(html).toContain('Вернуть в новые');
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
    expect(html).not.toContain('Вернуть в новые');
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
    expect(html).not.toContain('Вернуть в новые');
  });

  it('candidates present (non-terminal): renders manager select and "Передать" button', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null,
        candidates: [{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]
      })
    );
    expect(html).toContain('Выберите менеджера');
    expect(html).toContain('Мария (m@x.ru)');
    expect(html).toContain('Передать');
  });

  it('no candidates: transfer select and "Передать" button are absent', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null
      })
    );
    expect(html).not.toContain('Передать');
    expect(html).not.toContain('Выберите менеджера');
  });

  it('terminal status: transfer select is absent even with candidates', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'promoted_to_order',
        hasOrganization: true,
        promotedOrderId: 'o1',
        candidates: [{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]
      })
    );
    expect(html).not.toContain('Передать');
    expect(html).not.toContain('Выберите менеджера');
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

  it('non-ok response with a code from the central map: toasts the russian errorMessageRu text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'lifecycle_violation' }) });
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

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Недопустимый переход статуса.'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('not_found: локальная дельта «Заявка не найдена.» (центральный текст — про заказ)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) });
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

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Заявка не найдена.'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('non-ok response with an unknown code: falls back to the generic message with the raw code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'unknown_code_xyz' }) });
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

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось выполнить действие: unknown_code_xyz'));
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

  it('"Вернуть в новые" (in_review) sends setStatus=new', async () => {
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
    fireEvent.click(screen.getByText('Вернуть в новые'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка возвращена в новые'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'setStatus', status: 'new' });
    expect(refresh).toHaveBeenCalled();
  });

  it('передача: выбор кандидата + «Передать» шлёт assign с assignToUserId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null,
        candidates: [
          { id: 'm2', name: 'Мария', email: 'm@x.ru' },
          { id: 'm3', name: 'Пётр', email: 'p@x.ru' }
        ]
      })
    );
    fireEvent.change(screen.getByLabelText('Менеджер для передачи заявки'), { target: { value: 'm2' } });
    fireEvent.click(screen.getByText('Передать'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка передана менеджеру'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'assign', assignToUserId: 'm2' });
    expect(refresh).toHaveBeenCalled();
  });

  it('«Передать» без выбранного кандидата: кнопка disabled, fetch не вызывается', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null,
        candidates: [{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]
      })
    );
    const btn = screen.getByText('Передать').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid_manager от бэкенда: тост «Выбранный менеджер недоступен», выбор в селекте сохраняется', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_manager' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null,
        candidates: [{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]
      })
    );
    const select = screen.getByLabelText('Менеджер для передачи заявки') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm2' } });
    fireEvent.click(screen.getByText('Передать'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Выбранный менеджер недоступен'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(select.value).toBe('m2');
  });

  it('после успешной передачи селект сброшен и «Передать» снова disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'new',
        hasOrganization: true,
        promotedOrderId: null,
        candidates: [{ id: 'm2', name: 'Мария', email: 'm@x.ru' }]
      })
    );
    const select = screen.getByLabelText('Менеджер для передачи заявки') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm2' } });
    fireEvent.click(screen.getByText('Передать'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка передана менеджеру'));
    await waitFor(() => expect(select.value).toBe(''));
    expect((screen.getByText('Передать').closest('button') as HTMLButtonElement).disabled).toBe(true);
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

describe('ManagerLeadActions — сделки (deals_pipeline, ФТ-4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('promoted_to_deal: ссылка «Открыть сделки» вместо кнопок действий', () => {
    const html = renderToString(
      React.createElement(ManagerLeadActions, {
        leadId: 'l1',
        status: 'promoted_to_deal',
        hasOrganization: true,
        promotedOrderId: null,
        dealsEnabled: true
      })
    );
    expect(html).toContain('href="/manager/deals"');
    expect(html).not.toContain('Преобразовать в заказ');
  });

  it('кнопка «Создать сделку» есть только при включённом deals_pipeline', () => {
    const on = renderToString(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null, dealsEnabled: true })
    );
    expect(on).toContain('Создать сделку');

    const off = renderToString(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null })
    );
    expect(off).not.toContain('Создать сделку');
  });

  it('создание сделки: подтверждение → экшен → toast со ссылкой → refresh', async () => {
    // Конверсия лида в сделку необратима (лид уходит в терминальный статус),
    // поэтому стоит подтверждение. Успех должен вести менеджера на доску.
    convertLeadToDealAction.mockResolvedValue({ ok: true, dealId: 'd1' });
    render(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null, dealsEnabled: true })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Создать сделку' }));
    expect(screen.getByText('Создать сделку из лида?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Да, создать сделку' }));
    await waitFor(() => expect(convertLeadToDealAction).toHaveBeenCalled());
    const fd = convertLeadToDealAction.mock.calls[0]![0] as FormData;
    expect(fd.get('leadId')).toBe('l1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ конверсии: русский текст по коду, незнакомый код → общий текст', async () => {
    convertLeadToDealAction.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    render(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null, dealsEnabled: true })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать сделку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, создать сделку' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Лид уже передан или отклонён.'));
    expect(refresh).not.toHaveBeenCalled();

    toastError.mockClear();
    convertLeadToDealAction.mockResolvedValue({ ok: false, error: 'quota' });
    fireEvent.click(screen.getByRole('button', { name: 'Создать сделку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, создать сделку' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось создать сделку.'));
  });

  it('Escape закрывает подтверждение так же, как «Отмена»', async () => {
    render(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null, dealsEnabled: true })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать сделку' }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
    expect(convertLeadToDealAction).not.toHaveBeenCalled();
  });

  it('«Отмена» в подтверждении закрывает диалог без вызова экшена', async () => {
    render(
      React.createElement(ManagerLeadActions, { leadId: 'l1', status: 'new', hasOrganization: true, promotedOrderId: null, dealsEnabled: true })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать сделку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
    expect(convertLeadToDealAction).not.toHaveBeenCalled();
  });
});
