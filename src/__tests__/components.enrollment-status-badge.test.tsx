import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import {
  EnrollmentStatusBadge,
  enrollmentStatusLabel,
} from '@/components/enrollment/enrollment-status-badge';

describe('EnrollmentStatusBadge', () => {
  it('renders the "На рассмотрении" label and amber tone for pending', () => {
    const html = renderToString(React.createElement(EnrollmentStatusBadge, { status: 'pending' }));
    expect(html).toContain('На рассмотрении');
    expect(html).toContain('bg-amber-50');
  });

  it('renders the "Принята" label and blue tone for approved', () => {
    const html = renderToString(React.createElement(EnrollmentStatusBadge, { status: 'approved' }));
    expect(html).toContain('Принята');
    expect(html).toContain('bg-blue-50');
  });

  it('renders the "Отклонена" label and gray tone for rejected', () => {
    const html = renderToString(React.createElement(EnrollmentStatusBadge, { status: 'rejected' }));
    expect(html).toContain('Отклонена');
    expect(html).toContain('bg-gray-100');
  });

  it('renders the "Зачислены" label and emerald tone for provisioned', () => {
    const html = renderToString(
      React.createElement(EnrollmentStatusBadge, { status: 'provisioned' })
    );
    expect(html).toContain('Зачислены');
    expect(html).toContain('bg-emerald-50');
  });

  it('этап 2: новые статусы конвейера — «Идёт обучение» и «Удостоверения готовы»', () => {
    const training = renderToString(
      React.createElement(EnrollmentStatusBadge, { status: 'in_training' })
    );
    expect(training).toContain('Идёт обучение');
    expect(training).toContain('bg-indigo-50');
    const ready = renderToString(
      React.createElement(EnrollmentStatusBadge, { status: 'certificates_ready' })
    );
    expect(ready).toContain('Удостоверения готовы');
    expect(ready).toContain('bg-green-50');
  });
});

describe('enrollmentStatusLabel', () => {
  it('maps every EnrollmentStatus to its Russian label', () => {
    expect(enrollmentStatusLabel('pending')).toBe('На рассмотрении');
    expect(enrollmentStatusLabel('approved')).toBe('Принята');
    expect(enrollmentStatusLabel('rejected')).toBe('Отклонена');
    expect(enrollmentStatusLabel('provisioned')).toBe('Зачислены');
    expect(enrollmentStatusLabel('in_training')).toBe('Идёт обучение');
    expect(enrollmentStatusLabel('certificates_ready')).toBe('Удостоверения готовы');
  });
});
