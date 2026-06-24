import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CertificateBadge, expiryLabel } from '@/components/training/certificate-badge';

const today = new Date('2026-06-23T00:00:00.000Z');

describe('certificate expiry badge', () => {
  it('бессрочное — без срока', () => {
    expect(expiryLabel(null, today)).toBe('Бессрочно');
  });
  it('истекает через N дней', () => {
    expect(expiryLabel(new Date('2026-07-23T00:00:00.000Z'), today)).toBe('Истекает через 30 дн.');
  });
  it('просрочено', () => {
    expect(expiryLabel(new Date('2026-06-01T00:00:00.000Z'), today)).toBe('Просрочено');
  });
  it('рендерится', () => {
    const html = renderToString(<CertificateBadge validUntil={null} today={today} />);
    expect(html).toContain('Бессрочно');
  });
});
