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

  it('neutral tone (Бессрочно) не совпадает ни с danger, ни с warning', () => {
    const html = renderToString(<CertificateBadge validUntil={null} today={today} />);
    expect(html).toContain('Бессрочно');
  });

  it('warning tone для «Истекает через N дн.»', () => {
    const html = renderToString(
      <CertificateBadge validUntil={new Date('2026-07-23T00:00:00.000Z')} today={today} />
    );
    expect(html).toContain('Истекает через 30 дн.');
  });

  // Прогон сопровождения №36 (`Р-М-3`). Срок пишет `POST /api/manager/certificates`
  // из `<input type="date">`: `new Date('ГГГГ-ММ-ДД')` — полночь UTC (03:00 МСК).
  // «Сегодня» в карточке — текущий МОМЕНТ (`new Date()` в списке), а не полночь.
  it('дни — московские: ночью 00:00–03:00 МСК подпись не врёт на день (прогон №36)', () => {
    const night = new Date('2026-06-23T01:30:00+03:00'); // сервер (UTC) ещё в 22.06
    // Срок «сегодня» — 0 дней, а не «через 1 дн.».
    expect(expiryLabel(new Date('2026-06-23'), night)).toBe('Истекает через 0 дн.');
    // Срок «вчера» — «Просрочено», а не «Истекает через 0 дн.» (`ceil(-0.9) = -0`).
    expect(expiryLabel(new Date('2026-06-22'), night)).toBe('Просрочено');
    // Поздно вечером (23:30 МСК = 20:30 UTC) срок «сегодня» — всё ещё 0 дней.
    expect(expiryLabel(new Date('2026-06-23'), new Date('2026-06-23T23:30:00+03:00'))).toBe(
      'Истекает через 0 дн.'
    );
  });

  it('danger tone для «Просрочено»', () => {
    const html = renderToString(
      <CertificateBadge validUntil={new Date('2026-06-01T00:00:00.000Z')} today={today} />
    );
    expect(html).toContain('Просрочено');
  });
});
