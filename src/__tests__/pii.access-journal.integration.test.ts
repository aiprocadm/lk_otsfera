/**
 * §25.7 integration: журнал против реальной схемы (GIN, createMany, снапшоты).
 * Флаг включается явно — vitest.setup глушит его для остальных тестов.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recordPiiAccess, recordPiiAccessMany } from '@/lib/pii/record';
import { listPiiAccess } from '@/lib/services/admin/piiAccess';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();

const RUN = `pii-int-${process.pid}`;
let actorId: string;

const session = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  sub: actorId,
  role: 'manager',
  companyId: null,
  ...over,
});

beforeAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '1';
  const actor = await prisma.user.create({
    data: {
      email: `${RUN}-actor@test.local`,
      name: `${RUN} actor`,
      role: 'manager',
      passwordHash: 'x',
    },
  });
  actorId = actor.id;
});

beforeEach(async () => {
  await prisma.piiAccessEvent.deleteMany({ where: { userId: actorId } });
});

afterAll(async () => {
  process.env.FEATURE_PII_ACCESS_LOG = '0';
  await prisma.piiAccessEvent.deleteMany({ where: { userId: actorId } });
  await prisma.user.delete({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe('PII access journal (integration)', () => {
  it('GIN-поиск: subjectIds has находит событие по субъекту', async () => {
    await recordPiiAccess(prisma, {
      session: session(),
      context: 'manager_students_list',
      subjectIds: [`${RUN}-s1`, `${RUN}-s2`],
    });
    const hit = await prisma.piiAccessEvent.findMany({
      where: { subjectIds: { has: `${RUN}-s2` }, userId: actorId },
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].subjectCount).toBe(2);
    expect(hit[0].action).toBe('list');
    expect(hit[0].subjectType).toBe('student');
  });

  it('createMany: два события organizationCard одним вызовом; leader-снапшот', async () => {
    await recordPiiAccessMany(prisma, [
      {
        session: session({ managerRole: 'leader' }),
        context: 'org_card_inbound',
        subjectIds: [`${RUN}-m1`],
      },
      {
        session: session({ managerRole: 'leader' }),
        context: 'org_card_calls',
        subjectIds: [`${RUN}-c1`],
      },
    ]);
    const rows = await prisma.piiAccessEvent.findMany({
      where: { userId: actorId },
      orderBy: { context: 'asc' },
    });
    expect(rows.map((r) => r.context)).toEqual(['org_card_calls', 'org_card_inbound']);
    expect(rows.every((r) => r.userRole === 'leader')).toBe(true);
  });

  it('listPiiAccess: фильтр по subjectId ходит через has и резолвит nextCursor', async () => {
    for (let i = 0; i < 3; i++) {
      await recordPiiAccess(prisma, {
        session: session(),
        context: 'calls_list',
        subjectIds: [`${RUN}-call-${i}`],
      });
    }
    const admin: SessionPayload = { sub: actorId, role: 'admin' };
    const page1 = await listPiiAccess(prisma, admin, { actorUserId: actorId, take: 2 });
    if (!page1.ok) throw new Error('expected ok');
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const bySubject = await listPiiAccess(prisma, admin, { subjectId: `${RUN}-call-1` });
    if (!bySubject.ok) throw new Error('expected ok');
    expect(bySubject.rows).toHaveLength(1);
  });

  it('выключенный флаг: запись не создаётся', async () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    await recordPiiAccess(prisma, {
      session: session(),
      context: 'calls_list',
      subjectIds: [`${RUN}-off`],
    });
    process.env.FEATURE_PII_ACCESS_LOG = '1';
    const rows = await prisma.piiAccessEvent.findMany({ where: { userId: actorId } });
    expect(rows).toHaveLength(0);
  });
});
