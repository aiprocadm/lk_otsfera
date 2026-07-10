import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getFunnelBoard, moveFunnelLead } from '@/lib/services/funnel/board';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G2 — контракт изоляции воронки (§4, R0.7 release hardening): воронка продаж —
 * внутренний инструмент, клиентские роли (partner/organization/student) не имеют
 * к ней доступа независимо от заполненного companyId. Middleware и page-гарды
 * режут раньше; здесь — последний рубеж service-слоя (staff-гейт board.ts),
 * зеркало services.tasks.isolation.test.ts.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let m1: string;
let partnerId: string;
let leadA: string;

const client = (role: 'partner' | 'organization' | 'student'): SessionPayload =>
  ({ sub: `${role}-1`, role, companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const staff = (): SessionPayload =>
  ({ sub: m1, role: 'manager', companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g2iso-${STAMP}` } })).id;
  m1 = (
    await prisma.user.create({
      data: { email: `g2iso-m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId: companyA }
    })
  ).id;
  partnerId = (
    await prisma.partner.create({
      data: { name: `g2iso-p-${STAMP}`, commissionRate: 0.1 }
    })
  ).id;
  leadA = (
    await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: m1,
        clientCompanyName: `g2iso-client-${STAMP}`,
        clientContactName: 'Контакт',
        subject: 'Обучение по ОТ',
        status: 'new'
      }
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: m1 } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.user.deleteMany({ where: { id: m1 } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('getFunnelBoard — клиентские роли получают пустую доску', () => {
  it.each(['partner', 'organization', 'student'] as const)(
    'роль %s (даже с companyId) → пустые stages и columns',
    async (role) => {
      const board = await getFunnelBoard(prisma, client(role));
      expect(board).toEqual({ stages: [], columns: [] });
    }
  );

  it('staff (manager) видит доску: лид лежит в стадии якоря new', async () => {
    const board = await getFunnelBoard(prisma, staff());
    expect(board.stages.length).toBeGreaterThan(0);
    const allCards = board.columns.flatMap((c) => c.cards.map((card) => card.id));
    expect(allCards).toContain(leadA);
  });
});

describe('moveFunnelLead — клиентские роли отклонены, лид не изменяется', () => {
  it.each(['partner', 'organization', 'student'] as const)(
    'перемещение от %s → forbidden',
    async (role) => {
      const board = await getFunnelBoard(prisma, staff());
      const anyStage = board.stages[0]!;
      const res = await moveFunnelLead(prisma, client(role), {
        leadId: leadA,
        toStageId: anyStage.id
      });
      expect(res).toEqual({ ok: false, error: 'forbidden' });
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: leadA },
        select: { status: true, funnelStageId: true }
      });
      expect(lead).toEqual({ status: 'new', funnelStageId: null });
    }
  );

  it('staff-путь не сломан: перестановка внутри якоря new → ok', async () => {
    const board = await getFunnelBoard(prisma, staff());
    const newStage = board.stages.find((s) => s.statusAnchor === 'new');
    expect(newStage).toBeDefined();
    const res = await moveFunnelLead(prisma, staff(), { leadId: leadA, toStageId: newStage!.id });
    expect(res).toEqual({ ok: true });
  });
});
