// @vitest-environment jsdom
/**
 * Действия в карточке документа: «Принять» заказчиком (`У-150`) и «Отправить
 * заказчику» сотрудником (`У-149`), плюс строка оплаты счёта (`У-148`).
 *
 * Кнопки проверяются не ради самих кнопок, а ради того, что они **говорят
 * правду**: неудачная отправка не превращается в «отправлено», а счёт без
 * сопоставленных платежей не называется оплаченным.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { acceptDocumentAction, sendDocumentAction, toastSuccess } = vi.hoisted(() => ({
  acceptDocumentAction: vi.fn(),
  sendDocumentAction: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/server-actions/documents/accept', () => ({ acceptDocumentAction }));
vi.mock('@/server-actions/documents/send', () => ({ sendDocumentAction }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { DocumentDetailView } from '@/components/documents/document-detail-view';
import type { DocumentDetail } from '@/lib/services/documents/detail';

function doc(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc1',
    name: 'Счёт №5',
    type: 'invoice',
    direction: 'outgoing',
    number: 'С-2026-5',
    version: 1,
    size: 2048,
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    scanReason: null,
    signedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    uploadedByName: 'Иванов',
    status: 'issued',
    amountGross: '12000.00',
    sentAt: null,
    acceptedAt: null,
    payment: null,
    order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' },
    rejectReason: null,
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('«Принять» у заказчика (У-150)', () => {
  it('у акта кнопка «Принять», приёмка отражается на экране', async () => {
    acceptDocumentAction.mockResolvedValue({ ok: true });
    render(<DocumentDetailView document={doc({ type: 'act' })} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Принять'));
    await waitFor(() => expect(acceptDocumentAction).toHaveBeenCalled());
    expect(screen.getByText(/Документ принят — менеджер уведомлён/)).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('у договора кнопка называется «Подписать»', () => {
    render(<DocumentDetailView document={doc({ type: 'contract' })} backHref="/x" canAccept />);
    expect(screen.getByText('Подписать')).toBeTruthy();
  });

  it('у счёта кнопки приёмки нет: оплату определяют платежи', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" canAccept />);
    expect(screen.queryByText('Принять')).toBeNull();
  });

  it('отказ показывается по-русски, а не кодом', async () => {
    acceptDocumentAction.mockResolvedValue({ ok: false, error: 'invalid_transition' });
    render(<DocumentDetailView document={doc({ type: 'act' })} backHref="/x" canAccept />);

    fireEvent.click(screen.getByText('Принять'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Недопустимый переход');
    expect(screen.queryByText(/Документ принят/)).toBeNull();
  });

  it('аннулированный документ принять нельзя', () => {
    render(
      <DocumentDetailView
        document={doc({ type: 'act', status: 'cancelled' })}
        backHref="/x"
        canAccept
      />
    );
    expect(screen.queryByText('Принять')).toBeNull();
  });
});

describe('«Отправить заказчику» у сотрудника (У-149)', () => {
  it('счёт отправляется, на экране сказано про вложение', async () => {
    sendDocumentAction.mockResolvedValue({
      ok: true,
      recipients: 2,
      attached: true,
      repeat: false,
    });
    render(<DocumentDetailView document={doc()} backHref="/x" canSend />);

    fireEvent.click(screen.getByText('Отправить заказчику'));
    await waitFor(() => expect(sendDocumentAction).toHaveBeenCalled());
    expect(screen.getByText(/файл приложен к письму/)).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('одному адресату — «на 1 адрес», без выдуманного множественного числа', async () => {
    sendDocumentAction.mockResolvedValue({
      ok: true,
      recipients: 1,
      attached: true,
      repeat: false,
    });
    render(<DocumentDetailView document={doc()} backHref="/x" canSend />);

    fireEvent.click(screen.getByText('Отправить заказчику'));
    await waitFor(() => expect(screen.getByText(/на 1 адрес/)).toBeTruthy());
  });

  it('файл не приложился — на экране это сказано, а не скрыто', async () => {
    sendDocumentAction.mockResolvedValue({
      ok: true,
      recipients: 1,
      attached: false,
      repeat: false,
    });
    render(<DocumentDetailView document={doc()} backHref="/x" canSend />);

    fireEvent.click(screen.getByText('Отправить заказчику'));
    await waitFor(() => expect(screen.getByText(/приложить файл не удалось/)).toBeTruthy());
  });

  it('уже отправленный документ предлагает отправить ещё раз', () => {
    render(
      <DocumentDetailView
        document={doc({ status: 'sent', sentAt: new Date('2026-08-01') })}
        backHref="/x"
        canSend
      />
    );
    expect(screen.getByText('Отправить ещё раз')).toBeTruthy();
  });

  it('отказ объясняется по-русски и «отправлено» не пишется', async () => {
    sendDocumentAction.mockResolvedValue({ ok: false, error: 'no_recipients' });
    render(<DocumentDetailView document={doc()} backHref="/x" canSend />);

    fireEvent.click(screen.getByText('Отправить заказчику'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('нет ни одного сотрудника');
    expect(screen.queryByText(/Документ отправлен/)).toBeNull();
  });

  it('у заказчика кнопки отправки нет', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" />);
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  it('заражённый файл не предлагают отправить', () => {
    render(<DocumentDetailView document={doc({ scanStatus: 'infected' })} backHref="/x" canSend />);
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  it('документ партнёра этой кнопки не получает', () => {
    render(
      <DocumentDetailView
        document={doc({ counterparty: { type: 'partner', id: 'p1', name: 'Партнёр' } })}
        backHref="/x"
        canSend
      />
    );
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  it('скан и отчёт отправлять нечем — кнопки нет', () => {
    render(<DocumentDetailView document={doc({ type: 'report' })} backHref="/x" canSend />);
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  it('аннулированный документ не отправляется', () => {
    render(<DocumentDetailView document={doc({ status: 'cancelled' })} backHref="/x" canSend />);
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  /**
   * Этап 7 (`У-164`). Кнопка рисуется по тому же правилу, что решает сервис
   * (`canSendFromStatus`), а не по своему списку статусов. Прежний литерал
   * `['issued','sent','accepted']` прятал бы кнопку у КП-черновика, хотя
   * сервис отправку разрешает: человек видел бы бумагу, которую «нельзя
   * отправить», и шёл бы пересылать её из своей почты.
   */
  it('черновик коммерческого предложения отправить МОЖНО — у него это рабочее состояние', () => {
    render(
      <DocumentDetailView
        document={doc({ type: 'commercial_proposal', status: 'draft' })}
        backHref="/x"
        canSend
      />
    );
    expect(screen.getByText('Отправить заказчику')).toBeTruthy();
  });

  it('черновик СЧЁТА отправить нельзя: послабление касается только предложения', () => {
    render(<DocumentDetailView document={doc({ status: 'draft' })} backHref="/x" canSend />);
    expect(screen.queryByText('Отправить заказчику')).toBeNull();
  });

  /**
   * `У-165` (этап 7) — кнопки заказчика у коммерческого предложения.
   */
  it('заказчик видит «Принять предложение» и «Отклонить» у отправленного КП', () => {
    render(
      <DocumentDetailView
        document={doc({ type: 'commercial_proposal', status: 'sent' })}
        backHref="/x"
        canAccept
      />
    );
    expect(screen.getByText('Принять предложение')).toBeTruthy();
    expect(screen.getByText('Отклонить')).toBeTruthy();
  });

  it('у сотрудника «Отклонить» НЕТ: отказ — ответ клиента, а не наше действие', () => {
    // У сотрудника для «клиент отказался» есть аннулирование. Смешай их — и в
    // отчёте о причинах отказов окажутся наши собственные опечатки.
    render(
      <DocumentDetailView
        document={doc({ type: 'commercial_proposal', status: 'sent' })}
        backHref="/x"
      />
    );
    expect(screen.getByText('Принять предложение')).toBeTruthy();
    expect(screen.queryByText('Отклонить')).toBeNull();
  });

  it('у черновика и у уже отклонённого предложения кнопок нет', () => {
    for (const status of ['draft', 'rejected', 'accepted', 'expired']) {
      const { unmount } = render(
        <DocumentDetailView
          document={doc({ type: 'commercial_proposal', status })}
          backHref="/x"
          canAccept
        />
      );
      expect(screen.queryByText('Принять предложение'), status).toBeNull();
      expect(screen.queryByText('Отклонить'), status).toBeNull();
      unmount();
    }
  });

  it('причина отказа показывается в карточке — ради неё отказ и просят пояснить', () => {
    render(
      <DocumentDetailView
        document={doc({
          type: 'commercial_proposal',
          status: 'rejected',
          rejectReason: 'Дорого, ждём скидку',
        })}
        backHref="/x"
      />
    );
    expect(screen.getByText('Дорого, ждём скидку')).toBeTruthy();
  });

  it('у обычной бумаги строки «Причина отказа» нет вовсе', () => {
    // Пустое «Причина отказа: —» у счёта только сбивает с толку.
    render(<DocumentDetailView document={doc()} backHref="/x" />);
    expect(screen.queryByText('Причина отказа')).toBeNull();
  });

  it('отклонённое и истёкшее предложение заново не отправляется', () => {
    for (const status of ['rejected', 'expired']) {
      const { unmount } = render(
        <DocumentDetailView
          document={doc({ type: 'commercial_proposal', status })}
          backHref="/x"
          canSend
        />
      );
      expect(screen.queryByText('Отправить заказчику'), status).toBeNull();
      unmount();
    }
  });
});

describe('состояние и отметки документа', () => {
  it('незнакомое состояние показывается прочерком, а не сырым кодом', () => {
    render(<DocumentDetailView document={doc({ status: 'weird' })} backHref="/x" />);
    const dts = Array.from(globalThis.document.querySelectorAll('dt'));
    const row = dts.find((d) => d.textContent === 'Состояние')?.nextElementSibling;
    expect(row?.textContent).toBe('—');
  });

  it('даты отправки и приёмки показываются, когда они есть', () => {
    render(
      <DocumentDetailView
        document={doc({
          status: 'accepted',
          sentAt: new Date('2026-08-01T00:00:00Z'),
          acceptedAt: new Date('2026-08-02T00:00:00Z'),
        })}
        backHref="/x"
      />
    );
    expect(screen.getByText('01.08.2026')).toBeTruthy();
    expect(screen.getByText('02.08.2026')).toBeTruthy();
  });
});

describe('строка «Оплата» у счёта (У-148)', () => {
  it('оплаченный счёт так и написан', () => {
    render(
      <DocumentDetailView
        document={doc({ payment: { state: 'paid', paid: 12000, matched: true, ambiguous: false } })}
        backHref="/x"
      />
    );
    expect(screen.getByText(/Оплачен/)).toBeTruthy();
  });

  it('частичная оплата показывает поступившую сумму', () => {
    render(
      <DocumentDetailView
        document={doc({
          payment: { state: 'partially_paid', paid: 5000, matched: true, ambiguous: false },
        })}
        backHref="/x"
      />
    );
    expect(screen.getByText(/поступило 5\s?000 ₽/)).toBeTruthy();
  });

  it('платежей со ссылкой на счёт нет — так и сказано', () => {
    render(
      <DocumentDetailView
        document={doc({ payment: { state: 'unpaid', paid: 0, matched: false, ambiguous: false } })}
        backHref="/x"
      />
    );
    expect(screen.getByText(/Платежей с ссылкой на этот счёт не найдено/)).toBeTruthy();
  });

  it('платёж назвал несколько счетов — объясняем, почему не разнесли', () => {
    render(
      <DocumentDetailView
        document={doc({ payment: { state: 'unpaid', paid: 0, matched: false, ambiguous: true } })}
        backHref="/x"
      />
    );
    expect(screen.getByText(/названо несколько счетов/)).toBeTruthy();
  });

  it('у документа без признака оплаты строки нет', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" />);
    expect(screen.queryByText('Оплата')).toBeNull();
  });
});
