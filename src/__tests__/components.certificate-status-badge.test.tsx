import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  certificateStatus,
  CertificateStatusBadge,
} from '@/components/certificates/certificate-status-badge';

/**
 * Этап 3 PR-1 (спека §4): статус удостоверения в клиентских реестрах —
 * действует (включая бессрочные) / истекает ≤60 дн / истекло.
 */

const TODAY = new Date('2026-07-24T15:30:00');
const day = (offset: number) =>
  new Date(new Date('2026-07-24T00:00:00').getTime() + offset * 24 * 3600 * 1000);

describe('certificateStatus', () => {
  it('null (бессрочное) → active', () => {
    expect(certificateStatus(null, TODAY)).toBe('active');
  });

  it('вчера → expired; сегодня → expiring (граница)', () => {
    expect(certificateStatus(day(-1), TODAY)).toBe('expired');
    expect(certificateStatus(day(0), TODAY)).toBe('expiring');
  });

  it('ровно +60 дней → expiring; +61 день → active', () => {
    expect(certificateStatus(day(60), TODAY)).toBe('expiring');
    expect(certificateStatus(day(61), TODAY)).toBe('active');
  });
});

describe('CertificateStatusBadge', () => {
  it('истекло → красный бейдж «Истекло»', () => {
    const html = renderToString(<CertificateStatusBadge validUntil={day(-3)} today={TODAY} />);
    expect(html).toContain('Истекло');
    expect(html).toContain('text-red-700');
  });

  it('истекает → жёлтый бейдж с числом дней', () => {
    const html = renderToString(<CertificateStatusBadge validUntil={day(14)} today={TODAY} />);
    expect(html).toContain('Истекает через');
    expect(html).toContain('14');
    expect(html).toContain('text-amber-700');
  });

  it('действует (за горизонтом и бессрочное) → зелёный бейдж', () => {
    const far = renderToString(<CertificateStatusBadge validUntil={day(200)} today={TODAY} />);
    expect(far).toContain('Действует');
    expect(far).toContain('text-green-700');
    const perpetual = renderToString(<CertificateStatusBadge validUntil={null} today={TODAY} />);
    expect(perpetual).toContain('Действует');
  });
});
