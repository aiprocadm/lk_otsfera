import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 3 PR-1: расширение listCertificates под клиентские реестры —
 * SQL-границы статусов, поиск по ФИО, сужение organizationId, пагинация,
 * total и фикс скоупа partner-manager (assignedOrgIds).
 */

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess, recordPiiAccessMany: vi.fn() }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { managedOrgIds, getCompanyTeamVisibility } = vi.hoisted(() => ({
  managedOrgIds: vi.fn(),
  getCompanyTeamVisibility: vi.fn()
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ managedOrgIds, getCompanyTeamVisibility }));

import { listCertificates, EXPIRING_WITHIN_DAYS } from '@/lib/services/training/certificates';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = {
  certificate: { findMany: vi.fn(), count: vi.fn() },
  organization: { findMany: vi.fn() }
} as never as import('@prisma/client').PrismaClient;

const mocked = prisma as unknown as {
  certificate: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  organization: { findMany: ReturnType<typeof vi.fn> };
};

const admin = { sub: 'a', role: 'admin' } as SessionPayload;
const orgSession = {
  sub: 'o',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org1', roleInOrg: 'admin', isActive: true }]
} as never as SessionPayload;

// Фиксированное «сегодня» для детерминированных границ.
const NOW = new Date('2026-07-24T15:30:00');
const START = new Date('2026-07-24T00:00:00');
const HORIZON = new Date(START.getTime() + EXPIRING_WITHIN_DAYS * 24 * 3600 * 1000);

function lastWhere() {
  return mocked.certificate.findMany.mock.calls.at(-1)![0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.certificate.findMany.mockResolvedValue([]);
  mocked.certificate.count.mockResolvedValue(0);
});

describe('listCertificates — статусы (SQL-границы от начала дня)', () => {
  it('expired → validUntil < начала сегодняшнего дня', async () => {
    await listCertificates(prisma, admin, { status: 'expired', now: NOW });
    expect(lastWhere().validUntil).toEqual({ not: null, lt: START });
  });

  it('expiring → validUntil в [сегодня; +60 дней]', async () => {
    await listCertificates(prisma, admin, { status: 'expiring', now: NOW });
    expect(lastWhere().validUntil).toEqual({ gte: START, lte: HORIZON });
  });

  it('active → бессрочные ИЛИ validUntil за горизонтом', async () => {
    await listCertificates(prisma, admin, { status: 'active', now: NOW });
    expect(lastWhere().OR).toEqual([{ validUntil: null }, { validUntil: { gt: HORIZON } }]);
  });

  it('legacy expiringWithinDays имеет приоритет над status (обратная совместимость)', async () => {
    await listCertificates(prisma, admin, { expiringWithinDays: 30, status: 'expired', now: NOW });
    const w = lastWhere();
    expect(w.validUntil.not).toBeNull();
    expect(w.validUntil.lte).toBeInstanceOf(Date);
    expect(w.validUntil.lt).toBeUndefined();
  });
});

describe('listCertificates — organizationId и скоуп', () => {
  it('admin (scope null) + organizationId → равенство без in', async () => {
    await listCertificates(prisma, admin, { organizationId: 'orgX' });
    expect(lastWhere().organizationId).toBe('orgX');
  });

  it('организация: свой organizationId → in [org1]; чужой → in [] (пустая выдача)', async () => {
    await listCertificates(prisma, orgSession, { organizationId: 'org1' });
    expect(lastWhere().organizationId).toEqual({ in: ['org1'] });

    await listCertificates(prisma, orgSession, { organizationId: 'foreign' });
    expect(lastWhere().organizationId).toEqual({ in: [] });
  });

  it('partner-manager видит только пересечение организаций партнёра с assignedOrgIds', async () => {
    mocked.organization.findMany.mockResolvedValue([{ id: 'orgA' }, { id: 'orgB' }, { id: 'orgC' }]);
    const pm = {
      sub: 'p',
      role: 'partner',
      partnerId: 'pt1',
      partnerRole: 'manager',
      assignedOrgIds: ['orgB', 'orgZ']
    } as never as SessionPayload;
    await listCertificates(prisma, pm, {});
    expect(lastWhere().organizationId).toEqual({ in: ['orgB'] });
  });

  it('partner-admin видит все организации партнёра (без сужения)', async () => {
    mocked.organization.findMany.mockResolvedValue([{ id: 'orgA' }, { id: 'orgB' }]);
    const pa = { sub: 'p', role: 'partner', partnerId: 'pt1', partnerRole: 'admin' } as never as SessionPayload;
    await listCertificates(prisma, pa, {});
    expect(lastWhere().organizationId).toEqual({ in: ['orgA', 'orgB'] });
  });

  it('partner-manager без assignedOrgIds → пустой скоуп (?? [] ветка)', async () => {
    mocked.organization.findMany.mockResolvedValue([{ id: 'orgA' }]);
    const pm = { sub: 'p', role: 'partner', partnerId: 'pt1', partnerRole: 'manager' } as never as SessionPayload;
    await listCertificates(prisma, pm, {});
    expect(lastWhere().organizationId).toEqual({ in: [] });
  });
});

describe('listCertificates — фильтры, поиск, пагинация, total', () => {
  it('directionId и search (trim, insensitive) попадают в where', async () => {
    await listCertificates(prisma, admin, { directionId: 'd1', search: '  Иванов  ' });
    const w = lastWhere();
    expect(w.directionId).toBe('d1');
    expect(w.student).toEqual({ name: { contains: 'Иванов', mode: 'insensitive' } });
  });

  it('пустой/пробельный search игнорируется', async () => {
    await listCertificates(prisma, admin, { search: '   ' });
    expect(lastWhere().student).toBeUndefined();
  });

  it('без take запрос не пагинируется (обратная совместимость карточки слушателя)', async () => {
    await listCertificates(prisma, admin, { studentId: 's1' });
    const arg = mocked.certificate.findMany.mock.calls.at(-1)![0];
    expect(arg.take).toBeUndefined();
    expect(arg.skip).toBeUndefined();
    expect(lastWhere().studentId).toBe('s1');
  });

  it('take клампится к 200, отрицательный skip → 0; total из count по тому же where', async () => {
    mocked.certificate.findMany.mockResolvedValue([{ id: 'c1', studentId: 's1' }]);
    mocked.certificate.count.mockResolvedValue(42);
    const res = await listCertificates(prisma, admin, { take: 9999, skip: -5 });
    const arg = mocked.certificate.findMany.mock.calls.at(-1)![0];
    expect(arg.take).toBe(200);
    expect(arg.skip).toBe(0);
    if (!res.ok) throw new Error('expected ok');
    expect(res.total).toBe(42);
    expect(mocked.certificate.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('take < 1 клампится к 1; обычные take/skip проходят как есть', async () => {
    await listCertificates(prisma, admin, { take: 0, skip: 50 });
    const arg = mocked.certificate.findMany.mock.calls.at(-1)![0];
    expect(arg.take).toBe(1);
    expect(arg.skip).toBe(50);
  });

  it('PII-журнал получает studentId выданной страницы', async () => {
    mocked.certificate.findMany.mockResolvedValue([
      { id: 'c1', studentId: 's1' },
      { id: 'c2', studentId: 's2' }
    ]);
    await listCertificates(prisma, admin, { take: 2 });
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ context: 'certificates_list', subjectIds: ['s1', 's2'] })
    );
  });

  it('status без now берёт текущее время (ветка args.now ?? new Date())', async () => {
    await listCertificates(prisma, admin, { status: 'expired' });
    expect(lastWhere().validUntil.lt).toBeInstanceOf(Date);
  });
});
