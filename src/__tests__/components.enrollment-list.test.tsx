import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { EnrollmentList } from '@/components/enrollment/enrollment-list';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1',
    studentName: 'Иван Петров',
    studentEmail: 'ivan@example.com',
    courseTitle: 'Охрана труда',
    status: 'pending',
    organizationId: null,
    organizationName: null,
    partnerName: null,
    submitterRole: 'partner',
    submittedByName: 'Партнёр 1',
    externalStudentId: null,
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

  it('renders student, course, and em dash for a missing organization', () => {
    const html = renderToString(React.createElement(EnrollmentList, { rows: [row()] }));
    expect(html).toContain('Иван Петров');
    expect(html).toContain('ivan@example.com');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('—');
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

  it('does not render a reason note when status is rejected but reason is null', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, { rows: [row({ status: 'rejected', rejectedReason: null })] })
    );
    expect(html).not.toContain('mt-0.5');
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
