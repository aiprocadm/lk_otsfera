// @vitest-environment jsdom
/**
 * Этап 5 (`У-139`, `У-140`) — блок «Состав и стоимость» карточки заказа.
 *
 * Компонент презентационный: server-actions мокируются (боевые тянут prisma),
 * проверяем вид (пусто / таблица с итогами / только чтение / ручная сумма) и
 * то, что каждая кнопка доносит до сервиса ровно то, что человек видел.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { OrderLineRow, OrderLinesView } from '@/lib/services/orders/orderLines';
import type { OrderCatalogOption } from '@/lib/services/orders/linesPanel';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { addAction, updateAction, removeAction, manualAction, recalcAction, buildAction } =
  vi.hoisted(() => ({
    addAction: vi.fn(),
    updateAction: vi.fn(),
    removeAction: vi.fn(),
    manualAction: vi.fn(),
    recalcAction: vi.fn(),
    buildAction: vi.fn(),
  }));
vi.mock('@/server-actions/orders/lines', () => ({
  addOrderLineAction: addAction,
  updateOrderLineAction: updateAction,
  removeOrderLineAction: removeAction,
  setOrderTotalManuallyAction: manualAction,
  recalcOrderTotalAction: recalcAction,
  buildLinesFromItemsAction: buildAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderLinesSection } from '@/components/orders/order-lines-section';

const CATALOG: OrderCatalogOption[] = [
  {
    id: 'ci-1',
    name: 'Обучение по охране труда',
    code: 'OT-101',
    unit: 'person',
    price: '12500.00',
    vatRate: '0.2000',
    vatIncluded: true,
  },
  {
    id: 'ci-2',
    name: 'Разработка документов',
    code: 'DOC-7',
    unit: 'service',
    price: '30000.00',
    vatRate: null,
    vatIncluded: false,
  },
];

function makeLine(over: Partial<OrderLineRow> = {}): OrderLineRow {
  return {
    id: 'ol-1',
    catalogItemId: 'ci-1',
    title: 'Обучение по охране труда',
    quantity: '3.000',
    unit: 'person',
    unitPrice: '12500.00',
    discountPercent: '10.00',
    vatRate: '0.2000',
    vatIncluded: true,
    amount: '33750.00',
    sortOrder: 0,
    ...over,
  };
}

function makeView(over: Partial<OrderLinesView> = {}): OrderLinesView {
  return {
    lines: [],
    totals: { net: '0.00', vat: '0.00', gross: '0.00' },
    readOnly: false,
    totalAmount: '0.00',
    totalAmountIsManual: false,
    ...over,
  };
}

function renderSection(over: {
  view?: OrderLinesView;
  catalog?: OrderCatalogOption[];
  canEdit?: boolean;
} = {}) {
  return render(
    React.createElement(OrderLinesSection, {
      orderId: 'ord-1',
      view: over.view ?? makeView(),
      catalog: over.catalog ?? CATALOG,
      canEdit: over.canEdit ?? true,
    })
  );
}

/** ru-RU разделяет разряды неразрывным пробелом — сравниваем по обычному. */
function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/ /g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  addAction.mockResolvedValue({ ok: true });
  updateAction.mockResolvedValue({ ok: true });
  removeAction.mockResolvedValue({ ok: true });
  manualAction.mockResolvedValue({ ok: true });
  recalcAction.mockResolvedValue({ ok: true });
  buildAction.mockResolvedValue({ ok: true, created: 2, withoutPrice: [] });
});

describe('пустое состояние', () => {
  it('объясняет, что делать, и даёт обе кнопки', () => {
    const { container } = renderSection();
    expect(norm(container.textContent)).toContain('Состав и стоимость');
    expect(norm(container.textContent)).toContain('соберите их из позиций заказа');
    expect(screen.getByRole('button', { name: 'Добавить строку' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Собрать строки из позиций' })).toBeTruthy();
  });

  it('без права правки кнопок нет, но человек понимает, к кому идти', () => {
    const { container } = renderSection({ canEdit: false });
    expect(norm(container.textContent)).toContain('Их добавляют сотрудники центрального офиса');
    expect(screen.queryByRole('button', { name: 'Добавить строку' })).toBeNull();
  });
});

describe('таблица и итоги', () => {
  it('показывает строку, единицу, скидку, НДС и итоги «без НДС / НДС / с НДС»', () => {
    const { container } = renderSection({
      view: makeView({
        lines: [makeLine()],
        totals: { net: '28125.00', vat: '5625.00', gross: '33750.00' },
        totalAmount: '33750.00',
      }),
    });
    const text = norm(container.textContent);
    expect(text).toContain('Обучение по охране труда');
    expect(text).toContain('чел.');
    expect(text).toContain('10%');
    expect(text).toContain('20% в сумме');
    expect(text).toContain('33 750,00 ₽');
    expect(text).toContain('28 125,00 ₽');
    expect(text).toContain('5 625,00 ₽');
    // Широкая финансовая таблица не растягивает страницу на телефоне.
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('строка без скидки и без НДС: прочерк и «без НДС», а не пустота', () => {
    const { container } = renderSection({
      view: makeView({
        lines: [
          makeLine({ id: 'ol-2', discountPercent: null, vatRate: null, vatIncluded: false }),
        ],
      }),
    });
    expect(norm(container.textContent)).toContain('без НДС');
    expect(norm(container.textContent)).toContain('—');
  });

  it('НДС сверху подписан отдельно от НДС в сумме', () => {
    const { container } = renderSection({
      view: makeView({ lines: [makeLine({ vatIncluded: false })] }),
    });
    expect(norm(container.textContent)).toContain('20% сверху');
  });

  it('битые числа не роняют экран — вместо суммы прочерк', () => {
    const { container } = renderSection({
      view: makeView({ lines: [makeLine({ amount: 'нечисло', quantity: 'нечисло' })] }),
    });
    expect(norm(container.textContent)).toContain('—');
  });
});

describe('заказ из 1С — только чтение', () => {
  it('плашка есть, кнопок правки нет', () => {
    const { container } = renderSection({
      view: makeView({ lines: [makeLine()], readOnly: true, totalAmount: '33750.00' }),
    });
    expect(norm(container.textContent)).toContain('Заказ ведётся в 1С');
    expect(screen.queryByRole('button', { name: 'Добавить строку' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByLabelText('Задать сумму вручную')).toBeNull();
  });

  it('пустой заказ из 1С объясняет, откуда возьмутся строки', () => {
    const { container } = renderSection({ view: makeView({ readOnly: true }) });
    expect(norm(container.textContent)).toContain('их пришлёт обмен с 1С');
  });
});

describe('сумма заказа', () => {
  it('ручная сумма помечена плашкой и даёт кнопку возврата к расчёту', async () => {
    const { container } = renderSection({
      view: makeView({
        lines: [makeLine()],
        totalAmount: '50000.00',
        totalAmountIsManual: true,
      }),
    });
    expect(norm(container.textContent)).toContain('сумма задана вручную');
    expect(norm(container.textContent)).toContain('50 000,00 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать по строкам' }));
    await waitFor(() => expect(recalcAction).toHaveBeenCalledWith('ord-1'));
    expect(toastSuccess).toHaveBeenCalledWith('Сумма пересчитана по строкам.');
    expect(refresh).toHaveBeenCalled();
  });

  it('пока сумма считается по строкам, кнопки пересчёта нет', () => {
    renderSection({ view: makeView({ lines: [makeLine()] }) });
    expect(screen.queryByRole('button', { name: 'Пересчитать по строкам' })).toBeNull();
  });

  it('форма ручной суммы отправляет введённое значение', async () => {
    renderSection({ view: makeView({ lines: [makeLine()], totalAmount: '33750.00' }) });
    const input = screen.getByLabelText('Задать сумму вручную');
    fireEvent.change(input, { target: { value: '40000' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Задать вручную' }).closest('form')!);

    await waitFor(() => expect(manualAction).toHaveBeenCalled());
    expect(manualAction.mock.calls[0]![0]).toBe('ord-1');
    expect((manualAction.mock.calls[0]![1] as FormData).get('totalAmount')).toBe('40000');
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe('добавление строки', () => {
  it('выбор из каталога предзаполняет поля, но их можно править — цена это снимок', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });

    // Поиск по артикулу отсекает лишнее.
    fireEvent.change(within(dialog).getByLabelText('Выбрать из каталога'), {
      target: { value: 'OT-101' },
    });
    expect(within(dialog).queryByText(/Разработка документов/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Обучение по охране труда/ }));

    expect((within(dialog).getByLabelText('Наименование') as HTMLInputElement).value).toBe(
      'Обучение по охране труда'
    );
    expect((within(dialog).getByLabelText('Цена, ₽') as HTMLInputElement).value).toBe('12500.00');
    expect((within(dialog).getByLabelText('Ставка НДС') as HTMLSelectElement).value).toBe('0.2');

    // Снимок: правим цену руками, каталог тут больше ни при чём.
    fireEvent.change(within(dialog).getByLabelText('Цена, ₽'), { target: { value: '11000' } });
    fireEvent.change(within(dialog).getByLabelText('Количество'), { target: { value: '4' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() => expect(addAction).toHaveBeenCalled());
    expect(addAction.mock.calls[0]![0]).toBe('ord-1');
    const fd = addAction.mock.calls[0]![1] as FormData;
    expect(fd.get('catalogItemId')).toBe('ci-1');
    expect(fd.get('title')).toBe('Обучение по охране труда');
    expect(fd.get('unitPrice')).toBe('11000');
    expect(fd.get('quantity')).toBe('4');
    expect(fd.get('unit')).toBe('person');
    expect(fd.get('vatRate')).toBe('0.2');
    expect(fd.get('vatIncluded')).toBe('on');
    expect(toastSuccess).toHaveBeenCalledWith('Строка добавлена.');
    expect(refresh).toHaveBeenCalled();
  });

  it('позиция без НДС подставляет «не облагается» и снимает галочку', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Разработка документов/ }));

    expect((within(dialog).getByLabelText('Ставка НДС') as HTMLSelectElement).value).toBe('none');
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() => expect(addAction).toHaveBeenCalled());
    const fd = addAction.mock.calls[0]![1] as FormData;
    expect(fd.get('vatRate')).toBe('none');
    expect(fd.get('vatIncluded')).toBeNull();
  });

  it('свободная строка без каталога: поиск ничего не нашёл — форма всё равно работает', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    fireEvent.change(within(dialog).getByLabelText('Выбрать из каталога'), {
      target: { value: 'абырвалг' },
    });
    expect(within(dialog).getByText('Ничего не нашлось — заполните строку вручную.')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Наименование'), {
      target: { value: 'Своя услуга' },
    });
    fireEvent.change(within(dialog).getByLabelText('Цена, ₽'), { target: { value: '500' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() => expect(addAction).toHaveBeenCalled());
    const fd = addAction.mock.calls[0]![1] as FormData;
    expect(fd.get('catalogItemId')).toBe('');
    expect(fd.get('title')).toBe('Своя услуга');
  });

  it('пустой каталог компании — блока выбора нет, диалог остаётся рабочим', async () => {
    renderSection({ catalog: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    expect(within(dialog).queryByLabelText('Выбрать из каталога')).toBeNull();
  });

  it('ошибки полей показываются списком в диалоге, диалог не закрывается', async () => {
    addAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Цена: неотрицательное число', 'Количество: положительное число'],
    });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    fireEvent.change(within(dialog).getByLabelText('Наименование'), { target: { value: 'X' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toContain(
        'Цена: неотрицательное число'
      )
    );
    expect(within(dialog).getByRole('alert').textContent).toContain('Количество: положительное');
    expect(screen.getByRole('dialog', { name: 'Новая строка' })).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('заказ из 1С, открытый в соседней вкладке: код превращается в человеческую причину', async () => {
    addAction.mockResolvedValue({ ok: false, error: 'order_from_1c' });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    fireEvent.change(within(dialog).getByLabelText('Наименование'), { target: { value: 'X' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toContain('Заказ ведётся в 1С')
    );
  });

  it('диалог закрывается кнопкой «Отмена» без вызова сервиса', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая строка' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новая строка' })).toBeNull());
    expect(addAction).not.toHaveBeenCalled();
  });
});

describe('правка и удаление строки', () => {
  it('«Изменить» открывает диалог, предзаполненный строкой, и шлёт её id вместе с заказом', async () => {
    renderSection({ view: makeView({ lines: [makeLine({ sortOrder: 3 })] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить строку' });

    expect((within(dialog).getByLabelText('Количество') as HTMLInputElement).value).toBe('3.000');
    expect((within(dialog).getByLabelText('Скидка, %') as HTMLInputElement).value).toBe('10.00');
    expect((within(dialog).getByLabelText('Порядок') as HTMLInputElement).value).toBe('3');

    fireEvent.change(within(dialog).getByLabelText('Количество'), { target: { value: '5' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Сохранить' }).closest('form')!);

    await waitFor(() => expect(updateAction).toHaveBeenCalled());
    expect(updateAction.mock.calls[0]![0]).toBe('ol-1');
    const fd = updateAction.mock.calls[0]![1] as FormData;
    // Номер заказа нужен экшену для ревалидации карточки.
    expect(fd.get('orderId')).toBe('ord-1');
    expect(fd.get('quantity')).toBe('5');
    expect(toastSuccess).toHaveBeenCalledWith('Строка обновлена.');
  });

  it('строка без каталога и без НДС правится и не выдумывает связей', async () => {
    renderSection({
      view: makeView({
        lines: [makeLine({ catalogItemId: null, discountPercent: null, vatRate: null })],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить строку' });
    expect((within(dialog).getByLabelText('Ставка НДС') as HTMLSelectElement).value).toBe('none');
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Сохранить' }).closest('form')!);

    await waitFor(() => expect(updateAction).toHaveBeenCalled());
    const fd = updateAction.mock.calls[0]![1] as FormData;
    expect(fd.get('catalogItemId')).toBe('');
    expect(fd.get('discountPercent')).toBe('');
  });

  it('удаление спрашивает подтверждение и передаёт строку вместе с заказом', async () => {
    renderSection({ view: makeView({ lines: [makeLine()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(removeAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Точно удалить?' }));
    await waitFor(() => expect(removeAction).toHaveBeenCalledWith('ol-1', 'ord-1'));
    expect(toastSuccess).toHaveBeenCalledWith('Строка удалена.');
  });

  it('подтверждение можно отменить', async () => {
    renderSection({ view: makeView({ lines: [makeLine()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('button', { name: 'Точно удалить?' })).toBeNull();
    expect(removeAction).not.toHaveBeenCalled();
  });

  it('отказ на удалении объясняется по-русски, а не кодом', async () => {
    removeAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderSection({ view: makeView({ lines: [makeLine()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Точно удалить?' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Нет прав менять состав этого заказа.')
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('сборка строк из позиций заказа', () => {
  it('говорит, сколько строк добавлено', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать строки из позиций' }));
    await waitFor(() => expect(buildAction).toHaveBeenCalledWith('ord-1'));
    expect(toastSuccess).toHaveBeenCalledWith('Добавлено строк: 2.');
  });

  it('направления без цены названы поимённо — молчать о нулях нельзя', async () => {
    buildAction.mockResolvedValue({
      ok: true,
      created: 3,
      withoutPrice: ['Пожарная безопасность'],
    });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать строки из позиций' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]![0])).toContain('Пожарная безопасность');
  });

  it('нет позиций — сервис объясняет причину, экран её показывает', async () => {
    buildAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['В заказе нет позиций — сначала добавьте слушателей.'],
    });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать строки из позиций' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('В заказе нет позиций — сначала добавьте слушателей.')
    );
  });
});
