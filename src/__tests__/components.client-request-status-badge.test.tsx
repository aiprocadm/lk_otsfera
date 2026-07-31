import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { ClientRequestStatus } from '@prisma/client';
import {
  ClientRequestStatusBadge,
  clientRequestStatusBadgeLabel,
} from '@/components/client-requests/client-request-status-badge';

const CASES: Array<{ status: ClientRequestStatus; label: string; toneClass: string }> = [
  { status: 'submitted', label: 'Подана', toneClass: 'bg-amber-50' },
  { status: 'in_triage', label: 'В работе', toneClass: 'bg-blue-50' },
  { status: 'converted', label: 'Принята', toneClass: 'bg-emerald-50' },
  { status: 'rejected', label: 'Отклонена', toneClass: 'bg-gray-100' },
];

describe('ClientRequestStatusBadge', () => {
  for (const { status, label, toneClass } of CASES) {
    it(`${status} → «${label}» с тоном ${toneClass}`, () => {
      const html = renderToString(React.createElement(ClientRequestStatusBadge, { status }));
      expect(html).toContain(label);
      expect(html).toContain(toneClass);
    });
  }

  it('подписи всех четырёх статусов различны (никакие два статуса не сливаются)', () => {
    const labels = CASES.map((c) => clientRequestStatusBadgeLabel(c.status));
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(['Подана', 'В работе', 'Принята', 'Отклонена']);
  });
});
