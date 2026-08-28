// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction, requestRequisitesAction } = vi.hoisted(() => ({
  generateOrderDocumentAction: vi.fn(),
  requestRequisitesAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/generate', () => ({
  generateOrderDocumentAction,
  requestRequisitesAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import type { IssueDocType, IssueLine } from '@/components/manager/issue-document-dialog';
import type { MissingRequisite } from '@/lib/documents/requisites-check';

/**
 * `У-147` — форма выпуска вместо четырёх кнопок «в один клик».
 *
 * Панель отвечает на «что делать дальше» (§15): одна главная кнопка и, если
 * выпустить нечего, список недостающего с кнопкой «Запросить у клиента».
 */
const NO_MISSING: Record<IssueDocType, MissingRequisite[]> = {
  invoice: [],
  act: [],
  contract: [],
  extra_agreement: [],
};

const LINE: IssueLine = {
  title: 'Обучение',
  quantity: '2',
  unit: 'person',
  unitPrice: '5000',
  discountPercent: null,
  vatRate: '0.2000',
  vatIncluded: true,
};

function panel(over: Partial<React.ComponentProps<typeof GenerateDocumentsPanel>> = {}) {
  return render(
    <GenerateDocumentsPanel
      orderId="ord-1"
      counterpartyName="ООО «Ромашка»"
      orderLines={[LINE]}
      missingByType={NO_MISSING}
      baseDocuments={[]}
      hasInvoice={false}
      hasContract={false}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Нативный <dialog> в jsdom не реализован — примитив Dialog зовёт showModal.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('GenerateDocumentsPanel', () => {
  it('главная кнопка открывает форму выпуска с предзаполненным контрагентом', () => {
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Выпустить документ' }));
    const dialog = document.querySelector('dialog[open]')!;
    expect(within(dialog as HTMLElement).getByDisplayValue('ООО «Ромашка»')).toBeTruthy();
  });

  it('нехватка реквизитов видна ДО открытия формы, с кнопкой запроса клиенту', () => {
    panel({
      missingByType: {
        ...NO_MISSING,
        invoice: [{ side: 'organization', label: 'ИНН заказчика' }],
      },
    });
    const block = screen.getByTestId('missing-requisites');
    expect(within(block).getByText('ИНН заказчика')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Запросить у клиента' })).toBeTruthy();
  });

  it('дыры только у исполнителя — клиенту писать не о чем, показываем куда идти', () => {
    panel({
      missingByType: {
        ...NO_MISSING,
        invoice: [{ side: 'company', label: 'БИК исполнителя' }],
      },
    });
    expect(screen.queryByRole('button', { name: 'Запросить у клиента' })).toBeNull();
    expect(screen.getByText(/Реквизиты исполнителя заполняются/)).toBeTruthy();
  });

  it('«Запросить у клиента» сообщает об успехе и об ошибке', async () => {
    requestRequisitesAction.mockResolvedValueOnce({ ok: true });
    panel({
      missingByType: {
        ...NO_MISSING,
        invoice: [{ side: 'organization', label: 'ИНН заказчика' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Запросить у клиента' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    requestRequisitesAction.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    fireEvent.click(screen.getByRole('button', { name: 'Запросить у клиента' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

describe('IssueDocumentDialog — выпуск (`У-147`, `У-143`)', () => {
  function openDialog(over: Partial<React.ComponentProps<typeof GenerateDocumentsPanel>> = {}) {
    panel(over);
    fireEvent.click(screen.getByRole('button', { name: 'Выпустить документ' }));
    return document.querySelector('dialog[open]') as HTMLElement;
  }

  it('выпуск отправляет тип, дату и строки одним пакетом', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-2026-7' });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());

    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(fd.get('payload') as string);
    expect(payload.docType).toBe('invoice');
    expect(payload.lines).toEqual([LINE]);
    expect(payload.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toastSuccess).toHaveBeenCalledWith('Счёт № С-2026-7 выпущен.');
  });

  it('`У-143`: расхождение сумм показывает ОБЕ цифры и три ответа', async () => {
    generateOrderDocumentAction.mockResolvedValueOnce({
      ok: false,
      error: 'amount_mismatch',
      linesTotal: '9000.00',
      orderTotal: '15000.00',
    });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));

    const block = await screen.findByTestId('issue-mismatch');
    expect(block.textContent).toContain('9000.00');
    expect(block.textContent).toContain('15000.00');
    expect(within(block).getByRole('button', { name: 'Обновить сумму заказа' })).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Выпустить по строкам' })).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Отмена' })).toBeTruthy();

    // Ответ уходит на сервер вторым вызовом — цифру за человека не выбираем.
    generateOrderDocumentAction.mockResolvedValueOnce({
      ok: true,
      documentId: 'd1',
      number: 'С-2026-7',
    });
    fireEvent.click(within(block).getByRole('button', { name: 'Выпустить по строкам' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalledTimes(2));
    const second = JSON.parse(
      (generateOrderDocumentAction.mock.calls[1]![0] as FormData).get('payload') as string
    );
    expect(second.onAmountMismatch).toBe('keep_order');
  });

  it('нехватка реквизитов выбранного типа блокирует кнопку «Выпустить»', () => {
    const dialog = openDialog({
      missingByType: {
        ...NO_MISSING,
        invoice: [{ side: 'company', label: 'БИК исполнителя' }],
      },
    });
    const issue = within(dialog).getByRole('button', { name: 'Выпустить' }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
    expect(within(dialog).getByTestId('issue-blocked').textContent).toContain('БИК исполнителя');
  });

  it('акт без счёта не выпускается и говорит почему', () => {
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), { target: { value: 'act' } });
    expect(within(dialog).getByTestId('issue-blocked').textContent).toContain(
      'Сначала выпустите счёт'
    );
  });

  it('у акта появляется выбор счёта-основания и период оказания услуг', () => {
    const dialog = openDialog({
      hasInvoice: true,
      baseDocuments: [
        { id: 'inv-1', type: 'invoice', number: 'С-2026-7', date: '2026-07-26T00:00:00.000Z' },
      ],
    });
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), { target: { value: 'act' } });
    const parent = within(dialog).getByLabelText('Счёт-основание') as HTMLSelectElement;
    expect([...parent.options].map((o) => o.textContent)).toContain('С-2026-7 от 26.07.2026');
    expect(within(dialog).getByLabelText('Услуги оказаны с')).toBeTruthy();
  });

  it('у договора появляются предмет, срок действия и порядок оплаты', () => {
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });
    expect(within(dialog).getByLabelText('Предмет договора')).toBeTruthy();
    expect(within(dialog).getByLabelText('Действует до')).toBeTruthy();
    expect(within(dialog).getByLabelText('Порядок оплаты')).toBeTruthy();
  });

  it('строку состава можно поправить и добавить — она уходит в выпуск', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-1' });
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText('Наименование'), {
      target: { value: 'Переговоры' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить строку' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());

    const payload = JSON.parse(
      (generateOrderDocumentAction.mock.calls[0]![0] as FormData).get('payload') as string
    );
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0].title).toBe('Переговоры');
  });

  it('ошибка выпуска показывается по-русски, а не кодом', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: false, error: 'storage' });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toContain('Не удалось')
    );
  });
});
