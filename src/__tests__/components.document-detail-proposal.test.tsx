// @vitest-environment jsdom
/**
 * Приём и отклонение коммерческого предложения прямо в карточке (`У-164`,
 * `У-165`).
 *
 * Главное здесь — **сообщение говорит ровно то, что произошло**: «создан
 * заказ», «строки перенесены» и «состав не менялся» — три разных исхода, и от
 * них зависит, куда человеку идти дальше. Общая фраза «принято» оставила бы
 * его гадать.
 *
 * Второе: **причину отклонения спрашивают до обращения к серверу** — пустой
 * ответ ничем не отличается от «передумал нажимать», и беспокоить сервер
 * незачем.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { acceptProposalAction, rejectProposalAction, toastSuccess, toastError } = vi.hoisted(() => ({
  acceptProposalAction: vi.fn(),
  rejectProposalAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/server-actions/documents/accept', () => ({
  acceptDocumentAction: vi.fn(),
  acceptProposalAction,
  rejectProposalAction,
}));
vi.mock('@/server-actions/documents/send', () => ({ sendDocumentAction: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DocumentDetailView } from '@/components/documents/document-detail-view';
import type { DocumentDetail } from '@/lib/services/documents/detail';

function proposal(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc1',
    name: 'Предложение №5',
    type: 'commercial_proposal',
    direction: 'outgoing',
    number: 'КП-2026-5',
    version: 1,
    canUploadVersion: false,
    size: 2048,
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    scanReason: null,
    signedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    uploadedByName: 'Иванов',
    source: 'generated',
    status: 'sent',
    amountGross: '12000.00',
    sentAt: new Date('2026-07-02T00:00:00Z'),
    acceptedAt: null,
    payment: null,
    order: null,
    rejectReason: null,
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    oneCPush: {
      status: 'none',
      pushedAt: null,
      error: null,
      attempts: 0,
      externalId: null,
      blocked: null,
    },
    ...over,
  } as DocumentDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Кто видит кнопки предложения', () => {
  it('заказчик видит и «Принять предложение», и «Отклонить»', () => {
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    expect(screen.getByText('Принять предложение')).toBeTruthy();
    expect(screen.getByText('Отклонить')).toBeTruthy();
  });

  it('сотрудник видит только приёмку — отказ клиента это его ответ, не наш', () => {
    render(<DocumentDetailView document={proposal()} backHref="/x" />);

    expect(screen.getByText('Принять предложение')).toBeTruthy();
    expect(screen.queryByText('Отклонить')).toBeNull();
  });

  it('черновик принять нельзя — клиент его не видел', () => {
    render(<DocumentDetailView document={proposal({ status: 'draft' })} backHref="/x" canAccept />);

    expect(screen.queryByText('Принять предложение')).toBeNull();
  });
});

describe('Приём предложения', () => {
  it.each([
    [
      { ok: true, orderCreated: true, linesTransferred: 3, keptExistingLines: false },
      'создан заказ',
    ],
    [
      { ok: true, orderCreated: false, linesTransferred: 2, keptExistingLines: false },
      'Строк перенесено в заказ: 2',
    ],
    [
      { ok: true, orderCreated: false, linesTransferred: 0, keptExistingLines: true },
      'Состав заказа не менялся',
    ],
  ])('сообщение соответствует исходу: %#', async (result, text) => {
    acceptProposalAction.mockResolvedValue(result);
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Принять предложение'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]?.[0])).toContain(text);
  });

  it('после приёма кнопки исчезают — второй раз принимать нечего', async () => {
    acceptProposalAction.mockResolvedValue({
      ok: true,
      orderCreated: true,
      linesTransferred: 1,
      keptExistingLines: false,
    });
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Принять предложение'));

    await waitFor(() => expect(screen.queryByText('Принять предложение')).toBeNull());
  });

  it('отказ сервиса показывается по-русски, состояние не меняется', async () => {
    acceptProposalAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Принять предложение'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Принять предложение')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('Отклонение предложения', () => {
  it('причину спрашивают до сервера; отказ от ввода ничего не шлёт', () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => null)
    );
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Отклонить'));

    expect(rejectProposalAction).not.toHaveBeenCalled();
  });

  it('причина уходит вместе с отклонением', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'дорого')
    );
    rejectProposalAction.mockResolvedValue({ ok: true });
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Отклонить'));

    await waitFor(() => expect(rejectProposalAction).toHaveBeenCalled());
    const fd = rejectProposalAction.mock.calls[0]![0] as FormData;
    expect(fd.get('reason')).toBe('дорого');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Предложение отклонено — менеджер увидит вашу причину.'
    );
  });

  it('после отклонения кнопки исчезают', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'не подошло')
    );
    rejectProposalAction.mockResolvedValue({ ok: true });
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Отклонить'));

    await waitFor(() => expect(screen.queryByText('Отклонить')).toBeNull());
  });

  it('отказ сервиса объясняется, кнопка остаётся', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'дорого')
    );
    rejectProposalAction.mockResolvedValue({ ok: false, error: 'reason_required' });
    render(<DocumentDetailView document={proposal()} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Отклонить'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Отклонить')).toBeTruthy();
  });
});
