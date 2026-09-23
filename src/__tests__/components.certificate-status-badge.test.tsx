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

// Зона указана явно: сутки считаются по Москве (`Д-22`, хотфикс №20), а без
// суффикса даты читались бы в часовом поясе машины — на UTC-сервере и на
// ноутбуке в MSK тест давал бы разные ответы.
const TODAY = new Date('2026-07-24T15:30:00+03:00');
const day = (offset: number) =>
  new Date(new Date('2026-07-24T00:00:00+03:00').getTime() + offset * 24 * 3600 * 1000);

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

  // Прогон сопровождения №36 (`Р-М-3`). Помощник `day()` выше даёт московские
  // полуночи — таких значений в базе не бывает, и на них старый код был прав.
  // Настоящий писатель (`POST /api/manager/certificates`) хранит срок из
  // `<input type="date">` как `new Date('ГГГГ-ММ-ДД')` — полночь UTC (03:00 МСК).
  it('число дней — московское и ночью 00:00–03:00 МСК (прогон №36)', () => {
    const night = new Date('2026-07-24T01:30:00+03:00'); // сервер (UTC) ещё в 23.07
    // 07.08 — через 14 дней от 24.07; прежний `setHours(0, 0, 0, 0)` в поясе
    // процесса считал от 23.07 и писал «через 15 дн.».
    const html = renderToString(
      <CertificateStatusBadge validUntil={new Date('2026-08-07')} today={night} />
    );
    expect(html).toContain('Истекает через <!-- -->14<!-- --> дн.');
    // Срок «сегодня» — «через 0 дн.» весь московский день, до 23:59.
    const lastMinute = new Date('2026-07-24T23:59:00+03:00'); // 20:59 UTC
    expect(
      renderToString(
        <CertificateStatusBadge validUntil={new Date('2026-07-24')} today={lastMinute} />
      )
    ).toContain('Истекает через <!-- -->0<!-- --> дн.');
  });

  it('срок «вчера» ночью — «Истекло», а не «Истекает через 0 дн.» (прогон №36)', () => {
    const night = new Date('2026-07-24T01:30:00+03:00');
    expect(certificateStatus(new Date('2026-07-23'), night)).toBe('expired');
    const html = renderToString(
      <CertificateStatusBadge validUntil={new Date('2026-07-23')} today={night} />
    );
    expect(html).toContain('Истекло');
    // 60-й день (22.09) — ещё «истекает», 61-й (23.09) — «действует».
    expect(certificateStatus(new Date('2026-09-22'), TODAY)).toBe('expiring');
    expect(certificateStatus(new Date('2026-09-23'), TODAY)).toBe('active');
  });

  it('действует (за горизонтом и бессрочное) → зелёный бейдж', () => {
    const far = renderToString(<CertificateStatusBadge validUntil={day(200)} today={TODAY} />);
    expect(far).toContain('Действует');
    expect(far).toContain('text-green-700');
    const perpetual = renderToString(<CertificateStatusBadge validUntil={null} today={TODAY} />);
    expect(perpetual).toContain('Действует');
  });
});
