import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PiiAccessTable } from '@/components/admin/pii-access-table';
import type { PiiAccessRow } from '@/lib/services/admin/piiAccess';

function row(over: Partial<PiiAccessRow> = {}): PiiAccessRow {
  return {
    id: 'ev1',
    createdAt: new Date('2026-07-11T10:00:00Z'),
    actor: { id: 'u1', email: 'e@x.ru', name: 'Емп Ловеев' },
    userRole: 'manager',
    context: 'manager_students_list',
    labelRu: 'Список слушателей',
    action: 'list',
    subjectType: 'student',
    subjectCount: 1,
    subjects: [{ id: 's1', label: 'Иван И.' }],
    meta: null,
    ...over
  };
}

describe('PiiAccessTable', () => {
  it('пустой список → EmptyState', () => {
    expect(renderToString(<PiiAccessTable rows={[]} />)).toContain('Записей журнала не найдено');
  });

  it('рендерит актора, контекст и субъектов', () => {
    const html = renderToString(<PiiAccessTable rows={[row()]} />);
    expect(html).toContain('Емп Ловеев');
    expect(html).toContain('Список слушателей');
    expect(html).toContain('Иван И.');
  });

  it('превью субъектов обрезается с «и ещё N»; actor=null → тире', () => {
    const subjects = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));
    const html = renderToString(
      <PiiAccessTable rows={[row({ actor: null, subjects, subjectCount: 7 })]} />
    );
    expect(html).toContain('и ещё 2');
    expect(html).toContain('—');
  });
});
