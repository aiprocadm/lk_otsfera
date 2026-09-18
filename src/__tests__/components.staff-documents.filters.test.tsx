// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { StaffDocuments } from '@/components/manager/staff-documents';
import type { ListDocumentsResult } from '@/lib/services/manager/documents';

/**
 * Экран «Документы» сотрудника после этапа 8 (`У-253`, `У-258`).
 *
 * Проверяется то, что человек видит и на что нажимает: четыре новых фильтра,
 * честная подпись «показано N из M» и подсказка поиска, которая не врёт про
 * то, что ищется.
 */
type Row = ListDocumentsResult['rows'][number];

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'd1',
    name: 'Счёт.pdf',
    type: 'invoice',
    direction: 'outgoing',
    signedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    size: 100,
    number: 'С-1',
    version: 1,
    orderId: 'o1',
    oneCPushStatus: 'none',
    bitrixId: null,
    externalId: null,
    generatedBy: 'system',
    uploadedBy: null,
    order: {
      id: 'o1',
      orderNumber: 'ON-1',
      title: 'Заказ',
      managerId: 'm1',
      organizationId: 'org1',
    },
    ...over,
  } as unknown as Row;
}

function mount(sp: Record<string, string> = {}, rows: Row[] = [row()], total = 340) {
  return render(
    <StaffDocuments
      cabinet="manager"
      sp={sp}
      data={{ tab: 'orders', rows, nextCursor: null, total }}
    />
  );
}

describe('StaffDocuments — фильтры и общее число (У-253)', () => {
  it('подсказка поиска говорит, что ищем и по номеру', () => {
    mount();
    expect(screen.getByPlaceholderText('Поиск по названию или номеру…')).toBeTruthy();
  });

  it('на экране есть все четыре новых фильтра', () => {
    mount();
    expect(screen.getByLabelText('Все годы')).toBeTruthy();
    expect(screen.getByLabelText('Входящие и исходящие')).toBeTruthy();
    expect(screen.getByLabelText('Любое состояние')).toBeTruthy();
    expect(screen.getByLabelText('Любой источник')).toBeTruthy();
  });

  it('выбранные значения фильтров остаются выбранными', () => {
    mount({ year: '2026', direction: 'incoming', status: 'sent', source: 'one_c' });
    expect((screen.getByLabelText('Все годы') as HTMLSelectElement).value).toBe('2026');
    expect((screen.getByLabelText('Входящие и исходящие') as HTMLSelectElement).value).toBe(
      'incoming'
    );
    expect((screen.getByLabelText('Любое состояние') as HTMLSelectElement).value).toBe('sent');
    expect((screen.getByLabelText('Любой источник') as HTMLSelectElement).value).toBe('one_c');
  });

  it('«показано N из M» — иначе «показано 50» читается как «их пятьдесят»', () => {
    mount({}, [row(), row({ id: 'd2' })], 340);
    expect(screen.getByText('Показано 2 из 340')).toBeTruthy();
  });

  it('пустой список подписи не показывает — там своё пустое состояние', () => {
    mount({}, [], 0);
    expect(screen.queryByText(/Показано/)).toBeNull();
  });

  it('источник документа виден в строке списка, а не только в фильтре', () => {
    const { container } = mount({}, [row({ generatedBy: 'system' } as Partial<Row>)]);
    // Это же слово есть в выпадающем списке фильтра, поэтому ищем именно в
    // строке документа: иначе тест был бы зелёным и без колонки.
    const list = container.querySelector('ul');
    expect(list?.textContent).toContain('Выпущен в кабинете');
  });

  it('фильтры переезжают в ссылку «Дальше» — переход их не теряет', () => {
    render(
      <StaffDocuments
        cabinet="manager"
        sp={{ year: '2026', source: 'staff', direction: 'incoming', status: 'issued' }}
        data={{ tab: 'orders', rows: [row()], nextCursor: 'cur-1', total: 100 }}
      />
    );
    const next = screen.getByText('Дальше →').closest('a') as HTMLAnchorElement;
    expect(next.getAttribute('href')).toContain('year=2026');
    expect(next.getAttribute('href')).toContain('source=staff');
    expect(next.getAttribute('href')).toContain('direction=incoming');
    expect(next.getAttribute('href')).toContain('status=issued');
    expect(next.getAttribute('href')).toContain('cursor=cur-1');
  });
});
