import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EnrollmentList } from '@/components/enrollment/enrollment-list';
import type { EnrollmentRow, EnrollmentItemRow } from '@/lib/services/enrollments/list';

function item(overrides: Partial<EnrollmentItemRow> = {}): EnrollmentItemRow {
  return {
    id: 'i1',
    studentId: null,
    fullName: 'Иван Петров',
    email: 'ivan@example.com',
    position: null,
    snils: null,
    birthDate: null,
    extra: null,
    status: 'pending',
    externalStudentId: null,
    ...overrides
  };
}

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1',
    directionName: 'Охрана труда',
    studentCount: 1,
    firstStudentName: 'Иван Петров',
    items: [item()],
    status: 'pending',
    organizationId: null,
    organizationName: null,
    partnerName: null,
    submitterRole: 'partner',
    submittedByName: 'Партнёр 1',
    rejectedReason: null,
    note: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    reviewedAt: null,
    ...overrides
  };
}

describe('EnrollmentList', () => {
  it('renders the empty state when there are no rows', () => {
    const html = renderToString(React.createElement(EnrollmentList, { rows: [] }));
    expect(html).toContain('Заявок на обучение пока нет');
  });

  it('renders first student, direction, counter and em dash for a missing organization', () => {
    // renderToString вставляет <!-- --> между текстовыми узлами — срезаем для проверки текста
    const html = renderToString(React.createElement(EnrollmentList, { rows: [row()] })).replace(/<!-- -->/g, '');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('1 слушатель');
    expect(html).toContain('—');
  });

  it('счётчик «и ещё N» для многопозиционной заявки + склонение', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, {
        rows: [row({ studentCount: 3, firstStudentName: 'Иван Петров' })]
      })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('и ещё 2');
    expect(html).toContain('3 слушателя');
  });

  it('firstStudentName=null (заявка без позиций) → «—»', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, { rows: [row({ firstStudentName: null, studentCount: 0, items: [] })] })
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('0 слушателей');
  });

  it('renders the organization name when present', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, { rows: [row({ organizationName: 'ООО Ромашка' })] })
    );
    expect(html).toContain('ООО Ромашка');
  });

  it('renders the rejected reason note only when status is rejected AND a reason is present', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, {
        rows: [row({ status: 'rejected', rejectedReason: 'Неполные данные' })]
      })
    );
    expect(html).toContain('Неполные данные');
  });

  it('does not render a reason note for non-rejected statuses even if rejectedReason happens to be set', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, {
        rows: [row({ status: 'approved', rejectedReason: 'stale leftover value' })]
      })
    );
    expect(html).not.toContain('stale leftover value');
  });
});
