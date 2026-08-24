import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrgRateHistory } from '@/lib/services/commission/rateHistory';

/**
 * `У-99` даёт руководителю право вести ставку комиссии по организации. Новое
 * право — новая дыра, если забыть про границу компании (C8): руководитель
 * одной компании не должен видеть ни ставку, ни её историю у организации
 * другой.
 *
 * Проба на живом Postgres: две компании, у каждой своя организация с историей
 * ставок. Свою историю руководитель получает, чужую — нет, и отказ приходит
 * ДО чтения истории.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

let ownCompanyId = '';
let foreignCompanyId = '';
let ownOrgId = '';
let foreignOrgId = '';
let actorId = '';

const leader = (companyId: string | null): SessionPayload =>
  ({ sub: 'leader-idor', role: 'leader', companyId }) as SessionPayload;

beforeAll(async () => {
  const actor = await prisma.user.create({
    data: {
      email: `idor-rate-${STAMP}@test.local`,
      passwordHash: 'h',
      name: 'Актор',
      role: 'admin',
    },
  });
  actorId = actor.id;

  const own = await prisma.company.create({ data: { name: `Своя ${STAMP}` } });
  const foreign = await prisma.company.create({ data: { name: `Чужая ${STAMP}` } });
  ownCompanyId = own.id;
  foreignCompanyId = foreign.id;

  const ownOrg = await prisma.organization.create({
    data: { name: `Своя орг ${STAMP}`, companyId: ownCompanyId },
  });
  const foreignOrg = await prisma.organization.create({
    data: { name: `Чужая орг ${STAMP}`, companyId: foreignCompanyId },
  });
  ownOrgId = ownOrg.id;
  foreignOrgId = foreignOrg.id;

  for (const organizationId of [ownOrgId, foreignOrgId]) {
    await prisma.organizationCommissionRateChange.create({
      data: {
        organizationId,
        oldRate: null,
        newRate: new Prisma.Decimal('0.10'),
        changedById: actorId,
      },
    });
  }
});

afterAll(async () => {
  await prisma.organizationCommissionRateChange.deleteMany({
    where: { organizationId: { in: [ownOrgId, foreignOrgId] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [ownOrgId, foreignOrgId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [ownCompanyId, foreignCompanyId] } } });
  await prisma.user.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe('У-99: история ставки организации — граница компании руководителя (C8)', () => {
  it('свою организацию руководитель видит', async () => {
    const res = await listOrgRateHistory(prisma, leader(ownCompanyId), ownOrgId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
  });

  it('чужую организацию — нет', async () => {
    expect(await listOrgRateHistory(prisma, leader(ownCompanyId), foreignOrgId)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('руководитель без компании не видит ничего', async () => {
    expect(await listOrgRateHistory(prisma, leader(null), ownOrgId)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('администратор видит обе — Model A, он работает через своё зеркало', async () => {
    const admin = { sub: actorId, role: 'admin', companyId: null } as SessionPayload;
    expect((await listOrgRateHistory(prisma, admin, ownOrgId)).ok).toBe(true);
    expect((await listOrgRateHistory(prisma, admin, foreignOrgId)).ok).toBe(true);
  });
});
