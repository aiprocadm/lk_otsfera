import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expiringCertificates as orgExpiring } from '@/lib/services/organization/dashboard';
import { expiringCertificates as partnerExpiring } from '@/lib/services/partner/dashboard';
import { EXPIRING_WITHIN_DAYS } from '@/lib/services/training/certificates';

/**
 * Этап 3 PR-1 (ФТ-6.4): счётчики «Истекают удостоверения» на дашбордах —
 * границы окна (начало сегодняшнего дня … +60 дней, истёкшие не входят)
 * и скоуп-границы (организация / партнёр с scopeOrgIds).
 */

const prisma = {
  certificate: { count: vi.fn() }
} as never as import('@prisma/client').PrismaClient;

const countMock = (prisma as unknown as { certificate: { count: ReturnType<typeof vi.fn> } }).certificate.count;

const NOW = new Date('2026-07-24T15:30:00');
const START = new Date('2026-07-24T00:00:00');
const HORIZON = new Date(START.getTime() + EXPIRING_WITHIN_DAYS * 24 * 3600 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue(3);
});

describe('organization/dashboard.expiringCertificates', () => {
  it('считает по организации в окне [сегодня; +60 дней]', async () => {
    const n = await orgExpiring(prisma, 'org-1', NOW);
    expect(n).toBe(3);
    expect(countMock).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', validUntil: { gte: START, lte: HORIZON } }
    });
  });

  it('now по умолчанию — текущее время (границы Date)', async () => {
    await orgExpiring(prisma, 'org-1');
    const where = countMock.mock.calls.at(-1)![0].where;
    expect(where.validUntil.gte).toBeInstanceOf(Date);
    expect(where.validUntil.lte).toBeInstanceOf(Date);
  });
});

describe('partner/dashboard.expiringCertificates', () => {
  it('граница — организации партнёра; scopeOrgIds сужает', async () => {
    await partnerExpiring(prisma, { partnerId: 'pt-1', scopeOrgIds: ['org-9'] }, NOW);
    expect(countMock).toHaveBeenCalledWith({
      where: {
        organization: { partnerId: 'pt-1', id: { in: ['org-9'] } },
        validUntil: { gte: START, lte: HORIZON }
      }
    });
  });

  it('пустой scopeOrgIds → весь партнёр (без id-сужения); now по умолчанию', async () => {
    await partnerExpiring(prisma, { partnerId: 'pt-1', scopeOrgIds: [] });
    const where = countMock.mock.calls.at(-1)![0].where;
    expect(where.organization).toEqual({ partnerId: 'pt-1' });
    expect(where.validUntil.gte).toBeInstanceOf(Date);
  });
});
