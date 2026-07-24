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

describe('EnrollmentList — ссылки на деталку (detailHrefBase)', () => {
  it('с detailHrefBase: ссылка на имени первого слушателя и ссылка «подробнее»', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, { rows: [row()], detailHrefBase: '/organization/enrollments' })
    ).replace(/<!-- -->/g, '');
    // Две ссылки на деталку: обёртка имени + «подробнее»
    expect(html.match(/href="\/organization\/enrollments\/e1"/g)).toHaveLength(2);
    expect(html).toContain('подробнее');
    // Имя обёрнуто в <a>
    expect(html).toMatch(/<a[^>]*href="\/organization\/enrollments\/e1"[^>]*>Иван Петров<\/a>/);
  });

  it('href строится из id каждой строки', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, {
        rows: [row(), row({ id: 'e2', firstStudentName: 'Анна Иванова' })],
        detailHrefBase: '/partner/enrollments'
      })
    );
    expect(html).toContain('href="/partner/enrollments/e1"');
    expect(html).toContain('href="/partner/enrollments/e2"');
  });

  it('без detailHrefBase: ни ссылок, ни «подробнее» — имя обычным текстом', () => {
    const html = renderToString(React.createElement(EnrollmentList, { rows: [row()] })).replace(/<!-- -->/g, '');
    expect(html).toContain('Иван Петров');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('подробнее');
  });

  it('firstStudentName=null с detailHrefBase: ссылка с текстом «—»', () => {
    const html = renderToString(
      React.createElement(EnrollmentList, {
        rows: [row({ firstStudentName: null, studentCount: 0, items: [] })],
        detailHrefBase: '/organization/enrollments'
      })
    ).replace(/<!-- -->/g, '');
    expect(html).toMatch(/<a[^>]*href="\/organization\/enrollments\/e1"[^>]*>—<\/a>/);
  });
});
