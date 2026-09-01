// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { saveDocumentTemplateAction, resetDocumentTemplateAction } = vi.hoisted(() => ({
  saveDocumentTemplateAction: vi.fn(),
  resetDocumentTemplateAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/documentTemplates', () => ({
  saveDocumentTemplateAction,
  resetDocumentTemplateAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DocumentTemplatesScreen } from '@/components/settings/document-templates-screen';
import { DocumentTemplateField } from '@/components/settings/document-templates-editor';
import {
  DOCUMENT_TEMPLATE_GROUPS,
  DOCUMENT_TEMPLATE_SLOTS,
  findSlot,
  type DocumentTemplateSlot,
} from '@/lib/documents/documentTemplate';
import type { TemplateRow } from '@/lib/services/documents/templates';

/**
 * Экран и редактор «Шаблоны документов» (`У-160`, решения `Р-22`/`Р-23`).
 *
 * Здесь проверяется ровно то, что человек видит и трогает руками: какие поля
 * нарисованы, что написано рядом с ними и что происходит после нажатия. Права
 * и границы компании живут в сервисе — экран презентационный, и подменять им
 * серверную проверку нельзя.
 */

/** Строка «как её отдаёт сервис»: пока текст не правили — встроенный. */
function rowFor(slot: DocumentTemplateSlot, over: Partial<TemplateRow> = {}): TemplateRow {
  return {
    slot: slot.key,
    body: slot.defaultText,
    isCustom: false,
    revision: null,
    updatedAt: null,
    ...over,
  };
}

const ALL_ROWS: TemplateRow[] = DOCUMENT_TEMPLATE_SLOTS.map((s) => rowFor(s));

/** Слот берём из реестра, а не выдумываем: тест обязан ломаться вместе с ним. */
function slotByKey(key: string): DocumentTemplateSlot {
  const slot = findSlot(key);
  if (!slot) throw new Error(`в реестре нет слота ${key}`);
  return slot;
}

const PAYMENT = slotByKey('payment');
const TERM_CONTRACT = slotByKey('term.contract');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DocumentTemplatesScreen — экран настроек', () => {
  function screenOf(over: Partial<React.ComponentProps<typeof DocumentTemplatesScreen>> = {}) {
    return render(
      <DocumentTemplatesScreen
        cabinet="leader"
        hasCompany
        companies={[]}
        activeCompanyId="co-1"
        rows={ALL_ROWS}
        {...over}
      />
    );
  }

  it('поля собираются ПО РЕЕСТРУ: все группы с названиями и все пункты', () => {
    screenOf();
    // Названия групп берём из самого реестра: добавят седьмую — тест увидит
    // её отсутствие на экране, а не промолчит про захардкоженный список.
    for (const group of DOCUMENT_TEMPLATE_GROUPS) {
      expect(screen.getByRole('heading', { level: 2, name: group.title })).toBeTruthy();
      expect(screen.getByText(group.hint)).toBeTruthy();
    }
    for (const slot of DOCUMENT_TEMPLATE_SLOTS) {
      expect(screen.getByTestId(`template-slot-${slot.key}`)).toBeTruthy();
    }
    // Названия из требования — проверяем буквально, их читает заказчик.
    // Порядок тоже: группы КП (`У-162`) идут ПОСЛЕ договорных, потому что
    // договор в компании правят чаще.
    expect(DOCUMENT_TEMPLATE_GROUPS.map((g) => g.title)).toEqual([
      'Предмет',
      'Порядок оплаты',
      'Сроки и приёмка',
      'Ответственность',
      'Срок действия',
      'Прочие условия',
      'Вводный текст предложения',
      'Условия предложения',
    ]);
  });

  it('пустой встроенный текст («Прочие условия») тоже даёт поле — иначе пункт не завести', () => {
    screenOf();
    const misc = within(screen.getByTestId('template-slot-misc'));
    expect((misc.getByLabelText('Текст пункта') as HTMLTextAreaElement).value).toBe('');
  });

  it('у администратора есть выбор компании, у руководителя его нет', () => {
    const { unmount } = screenOf({
      cabinet: 'admin',
      companies: [
        { id: 'co-1', name: 'ООО «Ромашка»' },
        { id: 'co-2', name: 'ООО «Василёк»' },
      ],
    });
    const select = screen.getByLabelText('Компания-исполнитель') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'ООО «Ромашка»',
      'ООО «Василёк»',
    ]);
    expect(select.value).toBe('co-1');
    unmount();

    // Руководитель правит только свою компанию (`Р-22`), поэтому выбирать ему
    // нечего: селект на экране означал бы обещание, которого сервис не даёт.
    screenOf({ cabinet: 'leader' });
    expect(screen.queryByLabelText('Компания-исполнитель')).toBeNull();
  });

  it('руководитель без компании видит объяснение и куда идти, а не пустую форму', () => {
    screenOf({ cabinet: 'leader', hasCompany: false, activeCompanyId: null });
    expect(screen.getByText(/не привязана к компании/)).toBeTruthy();
    expect(screen.getByText(/Обратитесь к администратору/)).toBeTruthy();
    expect(screen.queryByTestId('template-slot-payment')).toBeNull();
  });

  it('администратор без компаний видит СВОЁ объяснение — править тексты не для кого', () => {
    screenOf({ cabinet: 'admin', hasCompany: false, companies: [], activeCompanyId: null });
    expect(screen.getByText(/Нет ни одной компании-исполнителя/)).toBeTruthy();
    expect(screen.queryByTestId('template-slot-payment')).toBeNull();
  });

  it('компании есть, но ни одна не выбрана — форма не рисуется: сохранять было бы некуда', () => {
    screenOf({
      cabinet: 'admin',
      hasCompany: true,
      companies: [{ id: 'co-1', name: 'ООО «Ромашка»' }],
      activeCompanyId: null,
    });
    expect(screen.queryByTestId('template-slot-payment')).toBeNull();
    expect(screen.getByLabelText('Компания-исполнитель')).toBeTruthy();
  });

  it('рядом с полем сказано, где пункт печатается, и перечислены подстановки', () => {
    screenOf();
    const field = screen.getByTestId('template-slot-payment');
    // Договор — юридический документ: править «вслепую» опаснее, чем не
    // править вовсе, поэтому номер пункта и место печати стоят у поля.
    expect(field.textContent).toContain(`Пункт ${PAYMENT.clause}`);
    expect(field.textContent).toContain(PAYMENT.where);
    expect(field.textContent).toContain('{{document.subject}} — предмет документа');
    expect(field.textContent).toContain('{{amount.inWords}} — сумма прописью');
  });

  it('у «Срока действия» договора подстановка помечена обязательной', () => {
    screenOf();
    const field = screen.getByTestId('template-slot-term.contract');
    // Без {{contract.term}} срочный договор молча станет бессрочным —
    // человек должен увидеть это ДО сохранения, а не в отказе сервера.
    expect(field.textContent).toContain('Обязательна: {{contract.term}}');
    expect(TERM_CONTRACT.required).toEqual(['contract.term']);
    // У соседнего пункта обязательных нет — метка не должна «протекать».
    expect(screen.getByTestId('template-slot-payment').textContent).not.toContain('Обязательна');
  });
});

describe('DocumentTemplateField — редактор одного пункта', () => {
  function fieldOf(slot: DocumentTemplateSlot, row: TemplateRow = rowFor(slot)) {
    render(<DocumentTemplateField cabinet="admin" companyId="co-1" slot={slot} row={row} />);
    return within(screen.getByTestId(`template-slot-${slot.key}`));
  }

  const saveBtn = (f: ReturnType<typeof fieldOf>) =>
    f.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;

  it('«Сохранить» неактивна, пока текст не менялся, и оживает после правки', () => {
    const f = fieldOf(PAYMENT);
    expect(saveBtn(f).disabled).toBe(true);
    fireEvent.change(f.getByLabelText('Текст пункта'), {
      target: { value: 'Оплата в день счёта.' },
    });
    expect(saveBtn(f).disabled).toBe(false);
  });

  /**
   * Три стража на один класс ошибки: экран после действия обязан показывать
   * НОВОЕ состояние, а не то, что приехало с сервера при загрузке страницы.
   * Все три ловили настоящие дефекты этого PR.
   */
  it('после сохранения бейдж показывает НОВУЮ редакцию, а не прочерк', async () => {
    saveDocumentTemplateAction.mockResolvedValue({ ok: true, revision: 4 });
    const f = fieldOf(PAYMENT);
    fireEvent.change(f.getByLabelText('Текст пункта'), { target: { value: 'Предоплата 100%.' } });
    fireEvent.click(saveBtn(f));
    // Иначе рядом стоят два противоречащих сообщения: всплывающее «редакция 4»
    // и бейдж «редакция —».
    await waitFor(() => expect(f.getByText('Свой текст, редакция 4')).toBeTruthy());
  });

  it('после сохранения «Сохранить» гаснет: повтор сжёг бы ещё один номер редакции', async () => {
    saveDocumentTemplateAction.mockResolvedValue({ ok: true, revision: 4 });
    const f = fieldOf(PAYMENT);
    fireEvent.change(f.getByLabelText('Текст пункта'), { target: { value: 'Предоплата 100%.' } });
    fireEvent.click(saveBtn(f));
    await waitFor(() => expect(saveBtn(f).disabled).toBe(true));
  });

  it('после сброса «Сохранить» гаснет: иначе один клик записал бы стандартный текст как свой', async () => {
    // Это ровно то, чего избегает вся схема «в базе только отличия»: копия
    // встроенного текста заморозила бы формулировку.
    resetDocumentTemplateAction.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = fieldOf(
      PAYMENT,
      rowFor(PAYMENT, { body: 'Свой текст', isCustom: true, revision: 2 })
    );
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));
    await waitFor(() => expect(f.getByText('Стандартный текст')).toBeTruthy());
    expect(saveBtn(f).disabled).toBe(true);
  });

  it('обрыв связи не оставляет кнопку навсегда в «Сохраняю…»', async () => {
    // Server-action может не вернуть результат, а упасть: перезапуск сервера,
    // сеть. Без ловли исключения кнопка осталась бы заблокированной до
    // перезагрузки страницы, и человек не понял бы, сохранилось ли.
    saveDocumentTemplateAction.mockRejectedValue(new Error('сеть отвалилась'));
    const f = fieldOf(PAYMENT);
    fireEvent.change(f.getByLabelText('Текст пункта'), { target: { value: 'Новый текст.' } });
    fireEvent.click(saveBtn(f));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(saveBtn(f).textContent).toBe('Сохранить');
    expect(saveBtn(f).disabled).toBe(false);
  });

  it('обрыв связи при сбросе тоже разблокирует кнопку и оставляет текст на месте', async () => {
    resetDocumentTemplateAction.mockRejectedValue(new Error('сеть отвалилась'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = fieldOf(
      PAYMENT,
      rowFor(PAYMENT, { body: 'Свой текст', isCustom: true, revision: 2 })
    );
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(f.getByRole('button', { name: 'Вернуть стандартный' })).toBeTruthy();
    expect((f.getByLabelText('Текст пункта') as HTMLTextAreaElement).value).toBe('Свой текст');
  });

  it('успешное сохранение показывает успех и ПОЯВЛЯЕТ «Вернуть стандартный»', async () => {
    saveDocumentTemplateAction.mockResolvedValue({ ok: true, revision: 4 });
    const f = fieldOf(PAYMENT);
    // До первой правки возвращать нечего — кнопки сброса нет.
    expect(f.queryByRole('button', { name: 'Вернуть стандартный' })).toBeNull();

    fireEvent.change(f.getByLabelText('Текст пункта'), { target: { value: 'Предоплата 100%.' } });
    fireEvent.click(saveBtn(f));

    await waitFor(() => expect(saveDocumentTemplateAction).toHaveBeenCalled());
    const fd = saveDocumentTemplateAction.mock.calls[0]![1] as FormData;
    expect(fd.get('companyId')).toBe('co-1');
    expect(fd.get('slot')).toBe('payment');
    expect(fd.get('body')).toBe('Предоплата 100%.');
    expect(toastSuccess).toHaveBeenCalledWith('Пункт 2.2 сохранён (редакция 4).');
    // Кнопка сброса обязана появиться сразу: ждать перезагрузки страницы,
    // чтобы отменить только что сохранённое, — это ловушка.
    expect(f.getByRole('button', { name: 'Вернуть стандартный' })).toBeTruthy();
  });

  it('отказ сервера объясняется по-русски, а не кодом ошибки', async () => {
    saveDocumentTemplateAction.mockResolvedValue({
      ok: false,
      error: 'missing_placeholder',
      tokens: ['contract.term'],
    });
    const f = fieldOf(TERM_CONTRACT);
    fireEvent.change(f.getByLabelText('Текст пункта'), {
      target: { value: 'Договор бессрочный.' },
    });
    fireEvent.click(saveBtn(f));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toContain('обязательная подстановка');
    expect(toastSuccess).not.toHaveBeenCalled();
    // Отказ не считается своим текстом: кнопки сброса не появилось.
    expect(f.queryByRole('button', { name: 'Вернуть стандартный' })).toBeNull();
  });

  it('«Вернуть стандартный» спрашивает подтверждение; отказ НЕ зовёт действие', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const f = fieldOf(
      TERM_CONTRACT,
      rowFor(TERM_CONTRACT, { body: 'Свой срок.', isCustom: true, revision: 2 })
    );
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));

    expect(confirmSpy).toHaveBeenCalled();
    // Своего текста после сброса не останется нигде — «случайный клик» обязан
    // быть отменяемым.
    expect(resetDocumentTemplateAction).not.toHaveBeenCalled();
    expect((f.getByLabelText('Текст пункта') as HTMLTextAreaElement).value).toBe('Свой срок.');
  });

  it('после подтверждённого сброса в поле возвращается встроенный текст, кнопка исчезает', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    resetDocumentTemplateAction.mockResolvedValue({ ok: true, revision: 5 });
    const f = fieldOf(
      PAYMENT,
      rowFor(PAYMENT, { body: 'Наличными.', isCustom: true, revision: 3 })
    );
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));

    await waitFor(() => expect(resetDocumentTemplateAction).toHaveBeenCalled());
    const fd = resetDocumentTemplateAction.mock.calls[0]![1] as FormData;
    expect(fd.get('slot')).toBe('payment');
    expect(fd.get('body')).toBeNull();
    // Встроенный текст показывается сразу — человек видит, что теперь печатается.
    expect((f.getByLabelText('Текст пункта') as HTMLTextAreaElement).value).toBe(
      PAYMENT.defaultText
    );
    expect(f.queryByRole('button', { name: 'Вернуть стандартный' })).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith('Пункт 2.2 снова печатается стандартным текстом.');
  });

  it('неудачный сброс оставляет свой текст на месте и объясняет отказ по-русски', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    resetDocumentTemplateAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const f = fieldOf(
      PAYMENT,
      rowFor(PAYMENT, { body: 'Наличными.', isCustom: true, revision: 3 })
    );
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toBe('Нет прав на загрузку.');
    expect((f.getByLabelText('Текст пункта') as HTMLTextAreaElement).value).toBe('Наличными.');
    expect(f.getByRole('button', { name: 'Вернуть стандартный' })).toBeTruthy();
  });

  it('пока запрос в пути — кнопки заблокированы и подписаны «Сохраняю…»/«Возвращаю…»', async () => {
    let releaseSave: (v: unknown) => void = () => {};
    saveDocumentTemplateAction.mockReturnValue(new Promise((r) => (releaseSave = r)));
    const f = fieldOf(
      PAYMENT,
      rowFor(PAYMENT, { body: 'Наличными.', isCustom: true, revision: 3 })
    );
    fireEvent.change(f.getByLabelText('Текст пункта'), { target: { value: 'Картой.' } });
    fireEvent.click(saveBtn(f));

    // Двойной клик по «Сохранить» выдал бы две редакции одного текста.
    const saving = await f.findByRole('button', { name: 'Сохраняю…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(
      (f.getByRole('button', { name: 'Вернуть стандартный' }) as HTMLButtonElement).disabled
    ).toBe(true);
    releaseSave({ ok: true, revision: 7 });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let releaseReset: (v: unknown) => void = () => {};
    resetDocumentTemplateAction.mockReturnValue(new Promise((r) => (releaseReset = r)));
    fireEvent.click(f.getByRole('button', { name: 'Вернуть стандартный' }));
    const resetting = await f.findByRole('button', { name: 'Возвращаю…' });
    expect((resetting as HTMLButtonElement).disabled).toBe(true);
    releaseReset({ ok: true, revision: 8 });
    await waitFor(() => expect(f.queryByRole('button', { name: 'Возвращаю…' })).toBeNull());
  });

  it('у пункта со своим текстом видно «Свой текст, редакция N», у остальных — «Стандартный текст»', () => {
    const { unmount } = render(
      <DocumentTemplateField
        cabinet="admin"
        companyId="co-1"
        slot={PAYMENT}
        row={rowFor(PAYMENT, { body: 'Наличными.', isCustom: true, revision: 12 })}
      />
    );
    expect(screen.getByText('Свой текст, редакция 12')).toBeTruthy();
    unmount();

    const f = fieldOf(PAYMENT);
    expect(f.getByText('Стандартный текст')).toBeTruthy();
  });

  it('слот без подстановок не рисует строку-подсказку — перечислять нечего', () => {
    // Слот с пустым списком подстановок реестр сегодня не содержит, но код
    // такой случай допускает: проверяем, что подсказка исчезает целиком, а не
    // печатает голое «Подстановки:».
    const plain: DocumentTemplateSlot = { ...PAYMENT, placeholders: [], required: [] };
    const f = fieldOf(plain);
    expect(f.queryByText(/Подстановки:/)).toBeNull();
  });
});
