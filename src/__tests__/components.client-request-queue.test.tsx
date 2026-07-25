// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';

function row(overrides: Partial<ClientRequestRow> = {}): ClientRequestRow {
  return {
    id: 'cr1',
    source: 'partner_cabinet',
    companyName: 'ООО Ромашка',
    inn: null,
    contactName: 'Иван Петров',
    contactPhone: '+79990001122',
    contactEmail: null,
    subject: 'Обучение по охране труда',
    body: null,
    status: 'submitted',
    submittedByName: 'Партнёр 1',
    partnerName: 'ООО Партнёр',
    organizationName: null,
    organizationId: null,
    rejectedReason: null,
    convertedLeadId: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    triagedAt: null,
    attachmentCount: 0,
    ...overrides
  };
}

function lastPatchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as { body: string }).body);
}

describe('ClientRequestQueue', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('пустая очередь → «Обращений клиентов нет»', () => {
    render(React.createElement(ClientRequestQueue, { rows: [] }));
    expect(screen.getByText('Обращений клиентов нет')).toBeTruthy();
  });

  it('строка: компания, контакт, тема, податель (партнёр приоритетнее) и метка источника', () => {
    render(React.createElement(ClientRequestQueue, { rows: [row({ inn: '7701234567' })] }));
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText(/Иван Петров/)).toBeTruthy();
    expect(screen.getByText('Обучение по охране труда')).toBeTruthy();
    expect(screen.getByText(/ООО Партнёр/)).toBeTruthy();
    expect(screen.getByText('Партнёр')).toBeTruthy(); // SOURCE_LABEL partner_cabinet
    expect(screen.getByText(/ИНН 7701234567/)).toBeTruthy();
    expect(screen.getByText('Подана')).toBeTruthy();
  });

  it('раскрытие строки: описание + ленивая подгрузка вложений, «Свернуть» скрывает', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            id: 'a1',
            name: 'смета.pdf',
            size: 1024,
            mimeType: 'application/pdf',
            createdAt: '2024-01-16T09:00:00Z',
            createdByUserName: null
          }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(ClientRequestQueue, {
        rows: [row({ body: 'Нужно обучить 10 сотрудников', attachmentCount: 1 })]
      })
    );

    fireEvent.click(screen.getByText('Подробнее'));

    expect(fetchMock).toHaveBeenCalledWith('/api/client-requests/cr1/attachments');
    expect(screen.getByText('Нужно обучить 10 сотрудников')).toBeTruthy();
    expect(screen.getByText(/Вложения \(1\)/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('смета.pdf')).toBeTruthy());

    fireEvent.click(screen.getByText('Свернуть'));
    expect(screen.queryByText('Нужно обучить 10 сотрудников')).toBeNull();
  });

  it('раскрытие без описания → «Без описания»; сбой подгрузки вложений → тихо пустой список', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(React.createElement(ClientRequestQueue, { rows: [row({ body: null })] }));

    fireEvent.click(screen.getByText('Подробнее'));

    expect(screen.getByText('Без описания')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Пока нет вложений')).toBeTruthy());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('submitted: все три кнопки — «Взять в работу», «Принять → создать лид», «Отклонить»', () => {
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));
    expect(screen.getByRole('button', { name: 'Взять в работу' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Принять → создать лид' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
  });

  it('in_triage: «Взять в работу» скрыта, принять/отклонить доступны', () => {
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'in_triage' })] }));
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Принять → создать лид' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
  });

  it('терминальные статусы (converted/rejected): кнопок действий нет, у rejected видна причина', () => {
    render(
      React.createElement(ClientRequestQueue, {
        rows: [
          row({ id: 'cr-c', status: 'converted' }),
          row({ id: 'cr-r', status: 'rejected', rejectedReason: 'Дубликат', subject: 'Второе' })
        ]
      })
    );
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Принять → создать лид' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull();
    expect(screen.getByText('Дубликат')).toBeTruthy();
  });

  it('«Взять в работу»: PATCH takeInTriage, тост успеха, refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Обращение взято в работу'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/client-requests/cr1',
      expect.objectContaining({ method: 'PATCH', headers: { 'content-type': 'application/json' } })
    );
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'takeInTriage' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('«Принять → создать лид»: PATCH convertToLead, тост со ссылкой /manager/leads/<leadId>', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leadId: 'lead-9' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'in_triage' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'convertToLead' });
    // Аргумент тоста — JSX со ссылкой на созданный лид
    const toastArg = toastSuccess.mock.calls[0][0] as React.ReactElement;
    const toastHtml = renderToString(toastArg).replace(/<!-- -->/g, '');
    expect(toastHtml).toContain('href="/manager/leads/lead-9"');
    expect(toastHtml).toContain('Лид создан');
    expect(toastHtml).toContain('открыть лид');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('convertToLead без leadId в ответе → обычный текстовый тост «Лид создан»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'in_triage' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Лид создан'));
  });

  it('«Отклонить»: причина из prompt уходит в PATCH reject', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Спам');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    expect(window.prompt).toHaveBeenCalledWith('Причина отклонения:');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Обращение отклонено'));
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'reject', reason: 'Спам' });
  });

  it('«Отклонить»: отмена prompt (null) не шлёт запрос', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ошибка сервера → toast.error с кодом, refresh не зовётся', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'invalid_status' }) })
    );
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: invalid_status'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('неразбираемый json ошибки → в тосте статус-код', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        }
      })
    );
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: 500'));
  });

  it('сетевой сбой → «Сетевая ошибка»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('во время PATCH кнопки строки заблокированы (loading)', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }))
    );
    render(React.createElement(ClientRequestQueue, { rows: [row({ status: 'submitted' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Взять в работу' }) as HTMLButtonElement).disabled).toBe(true)
    );
    expect((screen.getByRole('button', { name: 'Принять → создать лид' }) as HTMLButtonElement).disabled).toBe(true);

    resolveFetch({ ok: true, json: async () => ({}) });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
