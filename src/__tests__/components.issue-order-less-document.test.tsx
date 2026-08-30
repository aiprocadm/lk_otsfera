// @vitest-environment jsdom
/**
 * Этап 6, PR-6 (`У-145`) — «Создать документ» без заказа: кнопка карточки
 * организации и форма, открываемая из сделки.
 *
 * Проверяем ровно то, чем эта форма отличается от формы заказа: акта в выборе
 * нет, состав набирается из каталога, а цель уезжает на сервер организацией,
 * а не заказом.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction, requestRequisitesAction, orgIssuePanelAction } = vi.hoisted(
  () => ({
    generateOrderDocumentAction: vi.fn(),
    requestRequisitesAction: vi.fn(),
    orgIssuePanelAction: vi.fn(),
  })
);
vi.mock('@/server-actions/documents/generate', () => ({
  generateOrderDocumentAction,
  requestRequisitesAction,
  orgIssuePanelAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import {
  IssueOrderLessDocumentButton,
  IssueOrderLessDocumentDialog,
} from '@/components/documents/issue-order-less-document-button';

const PANEL = {
  missingByType: { invoice: [], act: [], contract: [], extra_agreement: [] },
  defaultVatRate: '0.2000',
  baseDocuments: [],
  hasContract: false,
  counterpartyName: 'ООО «Ромашка»',
  catalog: [
    {
      id: 'c1',
      name: 'Обучение по ОТ',
      code: 'A-1',
      unit: 'person' as const,
      price: '5000.00',
      vatRate: '0.2000',
      vatIncluded: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  orgIssuePanelAction.mockResolvedValue({ ok: true, panel: PANEL });
});

async function openViaButton(props: Record<string, unknown> = {}) {
  render(<IssueOrderLessDocumentButton organizationId="org-1" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));
  await waitFor(() => expect(document.querySelector('dialog[open]')).toBeTruthy());
  return document.querySelector('dialog[open]') as HTMLElement;
}

describe('IssueOrderLessDocumentButton (`У-145`)', () => {
  it('данные формы грузятся по клику, а не при отрисовке страницы', async () => {
    render(<IssueOrderLessDocumentButton organizationId="org-1" />);
    expect(orgIssuePanelAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));
    await waitFor(() => expect(orgIssuePanelAction).toHaveBeenCalledTimes(1));
    const fd = orgIssuePanelAction.mock.calls[0]![0] as FormData;
    expect(fd.get('organizationId')).toBe('org-1');
  });

  it('отказ сервера не оставляет молчаливо неработающую кнопку', async () => {
    orgIssuePanelAction.mockResolvedValue({ ok: false, error: 'org_no_company' });
    render(<IssueOrderLessDocumentButton organizationId="org-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]![0])).toContain('компания-исполнитель');
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('подпись кнопки настраивается — сделка зовёт то же действие иначе', async () => {
    render(<IssueOrderLessDocumentButton organizationId="org-1" label="Выпустить документ" />);
    expect(screen.getByRole('button', { name: 'Выпустить документ' })).toBeTruthy();
  });

  it('акта в выборе нет: без заказа он наследовать номер не может', async () => {
    const dialog = await openViaButton();
    const select = within(dialog).getByLabelText('Тип документа') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['Счёт', 'Договор', 'Доп. соглашение']);
  });

  it('подсказка предмета договора не обещает названия заказа, которого нет', async () => {
    const dialog = await openViaButton();
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });
    expect(within(dialog).getByText('Пусто — «Оказание услуг»')).toBeTruthy();
  });

  it('строка берётся из каталога с ценой и ставкой позиции', async () => {
    const dialog = await openViaButton();
    fireEvent.change(within(dialog).getByLabelText('Добавить из каталога'), {
      target: { value: 'c1' },
    });
    expect(within(dialog).getByDisplayValue('Обучение по ОТ')).toBeTruthy();
    expect(within(dialog).getByDisplayValue('5000.00')).toBeTruthy();
  });

  it('пустой выбор в каталоге — это подпись, а не позиция: строк не прибавляется', async () => {
    const dialog = await openViaButton();
    const before = within(dialog).getAllByLabelText(/Наименование/).length;
    fireEvent.change(within(dialog).getByLabelText('Добавить из каталога'), {
      target: { value: '' },
    });
    expect(within(dialog).getAllByLabelText(/Наименование/).length).toBe(before);
  });

  /**
   * `У-138`: пустая ставка печатается как «НДС не облагается». У плательщика
   * НДС это молча неверный документ, поэтому новая строка и предзаполнение из
   * сделки получают ставку компании.
   */
  it('новая строка и строка из сделки получают ставку НДС компании', async () => {
    const dialog = await openViaButton({
      prefillLines: [
        {
          title: 'Из сделки',
          quantity: '1',
          unit: 'service',
          unitPrice: '120000',
          discountPercent: null,
          vatRate: null,
          vatIncluded: true,
        },
      ],
    });
    const rates = within(dialog).getAllByLabelText('НДС') as HTMLSelectElement[];
    expect(rates[0]!.value).toBe('0.2000');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить строку' }));
    const after = within(dialog).getAllByLabelText('НДС') as HTMLSelectElement[];
    expect(after[after.length - 1]!.value).toBe('0.2000');
  });

  it('у компании без НДС ставка остаётся пустой — умолчание не выдумывается', async () => {
    orgIssuePanelAction.mockResolvedValue({
      ok: true,
      panel: { ...PANEL, defaultVatRate: null },
    });
    const dialog = await openViaButton();
    const rates = within(dialog).getAllByLabelText('НДС') as HTMLSelectElement[];
    expect(rates[0]!.value).toBe('');
  });

  it('выпуск уезжает с организацией, а поля заказа в пакете нет', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd9',
      number: 'С-2026-9',
    });
    const dialog = await openViaButton();
    fireEvent.change(within(dialog).getByLabelText('Добавить из каталога'), {
      target: { value: 'c1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(fd.get('payload') as string);
    expect(payload.organizationId).toBe('org-1');
    expect('orderId' in payload).toBe(false);
  });
});

describe('IssueOrderLessDocumentDialog — вход из сделки', () => {
  it('предзаполняется названием и суммой сделки', async () => {
    render(
      <IssueOrderLessDocumentDialog
        organizationId="org-1"
        onClose={vi.fn()}
        defaultSubject="Обучение для «Ромашки»"
        prefillLines={[
          {
            title: 'Обучение для «Ромашки»',
            quantity: '1',
            unit: 'service',
            unitPrice: '120000',
            discountPercent: null,
            vatRate: null,
            vatIncluded: true,
          },
        ]}
      />
    );
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeTruthy());
    const dialog = document.querySelector('dialog[open]') as HTMLElement;
    expect(within(dialog).getByDisplayValue('120000')).toBeTruthy();
    // Предмет виден только у договора — переключаем тип. Проверяем именно
    // поле предмета: то же значение стоит и в наименовании строки.
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });
    expect((within(dialog).getByLabelText('Предмет договора') as HTMLInputElement).value).toBe(
      'Обучение для «Ромашки»'
    );
  });

  it('неудачная загрузка закрывает форму, а не оставляет пустое окно', async () => {
    const onClose = vi.fn();
    orgIssuePanelAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<IssueOrderLessDocumentDialog organizationId="org-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(document.querySelector('dialog[open]')).toBeNull();
  });
});
