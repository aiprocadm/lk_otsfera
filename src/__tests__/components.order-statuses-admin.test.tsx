// @vitest-environment jsdom
/**
 * §10 ТЗ v0.5 (этап 2, PR-2) — экран настройки справочника статусов.
 *
 * Главное, что здесь закрепляется: системные семь строк нельзя выключить и
 * удалить прямо из интерфейса, а порядок меняется стрелками (заказчик мыслит
 * последовательностью стадий, а не числом sortOrder).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { OrderStatusDefinition } from '@prisma/client';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderStatusesAdmin } from '@/components/admin/order-statuses-admin';

function row(over: Partial<OrderStatusDefinition> & { id: string }): OrderStatusDefinition {
  return {
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    companyId: null,
    key: over.id,
    label: 'Статус',
    sortOrder: 1,
    isActive: true,
    isSystem: false,
    isTerminal: false,
    anchor: null,
    ...over
  } as OrderStatusDefinition;
}

const SYSTEM_ROWS = [
  row({ id: 's1', key: 'draft', label: 'Черновик заявки', sortOrder: 1, isSystem: true }),
  row({ id: 's2', key: 'accepted', label: 'Принято в работу', sortOrder: 2, isSystem: true }),
  row({
    id: 's3',
    key: 'paid',
    label: 'Оплата поступила',
    sortOrder: 3,
    isSystem: true,
    anchor: 'paid'
  }),
  row({
    id: 's7',
    key: 'cancelled',
    label: 'Отменена',
    sortOrder: 7,
    isSystem: true,
    isTerminal: true
  })
];

function openDialog(): HTMLElement {
  return document.querySelector('dialog[open]') as HTMLElement;
}

beforeEach(() => {
  refresh.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OrderStatusesAdmin — показ справочника', () => {
  it('пустой справочник рисует заглушку', () => {
    render(<OrderStatusesAdmin rows={[]} />);
    expect(screen.getByText('Справочник пуст')).toBeTruthy();
  });

  it('строки идут по порядку, а не в порядке массива', () => {
    render(
      <OrderStatusesAdmin
        rows={[
          row({ id: 'b', label: 'Второй', sortOrder: 2 }),
          row({ id: 'a', label: 'Первый', sortOrder: 1 })
        ]}
      />
    );
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells.indexOf('Первый')).toBeLessThan(cells.indexOf('Второй'));
  });

  it('системная строка помечена и не даёт ни выключить, ни удалить', () => {
    render(<OrderStatusesAdmin rows={[SYSTEM_ROWS[0]]} />);
    expect(screen.getAllByText('системный').length).toBe(1);
    expect(screen.queryByRole('button', { name: 'Выключить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    // а переименовать — можно (§10)
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeTruthy();
  });

  it('строка с событием объясняет, что ставится автоматически', () => {
    render(<OrderStatusesAdmin rows={[SYSTEM_ROWS[2]]} />);
    expect(screen.getByText(/поступила оплата/)).toBeTruthy();
  });

  it('завершающий статус помечен отдельно', () => {
    render(<OrderStatusesAdmin rows={[SYSTEM_ROWS[3]]} />);
    expect(screen.getByText('завершающий')).toBeTruthy();
  });

  it('своя строка даёт выключение и удаление; выключенная — включение', () => {
    const { rerender } = render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);
    expect(screen.getByRole('button', { name: 'Выключить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();

    rerender(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё', isActive: false })]} />);
    expect(screen.getByRole('button', { name: 'Включить' })).toBeTruthy();
  });

  it('стрелок нет там, где двигать некуда', () => {
    render(
      <OrderStatusesAdmin
        rows={[
          row({ id: 'a', label: 'Первый', sortOrder: 1 }),
          row({ id: 'b', label: 'Второй', sortOrder: 2 })
        ]}
      />
    );
    expect(screen.queryByRole('button', { name: 'Поднять «Первый»' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Опустить «Первый»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Поднять «Второй»' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Опустить «Второй»' })).toBeNull();
  });
});

describe('OrderStatusesAdmin — действия', () => {
  it('добавление ставит статус в конец списка', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={SYSTEM_ROWS} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новый статус');
    const dialog = openDialog();

    fireEvent.change(within(dialog).getByLabelText('Название'), {
      target: { value: '  Выданы доступы  ' }
    });
    fireEvent.change(within(dialog).getByLabelText('Ключ (латиница, a-z0-9_)'), {
      target: { value: 'access_granted' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/order-statuses',
        expect.objectContaining({
          method: 'POST',
          // максимальный sortOrder среди строк = 7 → новый 8
          body: JSON.stringify({ key: 'access_granted', label: 'Выданы доступы', sortOrder: 8 })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус добавлен.'));
    expect(refresh).toHaveBeenCalled();
  });

  it('переименование шлёт только название, ключ показан только для чтения', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={[SYSTEM_ROWS[2]]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
    await screen.findByText('Переименовать статус');
    const dialog = openDialog();

    expect((within(dialog).getByLabelText('Ключ') as HTMLInputElement).readOnly).toBe(true);
    expect(within(dialog).getByText(/связь с событием останется/)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: 'Деньги пришли' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/order-statuses/s3',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ label: 'Деньги пришли' }) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус переименован.'));
  });

  it('перестановка меняет порядок местами с соседом — двумя запросами', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <OrderStatusesAdmin
        rows={[
          row({ id: 'a', label: 'Первый', sortOrder: 1 }),
          row({ id: 'b', label: 'Второй', sortOrder: 2 })
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Опустить «Первый»' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/admin/order-statuses/a',
        expect.objectContaining({ body: JSON.stringify({ sortOrder: 2 }) })
      )
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/admin/order-statuses/b',
        expect.objectContaining({ body: JSON.stringify({ sortOrder: 1 }) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Порядок изменён.'));
  });

  it('если ПЕРВЫЙ запрос перестановки упал — второго не будет', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <OrderStatusesAdmin
        rows={[
          row({ id: 'a', label: 'Первый', sortOrder: 1 }),
          row({ id: 'b', label: 'Второй', sortOrder: 2 })
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Опустить «Первый»' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // второй сосед не трогается — иначе порядок разъехался бы
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('если второй запрос перестановки упал — успеха не показываем', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <OrderStatusesAdmin
        rows={[
          row({ id: 'a', label: 'Первый', sortOrder: 1 }),
          row({ id: 'b', label: 'Второй', sortOrder: 2 })
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Поднять «Второй»' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('выключение и включение своей строки', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Выключить' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/order-statuses/x',
        expect.objectContaining({ body: JSON.stringify({ isActive: false }) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус выключен.'));

    fetchMock.mockClear();
    rerender(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё', isActive: false })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/order-statuses/x',
        expect.objectContaining({ body: JSON.stringify({ isActive: true }) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус включён.'));
  });

  it('удаление своей строки', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/order-statuses/x',
        expect.objectContaining({ method: 'DELETE' })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус удалён.'));
  });
});

describe('OrderStatusesAdmin — ошибки сервера показываются по-русски', () => {
  it.each([
    ['добавления', '+ Добавить'],
    ['удаления', 'Удалить'],
    ['выключения', 'Выключить']
  ])('отказ при %s', async (_name, buttonName) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'system_protected' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);

    if (buttonName === '+ Добавить') {
      fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
      await screen.findByText('Новый статус');
      const dialog = openDialog();
      fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: 'X' } });
      fireEvent.change(within(dialog).getByLabelText('Ключ (латиница, a-z0-9_)'), {
        target: { value: 'x_key' }
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
    }

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('отказ при переименовании', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
    await screen.findByText('Переименовать статус');
    fireEvent.click(within(openDialog()).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('нечитаемый ответ сервера тоже даёт понятную ошибку', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderStatusesAdmin rows={[row({ id: 'x', label: 'Своё' })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
