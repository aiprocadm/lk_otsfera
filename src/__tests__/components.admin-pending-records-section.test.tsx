// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/admin/requeue-pending-button', () => ({
  RequeuePendingButton: (props: { id: string }) =>
    React.createElement('button', { 'data-testid': 'requeue', 'data-id': props.id }, 'Вернуть в очередь'),
}));

import { PendingRecordsSection } from '@/components/admin/pending-records-section';
import type { PendingRecordRow } from '@/lib/services/admin/pendingRecords';

function rec(over: Partial<PendingRecordRow> = {}): PendingRecordRow {
  return {
    id: 'p1',
    entity: 'payment',
    externalId: 'PAY-1',
    reason: 'organization_not_found',
    attempts: 2,
    status: 'pending',
    firstSeenAt: new Date('2026-07-01T10:00:00Z'),
    lastTriedAt: new Date('2026-07-02T11:30:00Z'),
    ...over,
  };
}

describe('PendingRecordsSection', () => {
  it('пустое состояние: «Отложенных записей нет», таблица не рендерится', () => {
    render(<PendingRecordsSection records={[]} />);
    expect(screen.getByText('Отложенные записи 1С')).toBeTruthy();
    expect(screen.getByText('Отложенных записей нет')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('рендерит заголовок, пояснение и строки: сущность по-русски, причина, попытки, даты', () => {
    const { container } = render(
      <PendingRecordsSection
        records={[
          rec({ id: 'd1', entity: 'order', externalId: 'ORD-9', status: 'dead', attempts: 5, reason: 'organization_not_found' }),
          rec({ id: 'p1', entity: 'payment', externalId: 'PAY-1', status: 'pending' }),
        ]}
      />
    );
    expect(screen.getByText('Отложенные записи 1С')).toBeTruthy();
    // подпись-пояснение про прикладной dead-letter
    expect(container.textContent).toContain('dead-letter');
    expect(screen.getByText('Заказ')).toBeTruthy();
    expect(screen.getByText('Платёж')).toBeTruthy();
    expect(screen.getByText('ORD-9')).toBeTruthy();
    expect(screen.getByText('PAY-1')).toBeTruthy();
    expect(screen.getAllByText('organization_not_found')).toHaveLength(2);
    expect(screen.getByText('5')).toBeTruthy();
    // даты в ru-RU формате (дд.мм.гггг)
    expect(container.textContent).toContain('01.07.2026');
  });

  it('dead-строка получает кнопку возврата с id, pending — нет', () => {
    render(
      <PendingRecordsSection
        records={[
          rec({ id: 'd1', status: 'dead' }),
          rec({ id: 'p1', status: 'pending' }),
        ]}
      />
    );
    const buttons = screen.getAllByTestId('requeue');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('data-id')).toBe('d1');
  });

  it('статус-бейджи: dead — danger-тон (красный), pending — не danger', () => {
    render(
      <PendingRecordsSection
        records={[rec({ id: 'd1', status: 'dead' }), rec({ id: 'p1', status: 'pending' })]}
      />
    );
    const dead = screen.getByText('dead');
    const pending = screen.getByText('pending');
    expect(dead.className).toContain('text-red-700');
    expect(pending.className).not.toContain('text-red-700');
  });

  it('неизвестная сущность выводится как есть (fallback)', () => {
    render(<PendingRecordsSection records={[rec({ entity: 'mystery' })]} />);
    expect(screen.getByText('mystery')).toBeTruthy();
  });
});
