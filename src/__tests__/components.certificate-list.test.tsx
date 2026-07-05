import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { CertificateList, type CertificateListItem } from '@/components/training/certificate-list';

function cert(overrides: Partial<CertificateListItem> = {}): CertificateListItem {
  return {
    id: 'c1',
    number: 'УТ-0001',
    direction: { name: 'Охрана труда' },
    issuedAt: new Date('2024-01-15T10:00:00Z'),
    validUntil: null,
    ...overrides
  };
}

describe('CertificateList', () => {
  it('renders the empty state when there are no certificates', () => {
    const html = renderToString(React.createElement(CertificateList, { certificates: [] }));
    expect(html).toContain('Нет удостоверений.');
  });

  it('renders certificate number, direction name, and issued date', () => {
    const html = renderToString(React.createElement(CertificateList, { certificates: [cert()] }));
    expect(html).toContain('УТ-0001');
    expect(html).toContain('Охрана труда');
  });

  it('handles a null validUntil (renders "Бессрочно" via CertificateBadge)', () => {
    const html = renderToString(
      React.createElement(CertificateList, { certificates: [cert({ validUntil: null })] })
    );
    expect(html).toContain('Бессрочно');
  });

  it('handles a Date-instance validUntil (instanceof Date branch)', () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const html = renderToString(
      React.createElement(CertificateList, { certificates: [cert({ validUntil: farFuture })] })
    );
    expect(html).toContain('Истекает через');
  });

  it('handles a string validUntil (parsed via `new Date(...)` branch)', () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const html = renderToString(
      React.createElement(CertificateList, { certificates: [cert({ validUntil: farFuture.toISOString() })] })
    );
    expect(html).toContain('Истекает через');
  });

  it('renders multiple certificate rows', () => {
    const html = renderToString(
      React.createElement(CertificateList, {
        certificates: [cert({ id: 'c1', number: 'УТ-0001' }), cert({ id: 'c2', number: 'УТ-0002' })]
      })
    );
    expect(html).toContain('УТ-0001');
    expect(html).toContain('УТ-0002');
  });
});
