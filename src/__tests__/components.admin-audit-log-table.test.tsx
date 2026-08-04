import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { AuditLogTable } from '@/components/admin/audit-log-table';
import type { AuditRow } from '@/lib/services/admin/auditLog';

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'a1',
    createdAt: new Date('2026-03-10T12:34:56Z'),
    actor: { id: 'u1', email: 'ivan@example.com', name: 'Иван Иванов' },
    action: 'user_updated',
    entity: 'user',
    entityId: 'u1',
    meta: null,
    ...overrides,
  };
}

describe('AuditLogTable', () => {
  it('renders empty state message when there are no rows', () => {
    const html = renderToString(React.createElement(AuditLogTable, { rows: [] }));
    expect(html).toContain('Записей аудита не найдено');
  });

  it('строка журнала — по-русски: действие, объект, результат и дата', () => {
    const rows = [makeRow()];
    const html = renderToString(React.createElement(AuditLogTable, { rows }));
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('ivan@example.com');
    // Машинных значений в разметке быть не должно (критерий приёмки 7).
    expect(html).not.toContain('user_updated');
    expect(html).toContain('Изменение пользователя');
    expect(html).toContain('>Пользователь<');
    expect(html).toContain('Успешно');
    expect(html).toContain('10.03.2026');
    // Идентификатор записи — данные, остаётся как есть.
    expect(html).toContain('u1');
    expect(html).toContain('Подробно');
  });

  it('результат «Отказано в доступе» виден в своей колонке', () => {
    const rows = [makeRow({ meta: { status: 'denied' } })];
    const html = renderToString(React.createElement(AuditLogTable, { rows }));
    expect(html).toContain('Отказано в доступе');
  });

  it('renders "—" placeholder when actor is null', () => {
    const rows = [makeRow({ actor: null })];
    const html = renderToString(React.createElement(AuditLogTable, { rows }));
    expect(html).toContain('—');
  });

  it('renders multiple rows, each with its own entityId', () => {
    const rows = [makeRow({ entityId: 'entity-1' }), makeRow({ entityId: 'entity-2' })];
    const html = renderToString(React.createElement(AuditLogTable, { rows }));
    expect(html).toContain('entity-1');
    expect(html).toContain('entity-2');
    expect(html.match(/>Подробно</g)).toHaveLength(2);
  });
});
