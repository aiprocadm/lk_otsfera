// @vitest-environment jsdom
/**
 * Список документов сотрудника с массовой выгрузкой в 1С (`У-169`).
 *
 * Проверяется, что обёртка **честно** показывает, что можно выбрать, что
 * произошло с каждым выбранным документом и почему, а пустой результат
 * фильтра даёт выход — кнопку «Сбросить фильтр» (`У-74`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { requestDocumentPushManyAction, toastSuccess, refresh } = vi.hoisted(() => ({
  requestDocumentPushManyAction: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server-actions/documents/pushToOneC', () => ({ requestDocumentPushManyAction }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import {
  StaffDocumentsPushList,
  canSelectForPush,
} from '@/components/documents/staff-documents-push-list';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

function row(over: Partial<OrgDocumentRow> & { id: string }): OrgDocumentRow {
  return {
    name: `${over.id}.pdf`,
    type: 'invoice',
    direction: 'outgoing',
    signedAt: null,
    createdAt: new Date('2026-09-01'),
    size: 100,
    orderId: null,
    orderNumber: null,
    orderTitle: null,
    number: null,
    version: 1,
    oneCPushStatus: 'none',
    ...over,
  };
}

function mount(rows: OrgDocumentRow[], resetHref?: string) {
  return render(
    <StaffDocumentsPushList
      rows={rows}
      downloadEndpointBase="/api/manager/documents"
      cardHrefBase="/manager/documents"
      resetHref={resetHref}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canSelectForPush — какие строки можно выбрать', () => {
  it.each(['invoice', 'act', 'contract', 'extra_agreement'] as const)(
    'тип %s с состоянием «не выгружался» — можно',
    (type) => {
      expect(canSelectForPush(row({ id: 'a', type }))).toBe(true);
    }
  );

  it.each(['report', 'waybill', 'certificate', 'commission_statement', 'commercial_proposal', 'other'] as const)(
    'тип %s в 1С не выгружается — флажка нет',
    (type) => {
      expect(canSelectForPush(row({ id: 'a', type }))).toBe(false);
    }
  );

  it('уже в очереди или уже в 1С — выбрать нельзя; после ошибки — можно (повтор, У-159)', () => {
    expect(canSelectForPush(row({ id: 'a', oneCPushStatus: 'pending' }))).toBe(false);
    expect(canSelectForPush(row({ id: 'a', oneCPushStatus: 'pushed' }))).toBe(false);
    expect(canSelectForPush(row({ id: 'a', oneCPushStatus: 'failed' }))).toBe(true);
    expect(canSelectForPush(row({ id: 'a', oneCPushStatus: 'exported_file' }))).toBe(true);
  });
});

describe('StaffDocumentsPushList', () => {
  it('панель выбора есть только когда есть хоть одна доступная строка', () => {
    const { unmount } = mount([row({ id: 'r', type: 'report' })]);
    expect(screen.queryByRole('toolbar')).toBeNull();
    unmount();

    mount([row({ id: 'r', type: 'report' }), row({ id: 'i' })]);
    expect(screen.getByRole('toolbar', { name: 'Выгрузка выбранных документов в 1С' })).toBeTruthy();
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('флажок строки меняет счётчик; кнопка выгрузки активна только при выборе', () => {
    mount([row({ id: 'a' }), row({ id: 'b' })]);
    const push = screen.getByRole('button', { name: 'Выгрузить выбранные в 1С' }) as HTMLButtonElement;
    expect(push.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Выбрать a.pdf'));
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
    expect(push.disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('Выбрать a.pdf'));
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('«Выбрать все доступные» берёт только строки, которые можно выгрузить; «Снять выбор» очищает', () => {
    mount([row({ id: 'a' }), row({ id: 'b', oneCPushStatus: 'pushed' }), row({ id: 'c', type: 'report' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все доступные' }));
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
    expect((screen.getByLabelText('Выбрать a.pdf') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Снять выбор' }));
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('отправляет выбранные id одним действием и показывает итог с причинами пропуска', async () => {
    requestDocumentPushManyAction.mockResolvedValue({
      ok: true,
      queued: 1,
      skipped: [
        { documentId: 'b', error: 'push_disabled' },
        { documentId: 'c', error: 'push_disabled' },
        { documentId: 'd', error: 'already_queued' },
      ],
    });
    mount([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }), row({ id: 'd' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все доступные' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить выбранные в 1С' }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    const fd = requestDocumentPushManyAction.mock.calls[0][0] as FormData;
    expect(fd.getAll('documentIds').sort()).toEqual(['a', 'b', 'c', 'd']);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Поставлено в очередь: 1. Пропущено: 3.');
    expect(within(status).getByText(/^2 — .*отключена правилом компании/)).toBeTruthy();
    expect(within(status).getByText(/^1 — .*уже в очереди/)).toBeTruthy();

    expect(toastSuccess).toHaveBeenCalledWith('Поставлено в очередь на выгрузку в 1С: 1.');
    // Новое «В очереди» у строк приходит с сервера — страница перечитывается.
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('ничего не поставлено — страницу не перечитывает и тост не показывает', async () => {
    requestDocumentPushManyAction.mockResolvedValue({
      ok: true,
      queued: 0,
      skipped: [{ documentId: 'a', error: 'from_1c' }],
    });
    mount([row({ id: 'a' })]);
    fireEvent.click(screen.getByLabelText('Выбрать a.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить выбранные в 1С' }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toContain('Поставлено в очередь: 0. Пропущено: 1.');
    expect(screen.getByRole('status').textContent).toContain('пришёл из 1С');
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('отказ сервиса (нет прав) показывается по-русски', async () => {
    requestDocumentPushManyAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    mount([row({ id: 'a' })]);
    fireEvent.click(screen.getByLabelText('Выбрать a.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Выгрузить выбранные в 1С' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Нет прав выгружать документы в 1С.');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('пустой результат при активном фильтре объясняет и даёт «Сбросить фильтр» (У-74)', () => {
    mount([], '/manager/documents?tab=general');
    expect(screen.getByText('По этому фильтру документов нет')).toBeTruthy();
    const reset = screen.getByRole('link', { name: 'Сбросить фильтр' }) as HTMLAnchorElement;
    expect(reset.getAttribute('href')).toBe('/manager/documents?tab=general');
  });

  it('пустой список без фильтра — обычное пустое состояние общего списка', () => {
    mount([]);
    expect(screen.queryByText('Сбросить фильтр')).toBeNull();
    expect(screen.getByText('Ничего не нашлось')).toBeTruthy();
  });
});
