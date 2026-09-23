import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expiringCertificates as orgExpiring } from '@/lib/services/organization/dashboard';
import { expiringCertificates as partnerExpiring } from '@/lib/services/partner/dashboard';
import { certificateStatus, EXPIRING_WITHIN_DAYS } from '@/lib/services/training/certificates';

/**
 * Этап 3 PR-1 (ФТ-6.4): счётчики «Истекают удостоверения» на дашбордах —
 * границы окна (начало сегодняшнего дня … +60 дней, истёкшие не входят)
 * и скоуп-границы (организация / партнёр с scopeOrgIds).
 */

const prisma = {
  certificate: { count: vi.fn() },
} as never as import('@prisma/client').PrismaClient;

const countMock = (prisma as unknown as { certificate: { count: ReturnType<typeof vi.fn> } })
  .certificate.count;

// Зона явная: границы суток считаются по Москве (`Д-22`, хотфикс №21), и без
// суффикса тест читал бы даты в зоне машины.
const NOW = new Date('2026-07-24T15:30:00+03:00');
const START = new Date('2026-07-24T00:00:00+03:00');
// Прогон сопровождения №36 (`Р-М-3`): окно — московские дни с сегодняшнего по
// 60-й включительно (24.07 + 60 = 22.09), верх через `lt` — 00:00 МСК 23.09.
// Прежнее ожидание `lte: START + 60 суток` закрепляло дефект: срок «22.09»
// хранится полуночью UTC (03:00 МСК), и счётчик на главной терял 60-й день,
// хотя по спеке этапа 3 §4 он ещё «истекает».
const HORIZON = new Date('2026-09-23T00:00:00+03:00');

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue(3);
});

describe('organization/dashboard.expiringCertificates', () => {
  it('считает по организации в окне [сегодня; +60 дней]', async () => {
    const n = await orgExpiring(prisma, 'org-1', NOW);
    expect(n).toBe(3);
    expect(countMock).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', validUntil: { gte: START, lt: HORIZON } },
    });
  });

  it('now по умолчанию — текущее время (границы Date)', async () => {
    await orgExpiring(prisma, 'org-1');
    const where = countMock.mock.calls.at(-1)![0].where;
    expect(where.validUntil.gte).toBeInstanceOf(Date);
    expect(where.validUntil.lt).toBeInstanceOf(Date);
  });

  it('счётчик и значок реестра согласны на краях окна (прогон №36)', async () => {
    // Срок пишется из `<input type="date">`: `new Date('ГГГГ-ММ-ДД')` — полночь UTC.
    await orgExpiring(prisma, 'org-1', NOW);
    const { gte, lt } = countMock.mock.calls.at(-1)![0].where.validUntil;
    const inWindow = (v: Date) => v >= gte && v < lt;
    expect(EXPIRING_WITHIN_DAYS).toBe(60);
    for (const [ymd, status] of [
      ['2026-07-23', 'expired'],
      ['2026-07-24', 'expiring'],
      ['2026-09-22', 'expiring'],
      ['2026-09-23', 'active'],
    ] as const) {
      const v = new Date(ymd);
      expect(certificateStatus(v, NOW)).toBe(status);
      expect(inWindow(v)).toBe(status === 'expiring');
    }
  });
});

describe('partner/dashboard.expiringCertificates', () => {
  it('граница — организации партнёра; scopeOrgIds сужает', async () => {
    await partnerExpiring(prisma, { partnerId: 'pt-1', scopeOrgIds: ['org-9'] }, NOW);
    expect(countMock).toHaveBeenCalledWith({
      where: {
        organization: { partnerId: 'pt-1', id: { in: ['org-9'] } },
        validUntil: { gte: START, lt: HORIZON },
      },
    });
  });

  it('пустой scopeOrgIds → весь партнёр (без id-сужения); now по умолчанию', async () => {
    await partnerExpiring(prisma, { partnerId: 'pt-1', scopeOrgIds: [] });
    const where = countMock.mock.calls.at(-1)![0].where;
    expect(where.organization).toEqual({ partnerId: 'pt-1' });
    expect(where.validUntil.gte).toBeInstanceOf(Date);
  });
});
