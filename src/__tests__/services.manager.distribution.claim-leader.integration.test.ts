import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { claimOrder } from '@/lib/services/manager/distribution';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Integration (живой Postgres) — leader bypass в claimOrder (A2 fix).
 *
 * Сценарий фичи: teamMode ВЫКЛЮЧЕН (managerTeamVisibility=false — дефолт),
 * лидер разбирает незакреплённые заказы своей компании через /leader/orders/[id].
 * Деталка открывается через isLeaderSameCompany-bypass в getOrder, значит и
 * claimOrder обязан принимать ту же границу: лидер забирает заказ вне своих
 * managedOrgIds, обычный менеджер в той же точке получает forbidden, а C8-граница
 * (чужая компания) остаётся непробиваемой и для лидера.
 *
 * STAMP — только для уникальности имён/email фикстур; ассерты — на
 * детерминированных id/managerId/error-кодах.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string; // teamMode=false company of the leader + manager
let foreignCompanyId: string; // C8 boundary probe
let organizationId: string;
let foreignOrganizationId: string;
let leaderId: string; // real User row — claim writes an AuditLog FK'd to User
let managerId: string;
let orderId: string; // unassigned order in companyId, org NOT managed by anyone
let foreignOrderId: string; // unassigned order in foreignCompanyId

function session(sub: string, opts: { leader?: boolean } = {}): SessionPayload {
  // managedOrgIds ПУСТ намеренно: заказ вне персонального scope, весь доступ
  // держится (или не держится) на managerRole='leader' + companyId.
  return {
    sub,
    role: 'manager',
    companyId,
    managedOrgIds: [],
    ...(opts.leader ? { managerRole: 'leader' } : {})
  } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({
    data: { name: `claimLeaderCo-${STAMP}`, managerTeamVisibility: false }
  });
  companyId = company.id;

  const foreignCompany = await prisma.company.create({
    data: { name: `claimLeaderForeignCo-${STAMP}`, managerTeamVisibility: false }
  });
  foreignCompanyId = foreignCompany.id;

  const org = await prisma.organization.create({
    data: { name: `claimLeaderOrg-${STAMP}`, companyId }
  });
  organizationId = org.id;

  const foreignOrg = await prisma.organization.create({
    data: { name: `claimLeaderForeignOrg-${STAMP}`, companyId: foreignCompanyId }
  });
  foreignOrganizationId = foreignOrg.id;

  const leader = await prisma.user.create({
    data: {
      email: `claim-leader-${STAMP}@example.test`,
      name: `Claim Leader ${STAMP}`,
      role: 'manager',
      companyId
    }
  });
  leaderId = leader.id;

  const manager = await prisma.user.create({
    data: {
      email: `claim-mgr-${STAMP}@example.test`,
      name: `Claim Manager ${STAMP}`,
      role: 'manager',
      companyId
    }
  });
  managerId = manager.id;

  const order = await prisma.order.create({
    data: {
      title: 'Claim leader-bypass order',
      companyId,
      organizationId,
      totalAmount: new Prisma.Decimal('10000.00'),
      serviceType: 'document_development'
    }
  });
  orderId = order.id;

  const foreignOrder = await prisma.order.create({
    data: {
      title: 'Claim foreign-company order',
      companyId: foreignCompanyId,
      organizationId: foreignOrganizationId,
      totalAmount: new Prisma.Decimal('10000.00'),
      serviceType: 'document_development'
    }
  });
  foreignOrderId = foreignOrder.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [leaderId, managerId] } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderId, foreignOrderId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderId, managerId] } } });
  await prisma.organization.deleteMany({
    where: { id: { in: [organizationId, foreignOrganizationId] } }
  });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

describe('claimOrder — leader bypass (teamMode=false, live Postgres)', () => {
  it('(1) обычный менеджер вне scope НЕ забирает заказ своей компании → forbidden, managerId не тронут', async () => {
    const r = await claimOrder(prisma, session(managerId), { orderId });
    expect(r).toEqual({ ok: false, error: 'forbidden' });

    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { managerId: true } });
    expect(row?.managerId).toBeNull();
  });

  it('(2) лидер на заказ ДРУГОЙ компании → forbidden (bypass ограничен C8-границей)', async () => {
    const r = await claimOrder(prisma, session(leaderId, { leader: true }), {
      orderId: foreignOrderId
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });

    const row = await prisma.order.findUnique({
      where: { id: foreignOrderId },
      select: { managerId: true }
    });
    expect(row?.managerId).toBeNull();
  });

  it('(3) лидер забирает незакреплённый заказ СВОЕЙ компании вне managedOrgIds → ok + audit', async () => {
    const r = await claimOrder(prisma, session(leaderId, { leader: true }), { orderId });
    expect(r).toEqual({ ok: true, changed: true });

    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { managerId: true } });
    expect(row?.managerId).toBe(leaderId);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'order', entityId: orderId, action: 'order_self_assigned' },
      select: { userId: true }
    });
    expect(audit?.userId).toBe(leaderId);
  });
});
