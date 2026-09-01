// @vitest-environment jsdom
/**
 * Этап 7, PR-4a (`У-161`, `У-162`) — форма выпуска, когда выпускают
 * КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ.
 *
 * Здесь проверяется только то, чем предложение отличается от остальных бумаг:
 * третья цель «лид» (клиент, у которого ещё нет организации), два своих поля,
 * подстановка срока и обещание ЧЕРНОВИКА вместо «выпущено». Общее поведение
 * формы (сверка сумм, каталог, блокировка по реквизитам) живёт в соседних
 * файлах `components.generate-documents-panel` и
 * `components.issue-order-less-document` — здесь не дублируется.
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

/**
 * «Сегодня» прибито гвоздями: срок предложения считается как сегодня плюс
 * число дней, и без фиксированных часов ожидаемую дату пришлось бы считать
 * тем же кодом, который проверяем, — тест повторял бы ошибку вместе с ним.
 * 1 сентября плюс 30 дней — это ещё и переход через месяц.
 *
 * Подменяем ТОЛЬКО календарь (`toFake: ['Date']`): таймеры остаются
 * настоящими, иначе ожидание ответа сервера (`waitFor`) зависло бы.
 */
const FIXED_NOW = new Date(2026, 8, 1, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  // Нативный <dialog> в jsdom не реализован — примитив Dialog зовёт showModal.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function openDialog(over: Partial<React.ComponentProps<typeof IssueDocumentDialog>> = {}) {
  render(
    <IssueDocumentDialog
      open
      onClose={vi.fn()}
      target={{ kind: 'organization', organizationId: 'org-1' }}
      counterpartyName="ООО «Ромашка»"
      orderLines={[]}
      missingByType={NO_MISSING}
      baseDocuments={[]}
      hasInvoice={false}
      hasContract={false}
      {...over}
    />
  );
  return document.querySelector('dialog[open]') as HTMLElement;
}

function lastPayload(call = 0) {
  const fd = generateOrderDocumentAction.mock.calls[call]![0] as FormData;
  return JSON.parse(fd.get('payload') as string);
}

describe('IssueDocumentDialog — предложение лиду (`У-161`)', () => {
  /**
   * Лид — это клиент, которого в системе ещё нет как организации: ни реквизитов,
   * ни договора. Счёт ему выставить невозможно физически, поэтому в списке
   * должен остаться ровно один тип. Список сверяется ЦЕЛИКОМ, а не через
   * «нет счёта»: так виден любой лишний тип, добавленный по невнимательности.
   */
  it('лиду предлагают только коммерческое предложение — и оно уже выбрано', () => {
    const dialog = openDialog({ target: { kind: 'lead', leadId: 'lead-7' } });
    const select = within(dialog).getByLabelText('Тип документа') as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Коммерческое предложение',
    ]);
    // Единственный пункт мало показать — он должен быть ВЫБРАН, иначе форма
    // откроется «пустой» и человек не поймёт, что нажимать. Судим по полям
    // предложения на экране, а не по значению списка: браузер сам выделяет
    // первый пункт, поэтому значение списка выглядело бы верным даже тогда,
    // когда форма внутри считает себя счётом.
    expect(within(dialog).getByLabelText('Действительно до')).toBeTruthy();
    expect(select.value).toBe('commercial_proposal');
  });

  /**
   * Обратная сторона того же правила: предложение делают ДО заказа, поэтому в
   * форме заказа его в списке быть не должно (сервер отвечает
   * `proposal_needs_no_order`). Список сверяется целиком — иначе «лишний, но
   * безобидный» пункт увёл бы менеджера в тупик с отказом сервера.
   */
  it('у заказа предложения не предлагают — оно делается до заказа', () => {
    const dialog = openDialog({ target: { kind: 'order', orderId: 'ord-1' } });
    const select = within(dialog).getByLabelText('Тип документа') as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Счёт',
      'Акт',
      'Договор',
      'Доп. соглашение',
    ]);
  });

  /**
   * Пакет для сервера обязан называть НАСТОЯЩУЮ цель. Если бы форма
   * подставляла организацию, предложение ушло бы не тому адресату (или
   * сервер отказал бы без объяснений), а менеджер искал бы бумагу не там.
   */
  it('при цели «лид» в пакет едет лид, а не организация и не заказ', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd1',
      number: 'КП-2026-1',
    });
    const dialog = openDialog({ target: { kind: 'lead', leadId: 'lead-7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());

    const payload = lastPayload();
    expect(payload.leadId).toBe('lead-7');
    expect('organizationId' in payload).toBe(false);
    expect('orderId' in payload).toBe(false);
    expect(payload.docType).toBe('commercial_proposal');
  });
});

describe('IssueDocumentDialog — поля предложения (`У-162`)', () => {
  it('у предложения свои поля — «о чём» и «до какого числа», а полей договора нет', () => {
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), {
      target: { value: 'commercial_proposal' },
    });

    expect(within(dialog).getByLabelText('О чём предложение')).toBeTruthy();
    expect(within(dialog).getByLabelText('Действительно до')).toBeTruthy();
    // Поля договора и его подписи остаться не должны: «Действует до» у договора
    // — это срок жизни бумаги, а у предложения — до какого числа держится цена.
    // Две разные вещи не могут стоять на экране под видом одной.
    expect(within(dialog).queryByLabelText('Порядок оплаты')).toBeNull();
    expect(within(dialog).queryByLabelText('Предмет договора')).toBeNull();
    expect(within(dialog).queryByLabelText('Действует до')).toBeNull();
  });

  /**
   * Срок берётся из настроек компании (сервер отдаёт ЧИСЛО ДНЕЙ, дату собирает
   * браузер). Проверяем с 30 днями, а не с умолчанием 14: совпади ожидание с
   * «зашитой» цифрой, тест не заметил бы, что настройку компании игнорируют.
   */
  it('«Действительно до» подставляется как сегодня плюс срок компании', () => {
    const dialog = openDialog({
      target: { kind: 'lead', leadId: 'lead-7' },
      proposalValidDays: 30,
    });
    const validUntil = within(dialog).getByLabelText('Действительно до') as HTMLInputElement;
    expect(validUntil.value).toBe('2026-10-01');
  });

  /**
   * Форма лида открывается с заблокированным типом (`lockedDocType`) — тип не
   * выбирают. Срок обязан подставиться и в этом случае: пустое «действительно
   * до» печатается в предложении пустой строкой, и клиент не знает, до какого
   * числа держится цена.
   */
  it('при заблокированном типе срок тоже подставляется, а тип менять нельзя', () => {
    const dialog = openDialog({
      lockedDocType: 'commercial_proposal',
      proposalValidDays: 30,
    });
    expect((within(dialog).getByLabelText('Действительно до') as HTMLInputElement).value).toBe(
      '2026-10-01'
    );
    expect((within(dialog).getByLabelText('Тип документа') as HTMLSelectElement).disabled).toBe(
      true
    );
  });

  /**
   * Человек мог выбрать свою дату, потом уйти на другой тип и вернуться.
   * Затирание выбранного значения умолчанием — это молча испорченный документ:
   * на экране одно число, в бумаге другое.
   */
  it('срок, выбранный человеком, при переключении типа не затирается', () => {
    const dialog = openDialog({ proposalValidDays: 30 });
    const type = within(dialog).getByLabelText('Тип документа');

    fireEvent.change(type, { target: { value: 'commercial_proposal' } });
    // Сначала убеждаемся, что пустое поле умолчание всё-таки получает.
    expect((within(dialog).getByLabelText('Действительно до') as HTMLInputElement).value).toBe(
      '2026-10-01'
    );

    fireEvent.change(within(dialog).getByLabelText('Действительно до'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(type, { target: { value: 'invoice' } });
    fireEvent.change(type, { target: { value: 'commercial_proposal' } });

    expect((within(dialog).getByLabelText('Действительно до') as HTMLInputElement).value).toBe(
      '2026-12-31'
    );
  });
});

describe('IssueDocumentDialog — пакет и текст успеха у предложения', () => {
  /**
   * Инвариант формы: уезжает только то, что показано для выбранного типа.
   * Значения полей живут в состоянии диалога и при смене типа не стираются,
   * поэтому набранный для договора «Порядок оплаты» иначе уехал бы в
   * предложение и напечатался в бумаге пунктом, которого человек на экране уже
   * не видел. Полей акта здесь нет и быть не может: акт живёт только при
   * заказе, а предложение — только без него, в одном окне они не встречаются.
   */
  it('в пакет предложения уезжают «о чём» и срок, а поля договора и ДС — нет', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd1',
      number: 'КП-2026-1',
    });
    const dialog = openDialog({ orderLines: [LINE], proposalValidDays: 30, hasContract: true });
    const type = within(dialog).getByLabelText('Тип документа');

    fireEvent.change(type, { target: { value: 'contract' } });
    fireEvent.change(within(dialog).getByLabelText('Порядок оплаты'), {
      target: { value: '100% предоплата' },
    });
    fireEvent.change(type, { target: { value: 'extra_agreement' } });
    fireEvent.change(within(dialog).getByLabelText('Что меняется'), {
      target: { value: 'Меняем сроки' },
    });

    fireEvent.change(type, { target: { value: 'commercial_proposal' } });
    fireEvent.change(within(dialog).getByLabelText('О чём предложение'), {
      target: { value: 'Обучение 20 человек' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalled());

    const payload = lastPayload();
    expect(payload.docType).toBe('commercial_proposal');
    expect(payload.subject).toBe('Обучение 20 человек');
    expect(payload.validUntil).toBe('2026-10-01');
    expect('paymentTerms' in payload).toBe(false);
    expect('changeText' in payload).toBe(false);
  });

  /**
   * `У-164`: предложение рождается ЧЕРНОВИКОМ — клиент его ещё не видит.
   * Слово «выпущен» означало бы обратное, и менеджер решил бы, что письмо уже
   * ушло. Для остальных типов формулировка обязана остаться прежней, поэтому
   * счёт проверяется тем же тестом — общий текст на все типы не подойдёт.
   */
  it('про предложение говорят «черновик готов», а про счёт — по-прежнему «выпущен»', async () => {
    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd1',
      number: 'С-2026-9',
    });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Счёт № С-2026-9 выпущен.'));

    generateOrderDocumentAction.mockResolvedValue({
      ok: true,
      documentId: 'd2',
      number: 'КП-2026-1',
    });
    fireEvent.change(within(dialog).getByLabelText('Тип документа'), {
      target: { value: 'commercial_proposal' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выпустить' }));
    await waitFor(() => expect(generateOrderDocumentAction).toHaveBeenCalledTimes(2));

    const said = String(toastSuccess.mock.calls[1]![0]);
    expect(said).toBe('Черновик предложения № КП-2026-1 готов. Проверьте и отправьте клиенту.');
    expect(said).not.toContain('выпущен');
  });
});
