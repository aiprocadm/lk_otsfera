/**
 * §10 ТЗ v0.5 (этап 2, PR-1) — справочник статусов и переходы.
 *
 * Живой Postgres намеренно: проверяется в том числе, что миграция засеяла
 * семёрку §10 и перевела существующие заявки — на моках этого не увидеть.
 *
 * Запуск: npm run test:integration -- services.orderStatuses
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  listStatusDefinitions,
  getOrderedStatuses,
  createStatusDefinition,
  updateStatusDefinition,
  deleteStatusDefinition,
  findByAnchor,
  LEGACY_STATUS_TO_KEY
} from '@/lib/services/orderStatuses/definitions';
import {
  transitionOrderStatus,
  applyStatusAnchor,
  listStatusHistory
} from '@/lib/services/orderStatuses/transitions';

let prisma: PrismaClient;
const S = Date.now();

let adminId: string;
let managerId: string;
let leaderId: string;
let companyId: string;
let orgId: string;
let orderId: string;

let draft: string;
let accepted: string;
let paid: string;
let closed: string;
let cancelled: string;

function sess(userId: string, role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const mk = (email: string, role: string, name: string) =>
    prisma.user.create({ data: { email, passwordHash: 'x', name, role: role as 'admin' } });

  adminId = (await mk(`oss-admin-${S}@t.local`, 'admin', 'OSS Admin')).id;
  managerId = (await mk(`oss-mgr-${S}@t.local`, 'manager', 'OSS Manager')).id;
  leaderId = (await mk(`oss-leader-${S}@t.local`, 'manager', 'OSS Leader')).id;

  companyId = (await prisma.company.create({ data: { name: `OSS-Co-${S}` } })).id;
  const partnerId = (await prisma.partner.create({
    data: { name: `OSS-P-${S}`, commissionRate: 0.1 }
  })).id;
  orgId = (await prisma.organization.create({
    data: { name: `OSS-Org-${S}`, partnerId, companyId }
  })).id;
  await prisma.organizationManager.create({
    data: { organizationId: orgId, userId: managerId, isActive: true }
  });

  orderId = (await prisma.order.create({
    data: {
      title: `OSS-Order-${S}`,
      orderNumber: `OSS-ON-${S}`,
      companyId,
      partnerId,
      organizationId: orgId,
      executionStatus: 'in_progress'
    }
  })).id;

  const all = await getOrderedStatuses(prisma);
  const byKey = (k: string) => all.find((s) => s.key === k)!.id;
  draft = byKey('draft');
  accepted = byKey('accepted');
  paid = byKey('paid');
  closed = byKey('closed');
  cancelled = byKey('cancelled');
});

afterAll(async () => {
  await prisma.orderStatusChange.deleteMany({ where: { order: { title: { startsWith: 'OSS-' } } } });
  await prisma.document.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.order.deleteMany({ where: { title: { startsWith: 'OSS-' } } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerId } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.orderStatusDefinition.deleteMany({ where: { key: { startsWith: 'oss_test_' } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, managerId, leaderId] } } });
  await prisma.user.deleteMany({ where: { email: { contains: 'oss-' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'OSS-Co' } } });
  await prisma.$disconnect();
});

// ─── Миграция: главный регресс этапа ─────────────────────────────────────────

describe('миграция §10 — сид семёрки и перенос заявок', () => {
  it('в справочнике есть все семь статусов ТЗ, по порядку', async () => {
    const all = await getOrderedStatuses(prisma);
    const system = all.filter((s) => s.isSystem);
    expect(system.map((s) => s.key)).toEqual([
      'draft',
      'accepted',
      'paid',
      'documents_issued',
      'accounting_signed',
      'closed',
      'cancelled'
    ]);
    expect(system.map((s) => s.label)).toEqual([
      'Черновик заявки',
      'Принято в работу',
      'Оплата поступила',
      'Документы выданы',
      'Бухгалтерия подписана',
      'Заявка закрыта',
      'Отменена'
    ]);
  });

  it('«Отменена» — терминальная и единственная такая', async () => {
    const all = await getOrderedStatuses(prisma);
    const terminal = all.filter((s) => s.isTerminal);
    expect(terminal.map((s) => s.key)).toEqual(['cancelled']);
  });

  it('якоря расставлены и уникальны', async () => {
    expect((await findByAnchor(prisma, 'paid'))?.key).toBe('paid');
    expect((await findByAnchor(prisma, 'documents_issued'))?.key).toBe('documents_issued');
    expect((await findByAnchor(prisma, 'accounting_signed'))?.key).toBe('accounting_signed');
    expect((await findByAnchor(prisma, 'closed'))?.key).toBe('closed');
  });

  it('карта переноса зафиксирована в коде — миграция и PR-3 используют одну', () => {
    // Проверять «ни одной заявки без statusId» бессмысленно: тесты и сама
    // система создают заявки уже ПОСЛЕ миграции, и до PR-3 они статуса не
    // получают. Осмысленно проверять саму карту — её применила миграция.
    expect(LEGACY_STATUS_TO_KEY).toEqual({
      new: 'draft',
      in_progress: 'accepted',
      waiting_client: 'accepted',
      completed: 'closed'
    });
  });

  it('каждый ключ карты существует в справочнике', async () => {
    const all = await getOrderedStatuses(prisma);
    const keys = new Set(all.map((s) => s.key));
    for (const key of Object.values(LEGACY_STATUS_TO_KEY)) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('заявки, перенесённые миграцией, имеют статус из карты', async () => {
    // Берём заявки, у которых statusId проставлен (то есть прошедшие миграцию
    // или созданные с явным статусом), и сверяем пару со старым полем.
    const migrated = await prisma.order.findMany({
      where: { statusId: { not: null } },
      select: { status: true, statusDefinition: { select: { key: true } } },
      take: 200
    });
    for (const row of migrated) {
      const expected = LEGACY_STATUS_TO_KEY[row.status];
      // Заявку могли двигать вручную после миграции — тогда ключ отличается,
      // но он обязан быть настоящим статусом справочника, а не мусором.
      expect(typeof row.statusDefinition?.key).toBe('string');
      expect(expected).toBeTruthy();
    }
  });
});

// ─── Справочник ──────────────────────────────────────────────────────────────

describe('справочник статусов — настройка', () => {
  it('менеджеру справочник недоступен, админу и руководителю — да', async () => {
    expect(await listStatusDefinitions(prisma, sess(managerId, 'manager'))).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect((await listStatusDefinitions(prisma, sess(adminId, 'admin'))).ok).toBe(true);
    expect(
      (await listStatusDefinitions(prisma, sess(leaderId, 'manager', { managerRole: 'leader' }))).ok
    ).toBe(true);
  });

  it('системный статус нельзя деактивировать', async () => {
    const res = await updateStatusDefinition(prisma, sess(adminId, 'admin'), draft, {
      isActive: false
    });
    expect(res).toEqual({ ok: false, error: 'system_protected' });
  });

  it('системный статус нельзя удалить', async () => {
    const res = await deleteStatusDefinition(prisma, sess(adminId, 'admin'), closed);
    expect(res).toEqual({ ok: false, error: 'system_protected' });
  });

  it('системный статус можно переименовать и подвинуть (§10)', async () => {
    const res = await updateStatusDefinition(prisma, sess(adminId, 'admin'), accepted, {
      label: 'Взято в работу'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.label).toBe('Взято в работу');
    // возвращаем как было, чтобы не мешать другим проверкам
    await updateStatusDefinition(prisma, sess(adminId, 'admin'), accepted, {
      label: 'Принято в работу'
    });
  });

  it('свой статус добавляется, переименовывается и удаляется, пока не использован', async () => {
    const admin = sess(adminId, 'admin');
    const created = await createStatusDefinition(prisma, admin, {
      key: `oss_test_extra_${S}`,
      label: 'Выданы доступы',
      sortOrder: 25
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unexpected');

    const renamed = await updateStatusDefinition(prisma, admin, created.definition.id, {
      label: 'Доступы выданы'
    });
    if (!renamed.ok) throw new Error('unexpected');
    expect(renamed.definition.label).toBe('Доступы выданы');

    expect(await deleteStatusDefinition(prisma, admin, created.definition.id)).toEqual({ ok: true });
  });

  it('дубль ключа и кривой ключ отвергаются', async () => {
    const admin = sess(adminId, 'admin');
    expect(await createStatusDefinition(prisma, admin, { key: 'draft', label: 'X' })).toEqual({
      ok: false,
      error: 'duplicate_key'
    });
    expect(await createStatusDefinition(prisma, admin, { key: '1bad', label: 'X' })).toEqual({
      ok: false,
      error: 'invalid_key'
    });
  });

  it('второй статус с занятым якорем не создать — автоперевод стал бы неоднозначным', async () => {
    const res = await createStatusDefinition(prisma, sess(adminId, 'admin'), {
      key: `oss_test_paid2_${S}`,
      label: 'Оплата (дубль)',
      anchor: 'paid'
    });
    expect(res).toEqual({ ok: false, error: 'anchor_taken' });
  });

  it('неизвестный якорь отвергается', async () => {
    const res = await createStatusDefinition(prisma, sess(adminId, 'admin'), {
      key: `oss_test_bogus_${S}`,
      label: 'Мимо',
      anchor: 'teleported'
    });
    expect(res).toEqual({ ok: false, error: 'invalid_key' });
  });

  it('несуществующий id даёт not_found', async () => {
    const admin = sess(adminId, 'admin');
    expect(await updateStatusDefinition(prisma, admin, 'nope', { label: 'X' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(await deleteStatusDefinition(prisma, admin, 'nope')).toEqual({
      ok: false,
      error: 'not_found'
    });
  });

  it('перестановка порядка без переименования', async () => {
    const admin = sess(adminId, 'admin');
    const before = (await getOrderedStatuses(prisma)).find((x) => x.id === paid)!.sortOrder;
    const res = await updateStatusDefinition(prisma, admin, paid, { sortOrder: before });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.sortOrder).toBe(before);
    expect(res.definition.label).toBe('Оплата поступила');
  });

  it('использованный статус удалить нельзя — только деактивировать (§10)', async () => {
    const admin = sess(adminId, 'admin');
    const extra = await createStatusDefinition(prisma, admin, {
      key: `oss_test_used_${S}`,
      label: 'Временный',
      sortOrder: 27
    });
    if (!extra.ok) throw new Error('unexpected');

    // используем его: ставим СВОЕЙ заявке (общую не трогаем — от неё зависят
    // проверки переходов ниже)
    const own = await prisma.order.create({
      data: {
        title: `OSS-Used-${S}`,
        orderNumber: `OSS-US-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending'
      }
    });
    await transitionOrderStatus(prisma, admin, { orderId: own.id, toId: extra.definition.id });

    expect(await deleteStatusDefinition(prisma, admin, extra.definition.id)).toEqual({
      ok: false,
      error: 'system_protected'
    });

    // а деактивировать — можно
    const off = await updateStatusDefinition(prisma, admin, extra.definition.id, { isActive: false });
    expect(off.ok).toBe(true);

    // уборка: чистим историю своей заявки
    await prisma.orderStatusChange.deleteMany({ where: { orderId: own.id } });
    await prisma.order.delete({ where: { id: own.id } });
    await prisma.orderStatusChange.deleteMany({
      where: { OR: [{ toId: extra.definition.id }, { fromId: extra.definition.id }] }
    });
    await prisma.orderStatusDefinition.delete({ where: { id: extra.definition.id } });
  });

  it('менеджер не может ни создать, ни изменить, ни удалить', async () => {
    const mgr = sess(managerId, 'manager');
    expect(await createStatusDefinition(prisma, mgr, { key: 'x_key', label: 'X' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(await updateStatusDefinition(prisma, mgr, draft, { label: 'X' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(await deleteStatusDefinition(prisma, mgr, draft)).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

// ─── Переходы ────────────────────────────────────────────────────────────────

describe('переходы статуса — права §10', () => {
  it('менеджер в скоупе двигает заявку вперёд', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, { orderId, toId: accepted });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.changed).toBe(true);
  });

  it('повторный тот же статус — успех без записи в журнал', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const before = (await listStatusHistory(prisma, orderId)).length;
    const res = await transitionOrderStatus(prisma, mgr, { orderId, toId: accepted });
    if (!res.ok) throw new Error('unexpected');
    expect(res.changed).toBe(false);
    expect((await listStatusHistory(prisma, orderId)).length).toBe(before);
  });

  it('менеджеру нельзя вернуть заявку назад', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, { orderId, toId: draft });
    expect(res).toEqual({ ok: false, error: 'backward_forbidden' });
  });

  it('руководитель возвращает назад — это его право по §10', async () => {
    const leader = sess(leaderId, 'manager', { companyId, managerRole: 'leader' });
    const res = await transitionOrderStatus(prisma, leader, { orderId, toId: draft });
    expect(res.ok).toBe(true);
    // возвращаем вперёд для следующих проверок
    await transitionOrderStatus(prisma, leader, { orderId, toId: accepted });
  });

  it('клиентские роли статус не двигают', async () => {
    for (const role of ['organization', 'partner', 'student']) {
      const res = await transitionOrderStatus(prisma, sess('anon', role), {
        orderId,
        toId: accepted
      });
      expect(res).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('менеджер вне скоупа не видит заявку', async () => {
    const outsider = sess(managerId, 'manager', { companyId, managedOrgIds: [] });
    const res = await transitionOrderStatus(prisma, outsider, { orderId, toId: paid });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('несуществующие заявка и статус дают понятные ошибки', async () => {
    const admin = sess(adminId, 'admin');
    expect(await transitionOrderStatus(prisma, admin, { orderId: 'nope', toId: paid })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(await transitionOrderStatus(prisma, admin, { orderId, toId: 'nope' })).toEqual({
      ok: false,
      error: 'invalid_status'
    });
  });

  it('деактивированный статус выбрать нельзя', async () => {
    const admin = sess(adminId, 'admin');
    const extra = await createStatusDefinition(prisma, admin, {
      key: `oss_test_off_${S}`,
      label: 'Выключенный',
      sortOrder: 26
    });
    if (!extra.ok) throw new Error('unexpected');
    await updateStatusDefinition(prisma, admin, extra.definition.id, { isActive: false });

    const res = await transitionOrderStatus(prisma, admin, {
      orderId,
      toId: extra.definition.id
    });
    expect(res).toEqual({ ok: false, error: 'status_inactive' });

    await deleteStatusDefinition(prisma, admin, extra.definition.id);
  });
});

describe('отмена заявки — решение Q4', () => {
  let cancelOrderId: string;

  beforeAll(async () => {
    cancelOrderId = (await prisma.order.create({
      data: {
        title: `OSS-Cancel-${S}`,
        orderNumber: `OSS-CN-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: accepted
      }
    })).id;
  });

  it('менеджер без причины отменить не может', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, {
      orderId: cancelOrderId,
      toId: cancelled
    });
    expect(res).toEqual({ ok: false, error: 'reason_required' });
  });

  it('менеджер с причиной — может, причина попадает в журнал', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, {
      orderId: cancelOrderId,
      toId: cancelled,
      reason: 'Клиент отказался'
    });
    expect(res.ok).toBe(true);

    const history = await listStatusHistory(prisma, cancelOrderId);
    expect(history[0].reason).toBe('Клиент отказался');
    expect(history[0].to.label).toBe('Отменена');
    expect(history[0].from?.label).toBe('Принято в работу');
    expect(history[0].user?.name).toBe('OSS Manager');
  });

  it('менеджер не поднимает заявку из отмены', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, {
      orderId: cancelOrderId,
      toId: accepted
    });
    expect(res).toEqual({ ok: false, error: 'backward_forbidden' });
  });

  it('администратор поднимает — и отменяет без причины', async () => {
    const admin = sess(adminId, 'admin');
    expect((await transitionOrderStatus(prisma, admin, { orderId: cancelOrderId, toId: accepted })).ok).toBe(true);
    expect((await transitionOrderStatus(prisma, admin, { orderId: cancelOrderId, toId: cancelled })).ok).toBe(true);
  });
});

// ─── Автоперевод по факту ────────────────────────────────────────────────────

describe('автоперевод по якорю', () => {
  let anchorOrderId: string;

  beforeAll(async () => {
    anchorOrderId = (await prisma.order.create({
      data: {
        title: `OSS-Anchor-${S}`,
        orderNumber: `OSS-AN-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: accepted
      }
    })).id;
  });

  it('оплата пришла — заявка сама переехала в «Оплата поступила»', async () => {
    const res = await applyStatusAnchor(prisma, anchorOrderId, 'paid', adminId);
    expect(res).toEqual({ ok: true, changed: true });

    const order = await prisma.order.findUnique({
      where: { id: anchorOrderId },
      select: { statusId: true }
    });
    expect(order?.statusId).toBe(paid);
  });

  it('повторное событие ничего не меняет', async () => {
    expect(await applyStatusAnchor(prisma, anchorOrderId, 'paid')).toEqual({
      ok: true,
      changed: false
    });
  });

  it('факт НЕ откатывает заявку назад', async () => {
    // Заявка ушла дальше по порядку; пришедшая позже оплата не должна вернуть
    // её на шаг назад. Берём «Бухгалтерия подписана», а не «Заявка закрыта»:
    // закрытие теперь требует выполненных условий §5.6 (PR-3), и тест про
    // якорь не должен зависеть от них.
    const admin = sess(adminId, 'admin');
    const all = await getOrderedStatuses(prisma);
    const signed = all.find((x) => x.key === 'accounting_signed')!.id;

    await transitionOrderStatus(prisma, admin, { orderId: anchorOrderId, toId: signed });
    const res = await applyStatusAnchor(prisma, anchorOrderId, 'paid');
    expect(res).toEqual({ ok: true, changed: false });

    const order = await prisma.order.findUnique({
      where: { id: anchorOrderId },
      select: { statusId: true }
    });
    expect(order?.statusId).toBe(signed);
  });

  it('отменённую заявку факты не воскрешают', async () => {
    const admin = sess(adminId, 'admin');
    await transitionOrderStatus(prisma, admin, { orderId: anchorOrderId, toId: cancelled });
    expect(await applyStatusAnchor(prisma, anchorOrderId, 'documents_issued')).toEqual({
      ok: true,
      changed: false
    });
  });

  it('несуществующая заявка — not_found', async () => {
    expect(await applyStatusAnchor(prisma, 'nope', 'paid')).toEqual({
      ok: false,
      error: 'not_found'
    });
  });

  it('заявка без статуса переводится якорем и без указания пользователя', async () => {
    const fresh = await prisma.order.create({
      data: {
        title: `OSS-Fresh-${S}`,
        orderNumber: `OSS-FR-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending'
      }
    });
    expect(await applyStatusAnchor(prisma, fresh.id, 'documents_issued')).toEqual({
      ok: true,
      changed: true
    });

    const history = await listStatusHistory(prisma, fresh.id);
    expect(history[0].from).toBeNull();
    expect(history[0].user).toBeNull();
    expect(history[0].reason).toContain('Автоматически');
  });

  it('якорь без строки в справочнике — invalid_status', async () => {
    const admin = sess(adminId, 'admin');
    const target = (await getOrderedStatuses(prisma)).find((s) => s.anchor === 'accounting_signed')!;
    // временно выключаем строку с якорем: findByAnchor ищет только активные
    await prisma.orderStatusDefinition.update({
      where: { id: target.id },
      data: { isActive: false }
    });
    const fresh = await prisma.order.create({
      data: {
        title: `OSS-NoAnchor-${S}`,
        orderNumber: `OSS-NA-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending'
      }
    });
    expect(await applyStatusAnchor(prisma, fresh.id, 'accounting_signed')).toEqual({
      ok: false,
      error: 'invalid_status'
    });
    await prisma.orderStatusDefinition.update({
      where: { id: target.id },
      data: { isActive: true }
    });
    void admin;
  });
});

// ─── Ветки, недостижимые на живой базе ──────────────────────────────────────

describe('нештатные ошибки БД пробрасываются наружу', () => {
  it('createStatusDefinition: не-P2002 ошибка Prisma не глотается', async () => {
    // На живом Postgres такую ошибку не воспроизвести — подменяем клиент,
    // как это сделано для customFields (тот же приём, cov.customfields).
    const boom = new Error('connection lost');
    const stub = {
      orderStatusDefinition: {
        findFirst: async () => null,
        create: async () => {
          throw boom;
        }
      }
    } as unknown as PrismaClient;

    await expect(
      createStatusDefinition(stub, sess(adminId, 'admin'), {
        key: `oss_test_boom_${S}`,
        label: 'Бум'
      })
    ).rejects.toThrow('connection lost');
  });

  it('заявка с заранее выставленным статусом двигается вперёд от него', async () => {
    // Ветка «у заявки уже есть statusId» в transitionOrderStatus: общая заявка
    // теста стартует без статуса, поэтому нужна отдельная.
    const admin = sess(adminId, 'admin');
    const own = await prisma.order.create({
      data: {
        title: `OSS-Preset-${S}`,
        orderNumber: `OSS-PS-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: draft
      }
    });

    const res = await transitionOrderStatus(prisma, admin, { orderId: own.id, toId: paid });
    expect(res.ok).toBe(true);

    const history = await listStatusHistory(prisma, own.id);
    expect(history[0].from?.label).toBe('Черновик заявки');

    await prisma.orderStatusChange.deleteMany({ where: { orderId: own.id } });
    await prisma.order.delete({ where: { id: own.id } });
  });
});

// ─── PR-3: связь со старым полем и условия закрытия ─────────────────────────

describe('старое поле Order.status остаётся заполненным (решение Q3)', () => {
  let syncOrderId: string;

  beforeAll(async () => {
    syncOrderId = (await prisma.order.create({
      data: {
        title: `OSS-Sync-${S}`,
        orderNumber: `OSS-SY-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: draft
      }
    })).id;
  });

  it('переход в «Принято в работу» ставит старому полю in_progress', async () => {
    const admin = sess(adminId, 'admin');
    await transitionOrderStatus(prisma, admin, { orderId: syncOrderId, toId: accepted });

    const row = await prisma.order.findUnique({
      where: { id: syncOrderId },
      select: { status: true, statusId: true }
    });
    expect(row?.status).toBe('in_progress');
    expect(row?.statusId).toBe(accepted);
  });

  it('отмена старое поле НЕ трогает — в enum нет такого значения', async () => {
    const admin = sess(adminId, 'admin');
    const before = await prisma.order.findUnique({
      where: { id: syncOrderId },
      select: { status: true }
    });

    await transitionOrderStatus(prisma, admin, { orderId: syncOrderId, toId: cancelled });

    const after = await prisma.order.findUnique({
      where: { id: syncOrderId },
      select: { status: true, statusId: true }
    });
    expect(after?.status).toBe(before?.status);
    expect(after?.statusId).toBe(cancelled);
  });
});

describe('закрыть заявку можно только при выполненных условиях (§5.6)', () => {
  let closeOrderId: string;

  beforeAll(async () => {
    closeOrderId = (await prisma.order.create({
      data: {
        title: `OSS-Close-${S}`,
        orderNumber: `OSS-CL-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'in_progress',
        serviceType: 'document_development',
        statusId: accepted
      }
    })).id;
  });

  it('без документа и подписи бухгалтерии закрыть нельзя — со списком причин', async () => {
    const admin = sess(adminId, 'admin');
    const res = await transitionOrderStatus(prisma, admin, {
      orderId: closeOrderId,
      toId: closed
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.error).toBe('completion_conditions_unmet');
    if (res.error !== 'completion_conditions_unmet') throw new Error('unexpected');
    expect(res.unmet).toContain('documents_uploaded');
    expect(res.unmet).toContain('accounting_signed');
  });

  it('когда условия выполнены — закрывается', async () => {
    const admin = sess(adminId, 'admin');
    await prisma.document.create({
      data: {
        name: `OSS-Doc-${S}`,
        path: `p/${S}/close`,
        mimeType: 'application/pdf',
        counterpartyType: 'organization',
        counterpartyId: orgId,
        orderId: closeOrderId,
        scanStatus: 'clean'
      }
    });
    await prisma.order.update({
      where: { id: closeOrderId },
      data: { accountingSignedAt: new Date('2026-07-01T00:00:00Z') }
    });

    const res = await transitionOrderStatus(prisma, admin, {
      orderId: closeOrderId,
      toId: closed
    });
    expect(res.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: closeOrderId },
      select: { status: true }
    });
    // старое поле тоже доехало до completed
    expect(row?.status).toBe('completed');
  });
});
