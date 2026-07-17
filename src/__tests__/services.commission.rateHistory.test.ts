import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listRateHistory, listOrgRateHistory } from '@/lib/services/commission/rateHistory';

let prisma: PrismaClient;
let partnerId: string;
let actorUserId: string;

function makeSession(role: SessionPayload['role']): SessionPayload {
  return { sub: 'session-sub', role } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({
    data: { name: 'RateHistoryTestPartner-' + Date.now(), commissionRate: 0.05 }
  });
  partnerId = partner.id;

  const actor = await prisma.user.create({
    data: {
      email: 'rate-history-actor-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'Rate History Actor',
      role: 'admin'
    }
  });
  actorUserId = actor.id;

  // Create two history rows: initial set (oldRate null) then an update
  await prisma.commissionRateChange.create({
    data: {
      partnerId,
      oldRate: null,
      newRate: new Prisma.Decimal('0.05'),
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      changedById: actorUserId
    }
  });
  await prisma.commissionRateChange.create({
    data: {
      partnerId,
      oldRate: new Prisma.Decimal('0.05'),
      newRate: new Prisma.Decimal('0.10'),
      effectiveFrom: new Date('2026-03-01T00:00:00Z'),
      changedById: actorUserId
    }
  });
});

afterAll(async () => {
  await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { id: actorUserId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('listRateHistory()', () => {
  it('returns forbidden for non-admin session', async () => {
    const result = await listRateHistory(prisma, makeSession('manager'), partnerId);
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden for partner session', async () => {
    const result = await listRateHistory(prisma, makeSession('partner'), partnerId);
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns rows newest-first with resolved changedByName for admin session', async () => {
    const result = await listRateHistory(prisma, makeSession('admin'), partnerId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);

    // Newest first: row from 2026-03-01 comes before 2026-01-01
    expect(result.rows[0].effectiveFrom.toISOString()).toContain('2026-03');
    expect(result.rows[1].effectiveFrom.toISOString()).toContain('2026-01');

    // First row: rate change 0.05 → 0.10
    expect(result.rows[0].oldRate).toBeCloseTo(0.05);
    expect(result.rows[0].newRate).toBeCloseTo(0.10);
    expect(result.rows[0].changedByName).toBe('Rate History Actor');

    // Second row: initial set — oldRate null
    expect(result.rows[1].oldRate).toBeNull();
    expect(result.rows[1].newRate).toBeCloseTo(0.05);
    expect(result.rows[1].changedByName).toBe('Rate History Actor');
  });

  it('returns empty rows array when partner has no history', async () => {
    const emptyPartner = await prisma.partner.create({
      data: { name: 'EmptyRateHistoryPartner-' + Date.now(), commissionRate: 0 }
    });
    try {
      const result = await listRateHistory(prisma, makeSession('admin'), emptyPartner.id);
      expect(result).toEqual({ ok: true, rows: [] });
    } finally {
      await prisma.partner.deleteMany({ where: { id: emptyPartner.id } });
    }
  });

  it('resolves changedByName as null when changedById is null', async () => {
    const nullActorChange = await prisma.commissionRateChange.create({
      data: {
        partnerId,
        oldRate: new Prisma.Decimal('0.10'),
        newRate: new Prisma.Decimal('0.15'),
        effectiveFrom: new Date('2026-06-01T00:00:00Z'),
        changedById: null
      }
    });
    try {
      const result = await listRateHistory(prisma, makeSession('admin'), partnerId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const nullRow = result.rows.find((r) => r.id === nullActorChange.id);
      expect(nullRow).toBeDefined();
      expect(nullRow!.changedByName).toBeNull();
    } finally {
      await prisma.commissionRateChange.deleteMany({ where: { id: nullActorChange.id } });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G4 — listOrgRateHistory: история орг-ставки (OrganizationCommissionRateChange).
// Отличие от партнёрской истории: newRate nullable (null = «сброс к ставке
// партнёра»). Сид: установка override, затем сброс (newRate: null).
// ─────────────────────────────────────────────────────────────────────────────

describe('listOrgRateHistory() (integration)', () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: 'OrgRateHistoryTestOrg-' + Date.now() }
    });
    organizationId = org.id;

    // Установка org-override (oldRate null = ставка не была задана)
    await prisma.organizationCommissionRateChange.create({
      data: {
        organizationId,
        oldRate: null,
        newRate: new Prisma.Decimal('0.07'),
        effectiveFrom: new Date('2026-02-01T00:00:00Z'),
        changedById: actorUserId
      }
    });
    // Сброс к ставке партнёра (newRate null)
    await prisma.organizationCommissionRateChange.create({
      data: {
        organizationId,
        oldRate: new Prisma.Decimal('0.07'),
        newRate: null,
        effectiveFrom: new Date('2026-05-01T00:00:00Z'),
        changedById: actorUserId
      }
    });
  });

  afterAll(async () => {
    await prisma.organizationCommissionRateChange.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it('returns forbidden for non-admin session', async () => {
    const result = await listOrgRateHistory(prisma, makeSession('manager'), organizationId);
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns rows newest-first with null newRate for the reset event and resolved names', async () => {
    const result = await listOrgRateHistory(prisma, makeSession('admin'), organizationId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);

    // Newest first: сброс от 2026-05-01 раньше в списке, чем установка от 2026-02-01
    expect(result.rows[0].effectiveFrom.toISOString()).toContain('2026-05');
    expect(result.rows[1].effectiveFrom.toISOString()).toContain('2026-02');

    // Первая строка: сброс — newRate null, oldRate 0.07
    expect(result.rows[0].oldRate).toBeCloseTo(0.07);
    expect(result.rows[0].newRate).toBeNull();
    expect(result.rows[0].changedByName).toBe('Rate History Actor');

    // Вторая строка: установка — oldRate null, newRate 0.07
    expect(result.rows[1].oldRate).toBeNull();
    expect(result.rows[1].newRate).toBeCloseTo(0.07);
    expect(result.rows[1].changedByName).toBe('Rate History Actor');
  });

  it('returns empty rows array when organization has no history', async () => {
    const emptyOrg = await prisma.organization.create({
      data: { name: 'EmptyOrgRateHistoryOrg-' + Date.now() }
    });
    try {
      const result = await listOrgRateHistory(prisma, makeSession('admin'), emptyOrg.id);
      expect(result).toEqual({ ok: true, rows: [] });
    } finally {
      await prisma.organization.deleteMany({ where: { id: emptyOrg.id } });
    }
  });
});
