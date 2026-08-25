// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { planImportRollbackAction, rollbackImportAction } = vi.hoisted(() => ({
  planImportRollbackAction: vi.fn(),
  rollbackImportAction: vi.fn(),
}));
vi.mock('@/server-actions/import', () => ({ planImportRollbackAction, rollbackImportAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ExchangeHistory } from '@/components/import/exchange-history';
import type { ExchangeHistoryItem } from '@/lib/services/import/history';

beforeAll(() => {
  // jsdom не реализует нативный <dialog> — мокаем императивный мост примитива.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

beforeEach(() => {
  planImportRollbackAction.mockReset();
  rollbackImportAction.mockReset();
  toastSuccess.mockReset();
  refresh.mockReset();
});

/**
 * Вкладка «История» (`У-48`). Проверяем то, ради чего она сделана: человек
 * видит записи ВСЕХ каналов, может отфильтровать и понимает, можно ли отменить
 * загрузку — вместо неактивной кнопки без объяснения.
 */
function item(over: Partial<ExchangeHistoryItem> = {}): ExchangeHistoryItem {
  return {
    id: 'i1',
    channel: 'excel',
    createdAt: '2026-08-10T10:00:00.000Z',
    title: 'organizations.xlsx',
    authorName: 'Админ',
    status: 'committed',
    rollback: 'available',
    counts: { created: 3, skipped: 0 },
    ...over,
  };
}

describe('ExchangeHistory (У-48)', () => {
  it('пустой список объясняет, что делать, а не просто «нет данных» (§15)', () => {
    render(<ExchangeHistory items={[]} />);
    // Пустой экран называет, куда идти (в списке фильтра то же слово — берём
    // текст самого пустого состояния).
    expect(screen.getByText(/Обменов пока не было.*Загрузка Excel/s)).toBeTruthy();
  });

  it('показывает записи всех каналов с автором, итогом и состоянием отмены', () => {
    render(
      <ExchangeHistory
        items={[
          item(),
          item({ id: 'i2', channel: 'statement', title: 'Выписка.xls', rollback: 'unsupported' }),
          item({
            id: 'i3',
            channel: 'auto',
            title: 'Организации · получение',
            authorName: null,
            rollback: 'unsupported',
          }),
        ]}
      />
    );
    const list = screen.getByTestId('exchange-history-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Выписка по счёту 51')).toBeTruthy();
    expect(within(list).getAllByText('можно отменить')).toHaveLength(1);
    expect(within(list).getAllByText('отмена не предусмотрена')).toHaveLength(2);
    // Автообмен идёт по расписанию — автора у него нет, и это сказано словами.
    expect(within(list).getByText('по расписанию')).toBeTruthy();
    // Числа берутся из counts и показываются по-русски (у всех трёх фикстур
    // они одинаковые — считаем, а не ищем единственное вхождение).
    expect(within(list).getAllByText('создано: 3')).toHaveLength(3);
  });

  it('фильтр по каналу оставляет только его записи', () => {
    render(
      <ExchangeHistory
        items={[item(), item({ id: 'i2', channel: 'statement', title: 'Выписка.xls' })]}
      />
    );
    fireEvent.change(screen.getByLabelText('Канал'), { target: { value: 'statement' } });

    const list = screen.getByTestId('exchange-history-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Выписка.xls')).toBeTruthy();
    expect(screen.getByText('Записей: 1')).toBeTruthy();
  });

  it('пустой результат фильтра подсказывает вернуться ко всем каналам', () => {
    render(<ExchangeHistory items={[item()]} />);
    fireEvent.change(screen.getByLabelText('Канал'), { target: { value: 'auto' } });
    expect(screen.getByText(/выберите «Все каналы»/)).toBeTruthy();
  });

  it('неизвестный статус и пустые числа не ломают строку', () => {
    render(<ExchangeHistory items={[item({ status: 'weird', counts: null })]} />);
    const list = screen.getByTestId('exchange-history-list');
    expect(within(list).getByText('weird')).toBeTruthy();
    expect(within(list).queryByText('Числа')).toBeNull();
  });

  it('числа без положительных значений не показываются вовсе', () => {
    render(<ExchangeHistory items={[item({ counts: { created: 0, skipped: 0 } })]} />);
    expect(screen.queryByText('Числа')).toBeNull();
  });

  it('незнакомый счётчик показывается своим ключом, а не прячется', () => {
    // Каналы добавляют свои счётчики; экран не должен молча их терять.
    render(<ExchangeHistory items={[item({ counts: { somethingNew: 7 } })]} />);
    expect(screen.getByText('somethingNew: 7')).toBeTruthy();
  });

  it('импорт до появления отмены объясняет, почему кнопки нет', () => {
    render(
      <ExchangeHistory items={[item({ channel: 'statement', rollback: 'nothing_to_revert' })]} />
    );
    expect(screen.getByText('отменять нечего: загружено до появления отмены')).toBeTruthy();
    expect(screen.queryByTestId('exchange-rollback-i1')).toBeNull();
  });
});

describe('ExchangeHistory — отмена импорта (У-59)', () => {
  it('у выписки есть кнопка отмены, и она откатывает ИМЕННО канал выписки', async () => {
    planImportRollbackAction.mockResolvedValue({
      ok: true,
      plan: {
        toDelete: { organizations: 0, orders: 0, payments: 5 },
        toRestore: 1,
        conflicts: [],
      },
    });
    rollbackImportAction.mockResolvedValue({ ok: true, status: 'rolled_back' });

    render(
      <ExchangeHistory items={[item({ id: 'st-1', channel: 'statement', title: 'Выписка.xls' })]} />
    );
    fireEvent.click(screen.getByTestId('exchange-rollback-st-1'));

    // Канал уезжает на сервер: без него откатился бы чужой Excel-батч.
    await waitFor(() => expect(planImportRollbackAction).toHaveBeenCalledWith('st-1', 'statement'));
    expect((await screen.findByTestId('rollback-summary')).textContent).toContain('5 платежей');

    fireEvent.click(screen.getByTestId('rollback-confirm'));
    await waitFor(() =>
      expect(rollbackImportAction).toHaveBeenCalledWith('st-1', false, 'statement')
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Импорт откачен полностью'));
    // Список перечитывается — иначе откаченный батч остался бы «выполненным».
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('у автообмена кнопки отмены нет — отменять поток нечем', () => {
    render(
      <ExchangeHistory
        items={[item({ id: 'a1', channel: 'auto', title: 'Организации · получение' })]}
      />
    );
    expect(screen.queryByTestId('exchange-rollback-a1')).toBeNull();
  });

  it('отказ сервера показывается по-русски, а не кодом', async () => {
    planImportRollbackAction.mockResolvedValue({ ok: false, error: 'nothing_to_revert' });
    render(<ExchangeHistory items={[item({ id: 'st-2', channel: 'statement' })]} />);
    fireEvent.click(screen.getByTestId('exchange-rollback-st-2'));
    // Оба диалога всегда смонтированы — ищем в открытом (§6 CLAUDE.md).
    await waitFor(() => {
      const open = document.querySelector('dialog[open]');
      expect(open).toBeTruthy();
      expect(within(open as HTMLElement).getByText(/Отменять нечего/)).toBeTruthy();
    });
  });
});
