import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { moveFunnelLead } from '@/lib/services/funnel/board';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * E2E — путь лида по воронке продаж: создан («new») → in_review → qualified →
 * повышение до заказа («promoted_to_order»). Один лид проходит весь journey через
 * РЕАЛЬНЫЕ сервисы (`createLead` + `moveFunnelLead`, который диспетчит поверх
 * lead-lifecycle). Расширяет services.funnel.board.integration.test.ts в единый
 * сквозной сценарий: легальные переходы проходят, пропуск стадии (new→qualified)
 * отклоняется реальным кодом ошибки, а повышение СОЗДАЁТ Order и линкует его
 * (`lead.promotedOrderId`, Order с организацией лида и её companyId).
 *
 * Внешний фан-аут уведомлений (`notifyPartnerUsers` → email/Telegram/queue)
 * замокан — интеграционный тест не выходит в сеть; проверяем только доменный
 * результат воронки, а не побочный notify.
 */

const { notifyPartnerUsers } = vi.hoisted(() => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers }));

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string;
let partnerId: string;
let managerId: string;
let orgId: string;

// Стабильная сумма лида → детерминированный totalAmount у созданного заказа
// (Prisma.Decimal — сравниваем строкой, не JS-числом).
const ESTIMATED = '150000.50';

// Менеджерская сессия компании: leads-scope 'all' (командная очередь),
// нет accessProfile-фильтра → canSeeLead пропускает.
const managerSession = (): SessionPayload =>
  ({ sub: managerId, role: 'manager', companyId, managedOrgIds: [] }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();

  companyId = (await prisma.company.create({ data: { name: `funnelE2E-co-${STAMP}` } })).id;
  partnerId = (
    await prisma.partner.create({
      data: { name: `funnelE2E-p-${STAMP}`, slug: `funnelE2E-p-${STAMP}` },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: {
        email: `funnelE2E-m-${STAMP}@t.local`,
        name: 'Менеджер E2E',
        role: 'manager',
        companyId,
      },
    })
  ).id;
  // Организация принадлежит и партнёру (для createLead org-scope), и компании
  // (promoteLead читает companyId организации для нового Order).
  orgId = (
    await prisma.organization.create({
      data: { name: `funnelE2E-org-${STAMP}`, companyId, partnerId },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId: managerId } }).catch(() => {});
  await prisma.order.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: managerId } }).catch(() => {});
  await prisma.partner.deleteMany({ where: { id: partnerId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: companyId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('E2E funnel promotion — один лид через весь journey', () => {
  it('lead → in_review → qualified → promoted (создаёт и линкует Order)', async () => {
    // 1) СОЗДАНИЕ через реальный сервис. Стартовый статус контрактно = 'new'.
    // Этап 10: партнёрский сервис лидов удалён (клиент лидов не видит) —
    // фикстуру заводим напрямую, контракт стартового состояния тот же.
    const created = await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: managerId,
        organizationId: orgId,
        clientCompanyName: `funnelE2E-client-${STAMP}`,
        clientContactName: 'Контактное лицо',
        subject: 'Заявка на обучение по ОТ',
        estimatedAmount: new Prisma.Decimal(ESTIMATED),
      },
    });
    const leadId = created.id;
    expect(created.status).toBe('new');
    expect(created.organizationId).toBe(orgId);
    expect(created.promotedOrderId).toBeNull();

    // 2) НЕЛЕГАЛЬНЫЙ пропуск стадии: new → qualified должен быть отклонён реальным
    //    кодом ошибки lifecycle-слоя, а статус лида — не измениться.
    const illegal = await moveFunnelLead(prisma, managerSession(), {
      leadId,
      toStageId: 'default:qualified',
    });
    expect(illegal).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { status: true } }))
        .status
    ).toBe('new');

    // 3) ЛЕГАЛЬНО: new → in_review (диспетчер → setLeadStatus).
    const toReview = await moveFunnelLead(prisma, managerSession(), {
      leadId,
      toStageId: 'default:in_review',
    });
    expect(toReview).toEqual({ ok: true });
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { status: true } }))
        .status
    ).toBe('in_review');

    // 4) ЛЕГАЛЬНО: in_review → qualified.
    const toQualified = await moveFunnelLead(prisma, managerSession(), {
      leadId,
      toStageId: 'default:qualified',
    });
    expect(toQualified).toEqual({ ok: true });
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { status: true } }))
        .status
    ).toBe('qualified');

    // 5) ПОВЫШЕНИЕ: qualified → promoted_to_order (диспетчер → promoteLead).
    //    Создаётся локальный Order и линкуется к лиду.
    const promote = await moveFunnelLead(prisma, managerSession(), {
      leadId,
      toStageId: 'default:promoted_to_order',
    });
    expect(promote).toEqual({ ok: true });

    const promoted = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { status: true, promotedOrderId: true, organizationId: true },
    });
    expect(promoted.status).toBe('promoted_to_order');
    expect(promoted.promotedOrderId).not.toBeNull();

    // Order реально существует и связан с организацией/компанией лида, менеджером
    // сессии и с суммой из estimatedAmount (Decimal — сравнение строкой).
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: promoted.promotedOrderId! },
      select: {
        id: true,
        organizationId: true,
        companyId: true,
        partnerId: true,
        managerId: true,
        title: true,
        totalAmount: true,
        executionStatus: true,
        financialStatus: true,
      },
    });
    expect(order.organizationId).toBe(orgId);
    expect(order.companyId).toBe(companyId);
    expect(order.partnerId).toBe(partnerId);
    expect(order.managerId).toBe(managerId);
    expect(order.title).toBe('Заявка на обучение по ОТ');
    expect(order.executionStatus).toBe('pending');
    expect(order.financialStatus).toBe('not_billed');
    expect(order.totalAmount).toBeInstanceOf(Prisma.Decimal);
    expect(order.totalAmount.toFixed(2)).toBe('150000.50');
  });
});
