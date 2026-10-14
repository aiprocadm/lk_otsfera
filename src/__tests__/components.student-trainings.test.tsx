import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  StudentCertificatesList,
  certificateExpiry,
  trainingDates,
} from '@/components/student/student-trainings';

/**
 * Этап 2 ТЗ 13.10.2026 (`У-284`): сроки обучения и срок удостоверения —
 * словами, которые понятны без расшифровки.
 */
describe('trainingDates', () => {
  it.each([
    [{ startsOn: '2026-11-01', endsOn: '2026-11-15' }, 'с 01.11.2026 по 15.11.2026'],
    [{ startsOn: '2026-11-01', endsOn: null }, 'с 01.11.2026'],
    [{ startsOn: null, endsOn: '2026-11-15' }, 'до 15.11.2026'],
    [{ startsOn: null, endsOn: null }, 'сроки ещё не назначены'],
  ])('%o → %s', (t, text) => {
    expect(trainingDates(t)).toBe(text);
  });
});

describe('certificateExpiry', () => {
  it.each([
    [{ validUntil: null, daysLeft: null }, 'Бессрочное', 'ok'],
    [{ validUntil: '2026-10-01', daysLeft: -3 }, 'Срок действия истёк 01.10.2026', 'expired'],
    [{ validUntil: '2026-10-14', daysLeft: 0 }, 'Действует последний день — 14.10.2026', 'soon'],
    [
      { validUntil: '2026-10-15', daysLeft: 1 },
      'Действует до 15.10.2026 — осталось 1 день',
      'soon',
    ],
    [
      { validUntil: '2027-01-12', daysLeft: 90 },
      'Действует до 12.01.2027 — осталось 90 дней',
      'soon',
    ],
    [
      { validUntil: '2027-01-13', daysLeft: 91 },
      'Действует до 13.01.2027 — осталось 91 день',
      'ok',
    ],
  ] as const)('%o → %s (%s)', (c, text, tone) => {
    expect(certificateExpiry(c)).toEqual({ text, tone });
  });
});

describe('StudentCertificatesList', () => {
  it('истёкшее удостоверение выделено красным', () => {
    const html = renderToString(
      <StudentCertificatesList
        certificates={[
          {
            id: 'c1',
            directionName: 'Охрана труда',
            number: 'ОТ-1',
            issuedAt: '2023-10-01T09:00:00.000Z',
            validUntil: '2026-10-01',
            daysLeft: -13,
          },
        ]}
      />
    );
    expect(html).toContain('text-red-600');
    expect(html).toContain('Срок действия истёк 01.10.2026');
    expect(html.replace(/<!-- -->/g, '')).toContain('Выдано 01.10.2023');
  });
});
