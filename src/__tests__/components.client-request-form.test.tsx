// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ClientRequestForm } from '@/components/client-requests/client-request-form';

function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function fillRequired() {
  fireEvent.change(input('Название компании *'), { target: { value: 'ООО Ромашка' } });
  fireEvent.change(input('Контактное лицо *'), { target: { value: 'Иван Петров' } });
  fireEvent.change(input('Тема *'), { target: { value: 'Обучение ОТ' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Отправить обращение' }));
}

// Поле «Название компании» теперь PartyAutocomplete: ввод может (после
// debounce) дёрнуть /api/suggest/party. Ассерты по отправке формы смотрят
// только на вызовы /api/client-requests, чтобы не флакать на таймингах.
function requestCalls(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/client-requests') as [
    string,
    RequestInit,
  ][];
}

describe('ClientRequestForm', () => {
  beforeEach(() => {
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('обязательные поля: компания, контактное лицо и тема с required; телефон/email/ИНН/описание — нет', () => {
    render(React.createElement(ClientRequestForm));
    expect(input('Название компании *').required).toBe(true);
    expect(input('Контактное лицо *').required).toBe(true);
    expect(input('Тема *').required).toBe(true);
    expect(input('ИНН').required).toBe(false);
    expect(input('Телефон').required).toBe(false);
    expect(input('Email').required).toBe(false);
    expect((screen.getByLabelText('Описание') as HTMLTextAreaElement).required).toBe(false);
  });

  it('подсказка ДаДаты заполняет название компании и ИНН', async () => {
    // Клиент заполняет обращение сам. Подсказка избавляет его от поиска ИНН —
    // если её обработчик потеряется, поле молча останется пустым, и менеджер
    // не сможет сопоставить обращение с организацией.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            name: 'ООО Ромашка',
            inn: '7707083893',
            kpp: '770701001',
            ogrn: null,
            address: 'г. Москва',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<ClientRequestForm />);
      const combo = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(combo, { target: { value: 'ромашка' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.mouseDown(screen.getAllByRole('option')[0]);

      expect(combo.value).toBe('ООО Ромашка');
      expect((screen.getByLabelText('ИНН') as HTMLInputElement).value).toBe('7707083893');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('happy path: POST /api/client-requests со всеми полями, тост успеха, сброс формы, router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cr1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    fireEvent.change(input('ИНН'), { target: { value: '7701234567' } });
    fireEvent.change(input('Телефон'), { target: { value: '+79990001122' } });
    fireEvent.change(input('Email'), { target: { value: 'ivan@example.com' } });
    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'Обучить 10 человек' },
    });
    submit();

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Обращение отправлено — менеджер свяжется с вами')
    );
    const calls = requestCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe('/api/client-requests');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      companyName: 'ООО Ромашка',
      inn: '7701234567',
      contactName: 'Иван Петров',
      contactPhone: '+79990001122',
      contactEmail: 'ivan@example.com',
      subject: 'Обучение ОТ',
      body: 'Обучить 10 человек',
    });
    expect(refresh).toHaveBeenCalled();
    // Форма сброшена
    expect(input('Название компании *').value).toBe('');
    expect(input('ИНН').value).toBe('');
    expect(input('Тема *').value).toBe('');
    expect((screen.getByLabelText('Описание') as HTMLTextAreaElement).value).toBe('');
  });

  it('пустые необязательные поля уходят как null (inn/contactPhone/contactEmail/body)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    await waitFor(() => expect(requestCalls(fetchMock).length).toBe(1));
    expect(JSON.parse(requestCalls(fetchMock)[0][1].body as string)).toEqual({
      companyName: 'ООО Ромашка',
      inn: null,
      contactName: 'Иван Петров',
      contactPhone: null,
      contactEmail: null,
      subject: 'Обучение ОТ',
      body: null,
    });
  });

  it('400 с messages: список ошибок в role=alert, без тостов, без refresh, поля не сброшены', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'validation',
        messages: ['Укажите телефон или email', 'ИНН — 10 или 12 цифр'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Укажите телефон или email')).toBeTruthy();
    expect(screen.getByText('ИНН — 10 или 12 цифр')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(input('Название компании *').value).toBe('ООО Ромашка');
  });

  it('успешная повторная отправка убирает прежний список ошибок', async () => {
    // Ответы по порядку — только для POST формы: fetch подсказок автокомплита
    // не должен «съедать» очередь mockResolvedValueOnce.
    const responses = [
      {
        ok: false,
        status: 400,
        json: async () => ({ messages: ['Укажите телефон или email'] }),
      },
      { ok: true, json: async () => ({}) },
    ];
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/client-requests'
          ? responses.shift()!
          : { ok: true, json: async () => ({ suggestions: [] }) }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();
    await waitFor(() => expect(screen.getByText('Укажите телефон или email')).toBeTruthy());

    fireEvent.change(input('Телефон'), { target: { value: '+79990001122' } });
    submit();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(screen.queryByText('Укажите телефон или email')).toBeNull();
  });

  it('403 без messages → тост ошибки с кодом сервера', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось отправить обращение: forbidden')
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('неразбираемый json ответа → в тосте статус-код', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось отправить обращение: 500')
    );
  });

  it('сетевой сбой → тост «Сетевая ошибка», кнопка снова активна', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    const btn = screen.getByRole('button', { name: 'Отправить обращение' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it('во время запроса кнопка отправки заблокирована (loading)', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    render(React.createElement(ClientRequestForm));

    fillRequired();
    submit();

    const btn = screen.getByRole('button', { name: 'Отправить обращение' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    resolveFetch({ ok: true, json: async () => ({}) });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
