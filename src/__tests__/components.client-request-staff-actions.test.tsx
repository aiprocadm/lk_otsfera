// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

// Форма предложения — отдельный компонент со своей загрузкой данных; здесь
// важно ТОЛЬКО то, что она открывается с нужным лидом и что закрытие формы
// обновляет экран. Подменяем её целиком.
const { proposalClosed } = vi.hoisted(() => ({ proposalClosed: vi.fn() }));
vi.mock('@/components/documents/issue-order-less-document-button', () => ({
  IssueLeadProposalDialog: (props: { leadId: string; onClose: () => void }) =>
    React.createElement(
      'button',
      {
        'data-testid': 'proposal-dialog',
        onClick: () => {
          proposalClosed();
          props.onClose();
        },
      },
      props.leadId
    ),
}));

import { ClientRequestStaffActions } from '@/components/client-requests/client-request-staff-actions';

/**
 * `У-116`, `У-161` — действия сотрудника над обращением.
 *
 * Главное здесь — сценарий «принять и сразу выставить КП». Он состоит из ДВУХ
 * шагов, и склеены они в интерфейсе, а не на сервере: состав и цены человек
 * набирает руками, одним вызовом это не выполнить. Значит проверять надо не
 * «сработало», а поведение на стыке: что показано, что произойдёт, если
 * второй шаг не удастся, и не исчезнет ли форма из-под рук.
 */
const request = (status: 'submitted' | 'in_triage' | 'converted' = 'submitted') => ({
  id: 'cr-1',
  status,
});

function renderActions(
  over: { canIssueProposal?: boolean; status?: 'submitted' | 'converted' } = {}
) {
  return render(
    React.createElement(ClientRequestStaffActions, {
      request: request(over.status ?? 'submitted'),
      leadHrefBase: '/manager/leads',
      canIssueProposal: over.canIssueProposal ?? true,
    })
  );
}

const okResponse = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse({ leadId: 'lead-9' }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClientRequestStaffActions — «принять и выставить КП» (`У-161`)', () => {
  it('кнопки нет, когда выпуск документов выключен', () => {
    // Флаг читает страница: компонент клиентский и сам его не видит.
    renderActions({ canIssueProposal: false });
    expect(screen.getByRole('button', { name: 'Принять → создать лид' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Принять и выставить КП' })).toBeNull();
  });

  it('после успеха открывается форма ИМЕННО созданного лида', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    const dialog = await screen.findByTestId('proposal-dialog');
    expect(dialog.textContent).toBe('lead-9');
  });

  it('тост со ссылкой на лид показан ДО формы: даже если форма не откроется, след остался', async () => {
    // Обратный порядок оставил бы человека с одной непонятной ошибкой и без
    // следа сделанного: обращение уже закрыто, лид уже создан, а он об этом
    // не знает.
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    await screen.findByTestId('proposal-dialog');
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('список НЕ обновляется, пока форма открыта', async () => {
    // Иначе `router.refresh()` перерисует обращение закрытым, компонент уйдёт
    // в ранний выход, и форма умрёт на глазах вместе с набранным составом.
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    await screen.findByTestId('proposal-dialog');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('обновление приходит при закрытии формы — тогда состав уже сохранён', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    fireEvent.click(await screen.findByTestId('proposal-dialog'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('proposal-dialog')).toBeNull();
  });

  it('форма переживает закрытие обращения: она смонтирована выше раннего выхода', async () => {
    // Обращение после первого шага становится «converted», и компонент рисует
    // только строку «действий больше нет». Если форма живёт внутри этой ветки,
    // она исчезнет ровно тогда, когда нужна.
    const { rerender } = renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    await screen.findByTestId('proposal-dialog');

    rerender(
      React.createElement(ClientRequestStaffActions, {
        request: request('converted'),
        leadHrefBase: '/manager/leads',
        canIssueProposal: true,
      })
    );
    expect(
      screen.getByText('Обращение закрыто — статус больше не меняется, но ответить клиенту можно.')
    ).toBeTruthy();
    expect(screen.getByTestId('proposal-dialog')).toBeTruthy();
  });

  it('первый шаг не удался — формы нет и список не трогаем', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'lifecycle_violation' }),
      }))
    );
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять и выставить КП' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByTestId('proposal-dialog')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('обычная кнопка «создать лид» форму не открывает и обновляет список сразу', async () => {
    // Заводить лид «на потом», не называя цену, тоже нужно — поэтому кнопки
    // две, а не одна.
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('proposal-dialog')).toBeNull();
  });

  it('«Взять в работу» меняет статус и обновляет экран, не трогая форму КП', async () => {
    // Промежуточный шаг «взял, но лида ещё нет» нужен, когда обращение надо
    // за собой закрепить, а разбираться позже. Кнопка есть только у обращения
    // в статусе «отправлено» — у взятого закреплять уже нечего.
    // Тип аргументов объявлен явно: без него `mock.calls` получает пустой
    // кортеж, и обращение к `calls[0][1]` не проходит проверку типов.
    const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<unknown>>(async () =>
      okResponse({})
    );
    vi.stubGlobal('fetch', fetchMock);
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      action: 'takeInTriage',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Обращение взято в работу');
    expect(screen.queryByTestId('proposal-dialog')).toBeNull();
  });

  it('у взятого в работу обращения кнопки «Взять в работу» уже нет', () => {
    render(
      React.createElement(ClientRequestStaffActions, {
        request: { id: 'cr-1', status: 'in_triage' },
        leadHrefBase: '/manager/leads',
        canIssueProposal: true,
      })
    );
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
  });
});

describe('ответ клиенту (этап 6, У-238)', () => {
  it('кнопка «Ответить» недоступна без текста; с текстом шлёт action reply и очищает поле', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(ClientRequestStaffActions, {
        request: { id: 'R1', status: 'in_triage' },
        leadHrefBase: '/manager/leads',
      })
    );
    const btn = screen.getByRole('button', { name: 'Ответить' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const area = screen.getByLabelText('Ответ клиенту') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Группа набрана' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'reply',
      text: 'Группа набрана',
    });
    await waitFor(() => expect(area.value).toBe(''));
    vi.unstubAllGlobals();
  });

  it('по закрытому обращению статус не меняется, но ответить можно', () => {
    render(
      React.createElement(ClientRequestStaffActions, {
        request: { id: 'R1', status: 'converted' },
        leadHrefBase: '/manager/leads',
      })
    );
    expect(screen.getByText(/ответить клиенту можно/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ответить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull();
  });
});

/**
 * Отклонение обращения и сбои сети (`У-116`).
 *
 * Про отклонение важно одно: **отмена окна причины — это отмена действия**.
 * Пустая строка («причину не написал») и нажатие «Отмена» выглядят похоже, но
 * означают разное: первое — «отклоняю без объяснения», второе — «передумал».
 * Спутать их значит отклонить обращение, которого никто не отклонял.
 */
describe('ClientRequestStaffActions — отклонение и сбои', () => {
  it('причина уходит на сервер вместе с действием', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('дубль обращения');

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(body).toEqual({ action: 'reject', reason: 'дубль обращения' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Обращение отклонено'));
    prompt.mockRestore();
  });

  it('пустая причина — это всё же отклонение', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('');

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    prompt.mockRestore();
  });

  it('отмена окна — на сервер ничего не уходит', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    expect(fetch).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('сервер ответил отказом — видна его причина, а не «что-то пошло не так»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'wrong_status' }) }))
    );

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: wrong_status'));
  });

  it('отказ без причины — показываем хотя бы код ответа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: 500'));
  });

  it('сеть отвалилась — честная «Сетевая ошибка», а не тишина', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );

    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Принять → создать лид' }));

    // Молчание оставило бы человека нажимать кнопку снова и снова.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('«Взять в работу» есть только у нового обращения', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Взять в работу' })).toBeTruthy();

    renderActions({ status: 'converted' });
    expect(screen.queryAllByRole('button', { name: 'Взять в работу' })).toHaveLength(1);
  });
});
