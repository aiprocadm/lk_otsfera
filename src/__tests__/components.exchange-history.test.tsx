// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ExchangeHistory } from '@/components/import/exchange-history';
import type { ExchangeHistoryItem } from '@/lib/services/import/history';

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
    expect(within(list).getByText('Выписка (сч. 51)')).toBeTruthy();
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
});
