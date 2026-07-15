import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assignLead } from '@/lib/services/manager/leadLifecycle';

/**
 * B1 (parity) — валидация assignToUserId в assignLead.
 *
 * Контракт: при передаче лида ДРУГОМУ пользователю (assignToUserId !== managerId)
 * кандидат обязан существовать, иметь role='manager' и isActive=true — иначе
 * `{ ok:false, error:'invalid_manager' }` и лид не мутируется. Self-assign
 * (без assignToUserId) валидацию не проходит вовсе — поведение не изменилось.
 *
 * ВАЖНО: лиды — shared team queue (owner decision 2026-06-14, комментарий в
 * services/manager/leadLifecycle.ts) — company-границы у назначения НЕТ:
 * активный менеджер ЧУЖОЙ компании — валидная цель. Этот тест пришпиливает
 * оба края: и отказ невалидным кандидатам, и отсутствие company-проверки.
 *
 * Внешний фан-аут уведомлений замокан (как в e2e.funnel-promotion) — проверяем
 * доменный результат, не побочный notify.
 */

const { notifyPartnerUsers } = vi.hoisted(() => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers }));

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string;
let companyB: string;
let partnerId: string;
let orgId: string;
let actingManagerId: string;
let partnerRoleUserId: string;
let inactiveManagerId: string;
let otherCompanyManagerId: string;
const userIds: string[] = [];

async function seedLead(suffix: string): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: actingManagerId,
      organizationId: orgId,
      clientCompanyName: `assignVal-client-${suffix}-${STAMP}`,
      clientContactName: 'Контакт',
      subject: `Лид ${suffix}`
    }
  });
  return lead.id;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  companyA = (await prisma.company.create({ data: { name: `assignVal-coA-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `assignVal-coB-${STAMP}` } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `assignVal-p-${STAMP}` } })).id;
  orgId = (
    await prisma.organization.create({ data: { name: `assignVal-org-${STAMP}`, companyId: companyA, partnerId } })
  ).id;

  actingManagerId = (
    await prisma.user.create({
      data: { email: `assignVal-actor-${STAMP}@t.local`, name: 'Действующий менеджер', role: 'manager', companyId: companyA }
    })
  ).id;
  partnerRoleUserId = (
    await prisma.user.create({
      data: { email: `assignVal-partner-${STAMP}@t.local`, name: 'Партнёрский юзер', role: 'partner', partnerId }
    })
  ).id;
  inactiveManagerId = (
    await prisma.user.create({
      data: { email: `assignVal-inactive-${STAMP}@t.local`, name: 'Уволенный менеджер', role: 'manager', companyId: companyA, isActive: false }
    })
  ).id;
  otherCompanyManagerId = (
    await prisma.user.create({
      data: { email: `assignVal-otherco-${STAMP}@t.local`, name: 'Менеджер другой компании', role: 'manager', companyId: companyB }
    })
  ).id;
  userIds.push(actingManagerId, partnerRoleUserId, inactiveManagerId, otherCompanyManagerId);
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.partner.deleteMany({ where: { id: partnerId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } }).catch(() => {});
  await prisma.$disconnect();
});

/** Лид не должен мутироваться при отказе: статус new, менеджер не назначен. */
async function expectUntouched(leadId: string) {
  const after = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { status: true, assignedManagerId: true }
  });
  expect(after).toEqual({ status: 'new', assignedManagerId: null });
}

describe('B1 — assignLead отклоняет невалидного кандидата (invalid_manager)', () => {
  it('несуществующий пользователь → invalid_manager, лид не тронут', async () => {
    const leadId = await seedLead('ghost');
    const r = await assignLead(prisma, {
      leadId,
      managerId: actingManagerId,
      assignToUserId: `assignVal-no-such-user-${STAMP}`
    });
    expect(r).toEqual({ ok: false, error: 'invalid_manager' });
    await expectUntouched(leadId);
  });

  it('пользователь role=partner → invalid_manager, лид не тронут', async () => {
    const leadId = await seedLead('partner-role');
    const r = await assignLead(prisma, {
      leadId,
      managerId: actingManagerId,
      assignToUserId: partnerRoleUserId
    });
    expect(r).toEqual({ ok: false, error: 'invalid_manager' });
    await expectUntouched(leadId);
  });

  it('неактивный менеджер (isActive=false) → invalid_manager, лид не тронут', async () => {
    const leadId = await seedLead('inactive');
    const r = await assignLead(prisma, {
      leadId,
      managerId: actingManagerId,
      assignToUserId: inactiveManagerId
    });
    expect(r).toEqual({ ok: false, error: 'invalid_manager' });
    await expectUntouched(leadId);
  });
});

describe('B1 — валидные назначения проходят (shared queue, поведение не сломано)', () => {
  it('активный менеджер ДРУГОЙ компании → ok (лиды — shared queue, company-границы нет)', async () => {
    const leadId = await seedLead('other-co');
    const r = await assignLead(prisma, {
      leadId,
      managerId: actingManagerId,
      assignToUserId: otherCompanyManagerId
    });
    expect(r.ok).toBe(true);
    const after = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { status: true, assignedManagerId: true }
    });
    expect(after.assignedManagerId).toBe(otherCompanyManagerId);
    expect(after.status).toBe('in_review'); // new → in_review при claim
  });

  it('self-assign без assignToUserId → ok, авто-переход new → in_review (без изменений)', async () => {
    const leadId = await seedLead('self');
    const r = await assignLead(prisma, { leadId, managerId: actingManagerId });
    expect(r.ok).toBe(true);
    const after = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { status: true, assignedManagerId: true }
    });
    expect(after.assignedManagerId).toBe(actingManagerId);
    expect(after.status).toBe('in_review');
  });
});
