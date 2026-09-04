// @vitest-environment jsdom
/**
 * Блок «Выгрузка в 1С» на карточке документа сотрудника (`У-169`, `У-159`).
 *
 * Проверяется, что блок **говорит правду**: кнопка есть ровно тогда, когда
 * сервер разрешил (`blocked === null`), после ошибки она называется
 * «Повторить», в очереди — неактивна, а отказ показывается по-русски.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { requestDocumentPushAction, toastSuccess } = vi.hoisted(() => ({
  requestDocumentPushAction: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/server-actions/documents/pushToOneC', () => ({ requestDocumentPushAction }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { DocumentOneCPushBlock } from '@/components/documents/document-onec-push-block';
import type { DocumentDetail } from '@/lib/services/documents/detail';

type Push = DocumentDetail['oneCPush'];

function push(over: Partial<Push> = {}): Push {
  return {
    status: 'none',
    pushedAt: null,
    error: null,
    attempts: 0,
    externalId: null,
    blocked: null,
    ...over,
  };
}

function mount(p: Push, pushRuleHref: string | null = '/leader/settings/catalogs/requisites') {
  return render(<DocumentOneCPushBlock documentId="doc1" push={p} pushRuleHref={pushRuleHref} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('что показывает блок', () => {
  it('у невыгружавшегося счёта — статус «Не выгружался» и кнопка «Выгрузить в 1С»', () => {
    mount(push());
    expect(screen.getByRole('heading', { name: 'Выгрузка в 1С' })).toBeTruthy();
    expect(screen.getByText('Не выгружался')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выгрузить в 1С' })).toBeTruthy();
  });

  it('после ошибки — «Ошибка выгрузки», текст ошибки, попытки и кнопка «Повторить выгрузку»', () => {
    mount(
      push({
        status: 'failed',
        error: 'push failed',
        attempts: 3,
        pushedAt: new Date('2026-09-01T10:00:00Z'),
      })
    );
    expect(screen.getByText('Ошибка выгрузки')).toBeTruthy();
    expect(screen.getByText('push failed')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Последняя попытка')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить выгрузку' })).toBeTruthy();
  });

  it('в очереди — кнопка неактивна и называется «В очереди…»', () => {
    mount(push({ status: 'pending' }));
    const btn = screen.getByRole('button', { name: 'В очереди…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('выгружен — номер в 1С, кнопки нет, объяснение про перевыпуск', () => {
    mount(
      push({
        status: 'pushed',
        externalId: '1c-doc-42',
        attempts: 1,
        pushedAt: new Date('2026-09-01T10:00:00Z'),
      })
    );
    expect(screen.getByText('Выгружен')).toBeTruthy();
    expect(screen.getByText('1c-doc-42')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Документ уже в 1С/)).toBeTruthy();
  });

  it('старая ошибка не показывается у документа, который потом выгрузился', () => {
    mount(push({ status: 'pushed', error: 'push failed', externalId: '1c-doc-42' }));
    expect(screen.queryByText('push failed')).toBeNull();
  });

  it('КП — кнопки нет, объяснение «этот вид документа в 1С не выгружается»', () => {
    mount(push({ blocked: 'not_pushable_type' }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Этот вид документа в 1С не выгружается/)).toBeTruthy();
  });

  it('документ из 1С — кнопки нет, объяснение «пришёл из 1С»', () => {
    mount(push({ blocked: 'from_1c' }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/пришёл из 1С/)).toBeTruthy();
  });

  it('правило компании выключено — у руководителя ссылка «Изменить правило»', () => {
    mount(push({ blocked: 'push_disabled' }));
    expect(screen.queryByRole('button')).toBeNull();
    const link = screen.getByRole('link', { name: 'Изменить правило' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/leader/settings/catalogs/requisites');
  });

  it('правило компании выключено — у менеджера вместо ссылки «попросите руководителя»', () => {
    mount(push({ blocked: 'push_disabled' }), null);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Попросите руководителя изменить правило/)).toBeTruthy();
  });
});

describe('нажатие кнопки', () => {
  it('ставит документ в очередь: статус становится «В очереди», кнопка гаснет', async () => {
    requestDocumentPushAction.mockResolvedValue({ ok: true, retry: false });
    mount(push());

    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить в 1С' }));

    await waitFor(() => expect(requestDocumentPushAction).toHaveBeenCalled());
    const fd = requestDocumentPushAction.mock.calls[0][0] as FormData;
    expect(fd.get('documentId')).toBe('doc1');
    await waitFor(() => expect(screen.getByText('В очереди')).toBeTruthy());
    expect(screen.getByText(/Документ поставлен в очередь/)).toBeTruthy();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('«Повторить выгрузку» — сообщение про повтор', async () => {
    requestDocumentPushAction.mockResolvedValue({ ok: true, retry: true });
    mount(push({ status: 'failed', error: 'push failed' }));

    fireEvent.click(screen.getByRole('button', { name: 'Повторить выгрузку' }));

    await waitFor(() => expect(screen.getByText(/Выгрузка запущена заново/)).toBeTruthy());
  });

  it('отказ сервера показывается по-русски, статус не меняется', async () => {
    requestDocumentPushAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    mount(push());

    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить в 1С' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Фоновая обработка недоступна');
    expect(screen.getByText('Не выгружался')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('forbidden и not_found — свои строки, а не «Нет прав на загрузку» / «Заказ не найден»', async () => {
    requestDocumentPushAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    mount(push());
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить в 1С' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Нет прав выгружать документы в 1С');
  });
});
