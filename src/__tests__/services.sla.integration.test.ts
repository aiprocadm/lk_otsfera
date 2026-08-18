import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runSlaEscalation } from '@/worker/processors/sla-escalation';
import { setSlaSettings, getSlaSettings } from '@/lib/services/manager/slaSettings';
import { listIntake } from '@/lib/services/intake/list';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 7 PR-3 — SLA на живом Postgres: пороги компании (настройка + подсветка
 * Intake), полный цикл эскалации (журнал-дедуп, второй прогон пуст) и вкладки
 * внутреннего контура карточки организации.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let leader: string, m1: string;
let orgA: string;
let inboundId: string, leadId: string, dealId: string, requestId: string;

const sLeader = (): SessionPayload =>
  // managedOrgIds: карточка организации скоупится через canSeeOrganization (без teamMode).
  ({
    sub: leader,
    role: 'leader',
    companyId: companyA,
    managedOrgIds: [orgA],
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s7p3-${STAMP}` } })).id;
  leader = (
    await prisma.user.create({
      data: {
        email: `s7p3-l-${STAMP}@t.local`,
        name: 'Лидер',
        role: 'leader',
        companyId: companyA,
      },
    })
  ).id;
  m1 = (
    await prisma.user.create({
      data: { email: `s7p3-m-${STAMP}@t.local`, name: 'М1', role: 'manager', companyId: companyA },
    })
  ).id;
  orgA = (
    await prisma.organization.create({ data: { name: `s7p3-org-${STAMP}`, companyId: companyA } })
  ).id;

  // Просроченное обращение своей компании (26 часов назад).
  inboundId = (
    await prisma.inboundMessage.create({
      data: {
        channel: 'email',
        externalId: `s7p3-in-${STAMP}`,
        senderRef: `sla-${STAMP}@x.ru`,
        subject: `s7p3-subj-${STAMP}`,
        body: 'ждёт',
        companyId: companyA,
        createdAt: new Date(Date.now() - 26 * 3_600_000),
      },
    })
  ).id;

  // Внутренний контур организации для вкладок карточки.
  requestId = (
    await prisma.clientRequest.create({
      data: {
        source: 'organization_cabinet',
        submittedByUserId: m1,
        organizationId: orgA,
        companyName: `s7p3-client-${STAMP}`,
        contactName: 'Контакт',
        contactPhone: '+70000000001',
        subject: `s7p3-req-${STAMP}`,
        createdAt: new Date(),
      },
    })
  ).id;
  leadId = (
    await prisma.lead.create({
      data: {
        createdByUserId: m1,
        organizationId: orgA,
        clientCompanyName: `s7p3-lc-${STAMP}`,
        clientContactName: 'К',
        subject: `s7p3-lead-${STAMP}`,
        source: 'manual',
      },
    })
  ).id;
  dealId = (
    await prisma.deal.create({
      data: {
        companyId: companyA,
        organizationId: orgA,
        title: `s7p3-deal-${STAMP}`,
        status: 'won',
        amount: 1500,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.slaEscalation.deleteMany({ where: { sourceId: { in: [inboundId, requestId] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [leader, m1] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [leader, m1] } } });
  await prisma.deal.deleteMany({ where: { id: dealId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.clientRequest.deleteMany({ where: { id: requestId } });
  await prisma.inboundMessage.deleteMany({ where: { id: inboundId } });
  await prisma.organization.deleteMany({ where: { id: orgA } });
  await prisma.user.deleteMany({ where: { id: { in: [leader, m1] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('пороги компании', () => {
  it('setSlaSettings пишет и читает пороги; Intake подсвечивает по ним', async () => {
    const set = await setSlaSettings(prisma, leader, companyA, {
      slaResponseHours: 48,
      slaWarningHours: 2,
    });
    expect(set).toEqual({ ok: true, changed: true });
    expect(await getSlaSettings(prisma, companyA)).toEqual({
      slaResponseHours: 48,
      slaWarningHours: 2,
    });

    // 26ч ожидания при порогах 2/48 → warning (не breach).
    const list = await listIntake(prisma, sLeader(), { pageSize: 100 });
    const item = list.ok ? list.result.items.find((i) => i.id === inboundId) : null;
    expect(item?.slaLevel).toBe('warning');

    // Возвращаем дефолт 24/4 — для теста эскалации ниже.
    await setSlaSettings(prisma, leader, companyA, { slaResponseHours: 24, slaWarningHours: 4 });
  });
});

describe('SLA-эскалация', () => {
  it('полный цикл: эскалация руководителю один раз, второй прогон пуст', async () => {
    const before = await prisma.notification.count({
      where: { userId: leader, type: 'sla_escalation' },
    });

    const run1 = await runSlaEscalation(prisma, new Date());
    expect(run1.escalated).toBeGreaterThanOrEqual(1);

    const after1 = await prisma.notification.count({
      where: { userId: leader, type: 'sla_escalation' },
    });
    expect(after1).toBeGreaterThan(before);
    const journal = await prisma.slaEscalation.findUnique({
      where: { sourceType_sourceId: { sourceType: 'inbound', sourceId: inboundId } },
    });
    expect(journal).not.toBeNull();
    expect(journal!.companyId).toBe(companyA);

    const notif = await prisma.notification.findFirst({
      where: { userId: leader, type: 'sla_escalation' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif!.body).toContain(`s7p3-subj-${STAMP}`);

    // Идемпотентность: журнал не даёт повторов.
    await runSlaEscalation(prisma, new Date());
    expect(
      await prisma.notification.count({ where: { userId: leader, type: 'sla_escalation' } })
    ).toBe(after1);
  });
});

describe('карточка организации — внутренний контур', () => {
  it('возвращает заявки клиентов / лиды / сделки организации', async () => {
    const card = await getOrganizationCard(prisma, sLeader(), orgA);
    expect(card).not.toBeNull();
    expect(card!.clientRequests.map((r) => r.subject)).toContain(`s7p3-req-${STAMP}`);
    expect(card!.leads.map((l) => l.subject)).toContain(`s7p3-lead-${STAMP}`);
    const deal = card!.deals.find((d) => d.title === `s7p3-deal-${STAMP}`);
    expect(deal).toMatchObject({ status: 'won', amount: '1500.00' });
  });
});
