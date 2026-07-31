import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// S3 не нужен: тесты без вложения (вложение покрыто unit-слоем).
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: vi.fn() }) }));

import { submitCabinetQuestion } from '@/lib/services/inbound/cabinetQuestion';
import { listInbox } from '@/lib/services/inbound/listInbox';
import { listIntake } from '@/lib/services/intake/list';

/**
 * Этап 9 PR-1 (ФТ-11.1) — вопрос из кабинета на живом Postgres: попадает в
 * `/manager/inbox` и во «Входящие в работу», привязан к отправителю,
 * повторные вопросы не схлопываются дедупом.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string,
  orgA: string,
  orgUser: string,
  manager: string,
  partnerUser: string,
  partnerA: string;
const createdIds: string[] = [];

const sOrg = (): SessionPayload =>
  ({
    sub: orgUser,
    role: 'organization',
    email: `org-${STAMP}@t.local`,
    name: 'Клиент Иванов',
    organizationId: orgA,
    organizationMemberships: [{ organizationId: orgA, roleInOrg: 'admin', isActive: true }],
  }) as unknown as SessionPayload;
const sPartner = (): SessionPayload =>
  ({
    sub: partnerUser,
    role: 'partner',
    email: `pt-${STAMP}@t.local`,
    name: 'Партнёр',
    partnerId: partnerA,
  }) as unknown as SessionPayload;
const sManager = (): SessionPayload =>
  ({
    sub: manager,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [orgA],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s9p1-${STAMP}` } })).id;
  orgA = (
    await prisma.organization.create({ data: { name: `s9p1-org-${STAMP}`, companyId: companyA } })
  ).id;
  partnerA = (
    await prisma.partner.create({
      data: { name: `s9p1-pt-${STAMP}`, slug: `s9p1-${STAMP}`, commissionRate: 0.1 },
    })
  ).id;
  orgUser = (
    await prisma.user.create({
      data: { email: `s9p1-o-${STAMP}@t.local`, name: 'О', role: 'organization' },
    })
  ).id;
  partnerUser = (
    await prisma.user.create({
      data: { email: `s9p1-p-${STAMP}@t.local`, name: 'П', role: 'partner' },
    })
  ).id;
  manager = (
    await prisma.user.create({
      data: { email: `s9p1-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId: companyA },
    })
  ).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [orgUser, partnerUser, manager] } } });
  await prisma.inboundMessage.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.syncLog
    .deleteMany({ where: { entity: 'inbound', externalId: { startsWith: 'cabinet:' } } })
    .catch(() => undefined);
  await prisma.organization.deleteMany({ where: { id: orgA } });
  await prisma.partner.deleteMany({ where: { id: partnerA } });
  await prisma.user.deleteMany({ where: { id: { in: [orgUser, partnerUser, manager] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('вопрос из кабинета', () => {
  it('организация: строка unresolved с привязкой к отправителю; видна в inbox и Intake', async () => {
    const res = await submitCabinetQuestion(prisma, sOrg(), {
      subject: `s9p1-тема-${STAMP}`,
      body: 'Не открывается документ',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.id);
    expect(res.code).toMatch(/^ОБР-[0-9A-Z]{6}$/);

    const row = await prisma.inboundMessage.findUnique({ where: { id: res.id } });
    expect(row).toMatchObject({
      channel: 'cabinet',
      status: 'unresolved',
      resolvedUserId: orgUser,
      resolvedOrgId: orgA,
      companyId: companyA,
      scanStatus: 'none',
    });

    const inbox = await listInbox(prisma, sManager(), { channel: 'cabinet' });
    expect(inbox.items.map((i) => i.id)).toContain(res.id);

    const intake = await listIntake(prisma, sManager(), { pageSize: 100 });
    expect(intake.ok && intake.result.items.map((i) => i.id)).toContain(res.id);
    const item = intake.ok ? intake.result.items.find((i) => i.id === res.id) : null;
    expect(item?.essence).toContain('вопрос из кабинета');
  });

  it('партнёр: без организации — общая очередь, тоже виден staff', async () => {
    const res = await submitCabinetQuestion(prisma, sPartner(), {
      subject: `s9p1-pt-${STAMP}`,
      body: 'Вопрос партнёра',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdIds.push(res.id);

    const row = await prisma.inboundMessage.findUnique({ where: { id: res.id } });
    expect(row).toMatchObject({
      resolvedUserId: partnerUser,
      resolvedOrgId: null,
      companyId: null,
      status: 'unresolved',
    });

    const intake = await listIntake(prisma, sManager(), { pageSize: 100 });
    expect(intake.ok && intake.result.items.map((i) => i.id)).toContain(res.id);
  });

  it('повторные вопросы не схлопываются дедупом (разные externalId)', async () => {
    const a = await submitCabinetQuestion(prisma, sOrg(), { subject: 'Повтор', body: 'Первый' });
    const b = await submitCabinetQuestion(prisma, sOrg(), { subject: 'Повтор', body: 'Второй' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok) createdIds.push(a.id);
    if (b.ok) createdIds.push(b.id);
    expect(a.ok && b.ok && a.id !== b.id).toBe(true);
  });
});
