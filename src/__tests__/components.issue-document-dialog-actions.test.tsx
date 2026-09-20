// @vitest-environment jsdom
/**
 * Форма выпуска документа — действия, которых не касался соседний тест про
 * коммерческое предложение: предпросмотр, каталог услуг, правка строк,
 * блокировка по реквизитам и развилка «суммы не сходятся».
 *
 * Два правила дороже остальных. **Цена из каталога — снимок**: строку потом
 * правят руками, и последующее изменение прайса уже выпущенный документ не
 * трогает. И **при расхождении сумм цифру за человека не выбирают** (`У-143`)
 * — показывают обе и спрашивают, что делать.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction } = vi.hoisted(() => ({
  generateOrderDocumentAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/generate', () => ({ generateOrderDocumentAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import {
  IssueDocumentDialog,
  type IssueDocType,
  type IssueLine,
} from '@/components/manager/issue-document-dialog';
import type { MissingRequisite } from '@/lib/documents/requisites-check';

const NO_MISSING: Record<IssueDocType, MissingRequisite[]> = {
  invoice: [],
  act: [],
  contract: [],
  extra_agreement: [],
  commercial_proposal: [],
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

const CATALOG = [
  {
    id: 'cat-1',
    name: 'Охрана труда',
    code: 'ОТ-01',
    price: '3500',
    unit: 'person' as const,
    vatRate: '0.2000',
    vatIncluded: true,
  },
];

function renderDialog(props: Partial<Parameters<typeof IssueDocumentDialog>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <IssueDocumentDialog
      open
      onClose={onClose}
      target={{ kind: 'order', orderId: 'ord-1' }}
      counterpartyName="ООО «Ромашка»"
      orderLines={[LINE]}
      missingByType={NO_MISSING}
      baseDocuments={[]}
      hasInvoice
      hasContract
      {...props}
    />
  );
  const dialog = () => utils.container.querySelector('dialog[open]') as HTMLElement;
  return {
    ...utils,
    onClose,
    dialog,
    btn: (name: string | RegExp) => within(dialog()).getByRole('button', { name }),
    queryBtn: (name: string | RegExp) => within(dialog()).queryByRole('button', { name }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Нативный <dialog> в jsdom не умеет showModal — как в остальных тестах примитива.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:превью'),
    revokeObjectURL: vi.fn(),
  });
  generateOrderDocumentAction.mockResolvedValue({ ok: true, number: 'С-2026-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Предпросмотр', () => {
  it('готовый файл показывается прямо в форме', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }))
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));

    await waitFor(() =>
      expect(within(ui.dialog()).getByTitle('Предпросмотр документа')).toBeTruthy()
    );
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/manager/documents/preview');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      orderId: 'ord-1',
      docType: 'invoice',
    });
  });

  it('сервер отказал — причина по-русски, файла нет', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'forbidden' }) }))
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));

    await waitFor(() => expect(within(ui.dialog()).getByRole('alert').textContent).not.toBe(''));
    expect(within(ui.dialog()).queryByTitle('Предпросмотр документа')).toBeNull();
  });

  it('ответ без причины не оставляет человека без объяснения', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => {
          throw new Error('не json');
        },
      }))
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));

    await waitFor(() => expect(within(ui.dialog()).getByRole('alert').textContent).not.toBe(''));
  });

  it('сеть не ответила — тоже объясняем', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('нет сети');
      })
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));

    await waitFor(() => expect(within(ui.dialog()).getByRole('alert').textContent).not.toBe(''));
  });

  it('повторный предпросмотр освобождает прежний файл — иначе память течёт', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }))
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));
    await waitFor(() =>
      expect(within(ui.dialog()).getByTitle('Предпросмотр документа')).toBeTruthy()
    );
    fireEvent.click(ui.btn('Предпросмотр'));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:превью'));
  });
});

describe('Строки документа', () => {
  it('позиция каталога подставляется снимком цены и ставки', () => {
    const ui = renderDialog({ catalog: CATALOG, orderLines: [] });

    fireEvent.change(within(ui.dialog()).getByTestId('issue-catalog-picker'), {
      target: { value: 'cat-1' },
    });

    // Форма открывается с одной пустой строкой, позиция каталога добавляется
    // следующей — смотрим последнюю.
    const titles = within(ui.dialog()).getAllByLabelText('Наименование') as HTMLInputElement[];
    const prices = within(ui.dialog()).getAllByLabelText('Цена') as HTMLInputElement[];
    expect(titles[titles.length - 1]!.value).toBe('Охрана труда');
    expect(prices[prices.length - 1]!.value).toBe('3500');
  });

  it('пустое значение списка — это подпись, а не позиция', () => {
    const ui = renderDialog({ catalog: CATALOG, orderLines: [] });
    const before = within(ui.dialog()).queryAllByLabelText('Наименование').length;

    fireEvent.change(within(ui.dialog()).getByTestId('issue-catalog-picker'), {
      target: { value: '' },
    });

    expect(within(ui.dialog()).queryAllByLabelText('Наименование')).toHaveLength(before);
  });

  it('«Добавить строку» добавляет пустую, «Убрать» — убирает', () => {
    const ui = renderDialog();

    fireEvent.click(ui.btn('Добавить строку'));
    expect(within(ui.dialog()).getAllByLabelText('Наименование')).toHaveLength(2);

    fireEvent.click(within(ui.dialog()).getAllByRole('button', { name: 'Убрать' })[0]!);
    expect(within(ui.dialog()).getAllByLabelText('Наименование')).toHaveLength(1);
  });

  it('последнюю строку убрать нельзя — документ без строк бессмыслен', () => {
    const ui = renderDialog();

    expect((ui.btn('Убрать') as HTMLButtonElement).disabled).toBe(true);
  });

  it('правка строки доезжает до выпуска', async () => {
    const ui = renderDialog();

    fireEvent.change(within(ui.dialog()).getByLabelText('Наименование'), {
      target: { value: 'Другое обучение' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Кол-во'), { target: { value: '3' } });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(String(fd.get('payload'))) as { lines: IssueLine[] };
    expect(payload.lines[0]).toMatchObject({ title: 'Другое обучение', quantity: '3' });
  });

  it('ставку НДС можно снять — «без НДС» это не пустая строка', async () => {
    const ui = renderDialog();

    fireEvent.change(within(ui.dialog()).getByLabelText('НДС'), { target: { value: '' } });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(String(fd.get('payload'))) as { lines: IssueLine[] };
    expect(payload.lines[0]?.vatRate).toBeNull();
  });
});

describe('Блокировка по реквизитам', () => {
  it('не хватает реквизитов — выпуск заперт, причины перечислены', () => {
    const ui = renderDialog({
      missingByType: {
        ...NO_MISSING,
        invoice: [{ side: 'company', label: 'Расчётный счёт' } as MissingRequisite],
      },
    });

    expect(within(ui.dialog()).getByTestId('issue-blocked').textContent).toContain(
      'Расчётный счёт'
    );
    expect((ui.btn('Выпустить') as HTMLButtonElement).disabled).toBe(true);
  });

  it('акт без счёта — объясняем, что выпустить сначала', () => {
    const ui = renderDialog({ hasInvoice: false });

    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'act' },
    });

    expect(within(ui.dialog()).getByTestId('issue-blocked').textContent).toContain(
      'Сначала выпустите счёт'
    );
  });

  it('доп. соглашение без договора — то же самое', () => {
    const ui = renderDialog({ hasContract: false });

    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'extra_agreement' },
    });

    expect(within(ui.dialog()).getByTestId('issue-blocked').textContent).toContain(
      'Сначала выпустите договор'
    );
  });
});

describe('Суммы не сходятся', () => {
  beforeEach(() => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: false,
      error: 'amount_mismatch',
      linesTotal: '10 000',
      orderTotal: '12 000',
    });
  });

  it('показываются обе суммы и вопрос, а не выбор за человека', async () => {
    const ui = renderDialog();

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(within(ui.dialog()).getByTestId('issue-mismatch')).toBeTruthy());
    const box = within(ui.dialog()).getByTestId('issue-mismatch');
    expect(box.textContent).toContain('10 000');
    expect(box.textContent).toContain('12 000');
  });

  it('«Обновить сумму заказа» повторяет выпуск с этим решением', async () => {
    const ui = renderDialog();
    fireEvent.click(ui.btn('Выпустить'));
    await waitFor(() => expect(within(ui.dialog()).getByTestId('issue-mismatch')).toBeTruthy());

    generateOrderDocumentAction.mockResolvedValue({ ok: true, number: 'С-2026-2' });
    fireEvent.click(ui.btn('Обновить сумму заказа'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[1]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({
      onAmountMismatch: 'update_order',
    });
  });

  it('«Выпустить по строкам» — второе решение', async () => {
    const ui = renderDialog();
    fireEvent.click(ui.btn('Выпустить'));
    await waitFor(() => expect(within(ui.dialog()).getByTestId('issue-mismatch')).toBeTruthy());

    generateOrderDocumentAction.mockResolvedValue({ ok: true, number: 'С-2026-3' });
    fireEvent.click(ui.btn('Выпустить по строкам'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[1]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({ onAmountMismatch: 'keep_order' });
  });

  it('«Отмена» убирает развилку и возвращает кнопку выпуска', async () => {
    const ui = renderDialog();
    fireEvent.click(ui.btn('Выпустить'));
    await waitFor(() => expect(within(ui.dialog()).getByTestId('issue-mismatch')).toBeTruthy());

    fireEvent.click(ui.btn('Отмена'));

    expect(within(ui.dialog()).queryByTestId('issue-mismatch')).toBeNull();
    expect((ui.btn('Выпустить') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Выпуск', () => {
  it('успех закрывает форму, говорит номер и перечитывает страницу', async () => {
    const ui = renderDialog();

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]?.[0])).toContain('С-2026-1');
    expect(ui.onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('прочий отказ показывается по-русски и форму не закрывает', async () => {
    generateOrderDocumentAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const ui = renderDialog();

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(within(ui.dialog()).getByRole('alert').textContent).not.toBe(''));
    expect(ui.onClose).not.toHaveBeenCalled();
  });

  it('перевыпуск везёт номер прежнего документа', async () => {
    const ui = renderDialog({ reissueOfDocumentId: 'doc-old' });

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({
      reissueOfDocumentId: 'doc-old',
    });
  });
});

/**
 * Поля, которые появляются у конкретных типов бумаг: у договора — предмет,
 * срок и порядок оплаты, у акта — период и счёт-основание, у доп. соглашения
 * — что меняется и договор-основание.
 *
 * Важное здесь — **документ-основание**: акт наследует номер счёта, а доп.
 * соглашение — номер договора. Пустой выбор означает «последний по дате», а не
 * «без основания».
 */
describe('Поля по типам документов', () => {
  const BASES = [
    { id: 'doc-inv', number: 'С-2026-1', date: '2026-09-01', type: 'invoice' as const },
    { id: 'doc-con', number: 'Д-2026-1', date: '2026-08-01', type: 'contract' as const },
  ];

  it('договор везёт предмет, срок и порядок оплаты', async () => {
    const ui = renderDialog();
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });

    fireEvent.change(within(ui.dialog()).getByLabelText('Предмет договора'), {
      target: { value: 'Обучение сотрудников' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Действует до'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Порядок оплаты'), {
      target: { value: '100% предоплата' },
    });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({
      docType: 'contract',
      subject: 'Обучение сотрудников',
      validUntil: '2026-12-31',
      paymentTerms: '100% предоплата',
    });
  });

  it('пустые поля договора в запрос не уходят', async () => {
    const ui = renderDialog();
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Порядок оплаты'), {
      target: { value: '   ' },
    });

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).not.toHaveProperty('paymentTerms');
  });

  it('акт везёт период оказания услуг и счёт-основание', async () => {
    const ui = renderDialog({ baseDocuments: BASES });
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'act' },
    });

    fireEvent.change(within(ui.dialog()).getByLabelText('Услуги оказаны с'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('по'), {
      target: { value: '2026-09-30' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Счёт-основание'), {
      target: { value: 'doc-inv' },
    });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({
      docType: 'act',
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      parentDocumentId: 'doc-inv',
    });
  });

  it('оснований нет — подсказка объясняет, что выпустить сначала', () => {
    const ui = renderDialog({ baseDocuments: [] });
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'act' },
    });

    expect(ui.dialog().textContent).toContain('Сначала выпустите счёт.');
  });

  it('основания есть — подсказка про наследование номера', () => {
    const ui = renderDialog({ baseDocuments: BASES });
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'act' },
    });

    expect(ui.dialog().textContent).toContain('Документ наследует номер основания.');
    // Номер и дата основания видны — выбирать вслепую не приходится.
    expect(ui.dialog().textContent).toContain('С-2026-1');
  });

  it('доп. соглашение везёт «что меняется» и договор-основание', async () => {
    const ui = renderDialog({ baseDocuments: BASES });
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'extra_agreement' },
    });

    fireEvent.change(within(ui.dialog()).getByLabelText('Что меняется'), {
      target: { value: 'Продлеваем срок' },
    });
    fireEvent.change(within(ui.dialog()).getByLabelText('Договор-основание'), {
      target: { value: 'doc-con' },
    });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({
      docType: 'extra_agreement',
      changeText: 'Продлеваем срок',
      parentDocumentId: 'doc-con',
    });
  });

  it('доп. соглашение без основания — «последний по дате», поле не шлём', async () => {
    const ui = renderDialog({ baseDocuments: BASES });
    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'extra_agreement' },
    });

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).not.toHaveProperty('parentDocumentId');
  });
});

describe('Мелочи, без которых форма врёт', () => {
  it('дату документа можно изменить — она уходит с запросом', async () => {
    const ui = renderDialog();

    fireEvent.change(within(ui.dialog()).getByLabelText('Дата документа'), {
      target: { value: '2026-09-15' },
    });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({ documentDate: '2026-09-15' });
  });

  it('правится ровно та строка, которую тронули, соседняя остаётся прежней', async () => {
    const ui = renderDialog();
    fireEvent.click(ui.btn('Добавить строку'));

    const titles = within(ui.dialog()).getAllByLabelText('Наименование') as HTMLInputElement[];
    fireEvent.change(titles[1]!, { target: { value: 'Вторая строка' } });

    const units = within(ui.dialog()).getAllByLabelText('Ед.') as HTMLSelectElement[];
    fireEvent.change(units[1]!, { target: { value: 'hour' } });
    const prices = within(ui.dialog()).getAllByLabelText('Цена') as HTMLInputElement[];
    fireEvent.change(prices[1]!, { target: { value: '777' } });
    const vats = within(ui.dialog()).getAllByLabelText('НДС') as HTMLSelectElement[];
    fireEvent.change(vats[1]!, { target: { value: '0.2000' } });

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(String(fd.get('payload'))) as { lines: IssueLine[] };
    expect(payload.lines[0]).toMatchObject({ title: 'Обучение', unitPrice: '5000' });
    expect(payload.lines[1]).toMatchObject({
      title: 'Вторая строка',
      unit: 'hour',
      unitPrice: '777',
      vatRate: '0.2000',
    });
  });

  it('после предпросмотра выпуск освобождает показанный файл', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }))
    );
    const ui = renderDialog();

    fireEvent.click(ui.btn('Предпросмотр'));
    await waitFor(() =>
      expect(within(ui.dialog()).getByTitle('Предпросмотр документа')).toBeTruthy()
    );

    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(ui.onClose).toHaveBeenCalled());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:превью');
  });

  it('сделка уезжает только с предложением', async () => {
    const ui = renderDialog({
      target: { kind: 'organization', organizationId: 'o1' },
      dealId: 'deal-9',
      orderLines: [LINE],
    });

    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'commercial_proposal' },
    });
    fireEvent.click(ui.btn('Выпустить'));

    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());
    const fd = generateOrderDocumentAction.mock.calls[0]![0] as FormData;
    expect(JSON.parse(String(fd.get('payload')))).toMatchObject({ dealId: 'deal-9' });
  });

  it('тип без записи о реквизитах не роняет форму — считаем, что всё на месте', () => {
    const ui = renderDialog({
      missingByType: { invoice: [] } as unknown as Record<IssueDocType, MissingRequisite[]>,
    });

    fireEvent.change(within(ui.dialog()).getByLabelText('Тип документа'), {
      target: { value: 'contract' },
    });

    expect(within(ui.dialog()).queryByTestId('issue-blocked')).toBeNull();
  });
});
