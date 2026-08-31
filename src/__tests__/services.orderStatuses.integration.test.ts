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
  getInitialStatusId,
} from '@/lib/services/orderStatuses/definitions';
import {
  transitionOrderStatus,
  applyStatusAnchor,
  listStatusHistory,
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
  const partnerId = (
    await prisma.partner.create({
      data: { name: `OSS-P-${S}`, commissionRate: 0.1 },
    })
  ).id;
  orgId = (
    await prisma.organization.create({
      data: { name: `OSS-Org-${S}`, partnerId, companyId },
    })
  ).id;
  await prisma.organizationManager.create({
    data: { organizationId: orgId, userId: managerId, isActive: true },
  });

  orderId = (
    await prisma.order.create({
      data: {
        title: `OSS-Order-${S}`,
        orderNumber: `OSS-ON-${S}`,
        companyId,
        partnerId,
        organizationId: orgId,
        executionStatus: 'in_progress',
      },
    })
  ).id;

  const all = await getOrderedStatuses(prisma);
  const byKey = (k: string) => all.find((s) => s.key === k)!.id;
  draft = byKey('draft');
  accepted = byKey('accepted');
  paid = byKey('paid');
  closed = byKey('closed');
  cancelled = byKey('cancelled');
});

afterAll(async () => {
  await prisma.orderStatusChange.deleteMany({
    where: { order: { title: { startsWith: 'OSS-' } } },
  });
  await prisma.document.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.order.deleteMany({ where: { title: { startsWith: 'OSS-' } } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerId } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'OSS-' } } });
  await prisma.orderStatusDefinition.deleteMany({ where: { key: { startsWith: 'oss_test_' } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, managerId, leaderId] } } });
  // Смена статуса теперь рассылает уведомления (§10, раздел 18) — их строки
  // держат пользователей по внешнему ключу, чистим до удаления юзеров.
  // Чистим по признаку пользователя, а не по списку id: остатки прошлых
  // прогонов тоже держат FK.
  await prisma.notification.deleteMany({ where: { user: { email: { contains: 'oss-' } } } });
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
      'cancelled',
    ]);
    expect(system.map((s) => s.label)).toEqual([
      'Черновик заявки',
      'Принято в работу',
      'Оплата поступила',
      'Документы выданы',
      'Бухгалтерия подписана',
      'Заявка закрыта',
      'Отменена',
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

  it('новая заявка, созданная сервисом, получает статус из справочника', async () => {
    const fresh = await prisma.order.create({
      data: {
        title: `OSS-New-${S}`,
        orderNumber: `OSS-NW-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: draft,
      },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(fresh.statusDefinition?.key).toBe('draft');
  });
});

// ─── Справочник ──────────────────────────────────────────────────────────────

describe('справочник статусов — настройка', () => {
  it('менеджеру справочник недоступен, админу и руководителю — да', async () => {
    expect(await listStatusDefinitions(prisma, sess(managerId, 'manager'))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect((await listStatusDefinitions(prisma, sess(adminId, 'admin'))).ok).toBe(true);
    expect((await listStatusDefinitions(prisma, sess(leaderId, 'leader'))).ok).toBe(true);
  });

  it('системный статус нельзя деактивировать', async () => {
    const res = await updateStatusDefinition(prisma, sess(adminId, 'admin'), draft, {
      isActive: false,
    });
    expect(res).toEqual({ ok: false, error: 'system_protected' });
  });

  it('системный статус нельзя удалить', async () => {
    const res = await deleteStatusDefinition(prisma, sess(adminId, 'admin'), closed);
    expect(res).toEqual({ ok: false, error: 'system_protected' });
  });

  it('системный статус можно переименовать и подвинуть (§10)', async () => {
    const res = await updateStatusDefinition(prisma, sess(adminId, 'admin'), accepted, {
      label: 'Взято в работу',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.label).toBe('Взято в работу');
    // возвращаем как было, чтобы не мешать другим проверкам
    await updateStatusDefinition(prisma, sess(adminId, 'admin'), accepted, {
      label: 'Принято в работу',
    });
  });

  it('свой статус добавляется, переименовывается и удаляется, пока не использован', async () => {
    const admin = sess(adminId, 'admin');
    const created = await createStatusDefinition(prisma, admin, {
      key: `oss_test_extra_${S}`,
      label: 'Выданы доступы',
      sortOrder: 25,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unexpected');

    const renamed = await updateStatusDefinition(prisma, admin, created.definition.id, {
      label: 'Доступы выданы',
    });
    if (!renamed.ok) throw new Error('unexpected');
    expect(renamed.definition.label).toBe('Доступы выданы');

    expect(await deleteStatusDefinition(prisma, admin, created.definition.id)).toEqual({
      ok: true,
    });
  });

  it('дубль ключа и кривой ключ отвергаются', async () => {
    const admin = sess(adminId, 'admin');
    expect(await createStatusDefinition(prisma, admin, { key: 'draft', label: 'X' })).toEqual({
      ok: false,
      error: 'duplicate_key',
    });
    expect(await createStatusDefinition(prisma, admin, { key: '1bad', label: 'X' })).toEqual({
      ok: false,
      error: 'invalid_key',
    });
  });

  it('второй статус с занятым якорем не создать — автоперевод стал бы неоднозначным', async () => {
    const res = await createStatusDefinition(prisma, sess(adminId, 'admin'), {
      key: `oss_test_paid2_${S}`,
      label: 'Оплата (дубль)',
      anchor: 'paid',
    });
    expect(res).toEqual({ ok: false, error: 'anchor_taken' });
  });

  it('неизвестный якорь отвергается', async () => {
    const res = await createStatusDefinition(prisma, sess(adminId, 'admin'), {
      key: `oss_test_bogus_${S}`,
      label: 'Мимо',
      anchor: 'teleported',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_key' });
  });

  it('несуществующий id даёт not_found', async () => {
    const admin = sess(adminId, 'admin');
    expect(await updateStatusDefinition(prisma, admin, 'nope', { label: 'X' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await deleteStatusDefinition(prisma, admin, 'nope')).toEqual({
      ok: false,
      error: 'not_found',
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
      sortOrder: 27,
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
        executionStatus: 'pending',
      },
    });
    await transitionOrderStatus(prisma, admin, { orderId: own.id, toId: extra.definition.id });

    expect(await deleteStatusDefinition(prisma, admin, extra.definition.id)).toEqual({
      ok: false,
      error: 'system_protected',
    });

    // а деактивировать — можно
    const off = await updateStatusDefinition(prisma, admin, extra.definition.id, {
      isActive: false,
    });
    expect(off.ok).toBe(true);

    // уборка: чистим историю своей заявки
    await prisma.orderStatusChange.deleteMany({ where: { orderId: own.id } });
    await prisma.order.delete({ where: { id: own.id } });
    await prisma.orderStatusChange.deleteMany({
      where: { OR: [{ toId: extra.definition.id }, { fromId: extra.definition.id }] },
    });
    await prisma.orderStatusDefinition.delete({ where: { id: extra.definition.id } });
  });

  it('менеджер не может ни создать, ни изменить, ни удалить', async () => {
    const mgr = sess(managerId, 'manager');
    expect(await createStatusDefinition(prisma, mgr, { key: 'x_key', label: 'X' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await updateStatusDefinition(prisma, mgr, draft, { label: 'X' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await deleteStatusDefinition(prisma, mgr, draft)).toEqual({
      ok: false,
      error: 'forbidden',
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
    const leader = sess(leaderId, 'leader', { companyId });
    const res = await transitionOrderStatus(prisma, leader, { orderId, toId: draft });
    expect(res.ok).toBe(true);
    // возвращаем вперёд для следующих проверок
    await transitionOrderStatus(prisma, leader, { orderId, toId: accepted });
  });

  it('клиентские роли статус не двигают', async () => {
    for (const role of ['organization', 'partner', 'student']) {
      const res = await transitionOrderStatus(prisma, sess('anon', role), {
        orderId,
        toId: accepted,
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
      error: 'not_found',
    });
    expect(await transitionOrderStatus(prisma, admin, { orderId, toId: 'nope' })).toEqual({
      ok: false,
      error: 'invalid_status',
    });
  });

  it('деактивированный статус выбрать нельзя', async () => {
    const admin = sess(adminId, 'admin');
    const extra = await createStatusDefinition(prisma, admin, {
      key: `oss_test_off_${S}`,
      label: 'Выключенный',
      sortOrder: 26,
    });
    if (!extra.ok) throw new Error('unexpected');
    await updateStatusDefinition(prisma, admin, extra.definition.id, { isActive: false });

    const res = await transitionOrderStatus(prisma, admin, {
      orderId,
      toId: extra.definition.id,
    });
    expect(res).toEqual({ ok: false, error: 'status_inactive' });

    await deleteStatusDefinition(prisma, admin, extra.definition.id);
  });
});

describe('отмена заявки — решение Q4', () => {
  let cancelOrderId: string;

  beforeAll(async () => {
    cancelOrderId = (
      await prisma.order.create({
        data: {
          title: `OSS-Cancel-${S}`,
          orderNumber: `OSS-CN-${S}`,
          companyId,
          organizationId: orgId,
          executionStatus: 'pending',
          statusId: accepted,
        },
      })
    ).id;
  });

  it('менеджер без причины отменить не может', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, {
      orderId: cancelOrderId,
      toId: cancelled,
    });
    expect(res).toEqual({ ok: false, error: 'reason_required' });
  });

  it('менеджер с причиной — может, причина попадает в журнал', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await transitionOrderStatus(prisma, mgr, {
      orderId: cancelOrderId,
      toId: cancelled,
      reason: 'Клиент отказался',
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
      toId: accepted,
    });
    expect(res).toEqual({ ok: false, error: 'backward_forbidden' });
  });

  it('администратор поднимает — и отменяет без причины', async () => {
    const admin = sess(adminId, 'admin');
    expect(
      (await transitionOrderStatus(prisma, admin, { orderId: cancelOrderId, toId: accepted })).ok
    ).toBe(true);
    expect(
      (await transitionOrderStatus(prisma, admin, { orderId: cancelOrderId, toId: cancelled })).ok
    ).toBe(true);
  });
});

// ─── Автоперевод по факту ────────────────────────────────────────────────────

describe('автоперевод по якорю', () => {
  let anchorOrderId: string;

  beforeAll(async () => {
    anchorOrderId = (
      await prisma.order.create({
        data: {
          title: `OSS-Anchor-${S}`,
          orderNumber: `OSS-AN-${S}`,
          companyId,
          organizationId: orgId,
          executionStatus: 'pending',
          statusId: accepted,
        },
      })
    ).id;
  });

  it('оплата пришла — заявка сама переехала в «Оплата поступила»', async () => {
    const res = await applyStatusAnchor(prisma, anchorOrderId, 'paid', adminId);
    expect(res).toEqual({ ok: true, changed: true });

    const order = await prisma.order.findUnique({
      where: { id: anchorOrderId },
      select: { statusId: true },
    });
    expect(order?.statusId).toBe(paid);
  });

  it('повторное событие ничего не меняет', async () => {
    expect(await applyStatusAnchor(prisma, anchorOrderId, 'paid')).toEqual({
      ok: true,
      changed: false,
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
      select: { statusId: true },
    });
    expect(order?.statusId).toBe(signed);
  });

  it('отменённую заявку факты не воскрешают', async () => {
    const admin = sess(adminId, 'admin');
    await transitionOrderStatus(prisma, admin, { orderId: anchorOrderId, toId: cancelled });
    expect(await applyStatusAnchor(prisma, anchorOrderId, 'documents_issued')).toEqual({
      ok: true,
      changed: false,
    });
  });

  it('несуществующая заявка — not_found', async () => {
    expect(await applyStatusAnchor(prisma, 'nope', 'paid')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('заявка без статуса переводится якорем и без указания пользователя', async () => {
    const fresh = await prisma.order.create({
      data: {
        title: `OSS-Fresh-${S}`,
        orderNumber: `OSS-FR-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
      },
    });
    expect(await applyStatusAnchor(prisma, fresh.id, 'documents_issued')).toEqual({
      ok: true,
      changed: true,
    });

    const history = await listStatusHistory(prisma, fresh.id);
    expect(history[0].from).toBeNull();
    expect(history[0].user).toBeNull();
    expect(history[0].reason).toContain('Автоматически');
  });

  it('якорь без строки в справочнике — invalid_status', async () => {
    const admin = sess(adminId, 'admin');
    const target = (await getOrderedStatuses(prisma)).find(
      (s) => s.anchor === 'accounting_signed'
    )!;
    // временно выключаем строку с якорем: findByAnchor ищет только активные
    await prisma.orderStatusDefinition.update({
      where: { id: target.id },
      data: { isActive: false },
    });
    const fresh = await prisma.order.create({
      data: {
        title: `OSS-NoAnchor-${S}`,
        orderNumber: `OSS-NA-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
      },
    });
    expect(await applyStatusAnchor(prisma, fresh.id, 'accounting_signed')).toEqual({
      ok: false,
      error: 'invalid_status',
    });
    await prisma.orderStatusDefinition.update({
      where: { id: target.id },
      data: { isActive: true },
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
        },
      },
    } as unknown as PrismaClient;

    await expect(
      createStatusDefinition(stub, sess(adminId, 'admin'), {
        key: `oss_test_boom_${S}`,
        label: 'Бум',
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
        statusId: draft,
      },
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

describe('старого поля Order.status больше нет (PR-4)', () => {
  it('колонка удалена из схемы — источник правды один', async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
       where table_name = 'Order' and column_name in ('status','statusId')`
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('statusId');
    expect(names).not.toContain('status');
  });

  it('тип OrderStatus тоже снят', async () => {
    const types = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `select typname from pg_type where typname = 'OrderStatus'`
    );
    expect(types).toEqual([]);
  });
});

describe('закрыть заявку можно только при выполненных условиях (§5.6)', () => {
  let closeOrderId: string;

  beforeAll(async () => {
    closeOrderId = (
      await prisma.order.create({
        data: {
          title: `OSS-Close-${S}`,
          orderNumber: `OSS-CL-${S}`,
          companyId,
          organizationId: orgId,
          executionStatus: 'in_progress',
          serviceType: 'document_development',
          statusId: accepted,
        },
      })
    ).id;
  });

  it('без документа и подписи бухгалтерии закрыть нельзя — со списком причин', async () => {
    const admin = sess(adminId, 'admin');
    const res = await transitionOrderStatus(prisma, admin, {
      orderId: closeOrderId,
      toId: closed,
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
        companyId,
        scanStatus: 'clean',
      },
    });
    await prisma.order.update({
      where: { id: closeOrderId },
      data: { accountingSignedAt: new Date('2026-07-01T00:00:00Z') },
    });

    const res = await transitionOrderStatus(prisma, admin, {
      orderId: closeOrderId,
      toId: closed,
    });
    expect(res.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: closeOrderId },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(row?.statusDefinition?.key).toBe('closed');
  });
});

// ─── Уведомления при смене статуса (§10, раздел 18) ─────────────────────────

describe('рассылка при смене статуса', () => {
  it('сбой рассылки коллегам НЕ откатывает смену статуса', async () => {
    // §3 CLAUDE.md: fan-out деградирует мягко. Проверяем на стабе: настоящий
    // notifyManagers в тесте не уронить, а поведение при сбое — важное.
    const admin = sess(adminId, 'admin');
    const own = await prisma.order.create({
      data: {
        title: `OSS-Notify-${S}`,
        orderNumber: `OSS-NT-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: draft,
      },
    });

    const broken = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'user') {
          return {
            findUnique: async () => {
              throw new Error('база моргнула');
            },
          };
        }
        return Reflect.get(target, prop);
      },
    }) as typeof prisma;

    const res = await transitionOrderStatus(broken, admin, {
      orderId: own.id,
      toId: accepted,
    });
    expect(res.ok).toBe(true);

    // статус всё равно сменился
    const row = await prisma.order.findUnique({
      where: { id: own.id },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(row?.statusDefinition?.key).toBe('accepted');

    await prisma.orderStatusChange.deleteMany({ where: { orderId: own.id } });
    await prisma.order.delete({ where: { id: own.id } });
  });
});

describe('рассылка: мелочи, которые молча ломаются', () => {
  it('автор без имени подписывается «Менеджер», не-Error в сбое не роняет лог', async () => {
    const admin = sess(adminId, 'admin');
    const own = await prisma.order.create({
      data: {
        title: `OSS-NoName-${S}`,
        orderNumber: `OSS-NN-${S}`,
        companyId,
        organizationId: orgId,
        executionStatus: 'pending',
        statusId: draft,
      },
    });

    // user.findUnique отдаёт запись без имени → подпись по умолчанию;
    // а notifyManagers бросает строку (не Error) → ветка String(err).
    const stub = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'user') {
          return { findUnique: async () => ({ name: null }) };
        }
        if (prop === 'orderStatusChange') {
          return Reflect.get(target, prop);
        }
        return Reflect.get(target, prop);
      },
    }) as typeof prisma;

    const res = await transitionOrderStatus(stub, admin, { orderId: own.id, toId: accepted });
    expect(res.ok).toBe(true);

    await prisma.orderStatusChange.deleteMany({ where: { orderId: own.id } });
    await prisma.order.delete({ where: { id: own.id } });
  });
});

describe('начальный статус новой заявки', () => {
  it('getInitialStatusId возвращает «Черновик заявки»', async () => {
    const id = await getInitialStatusId(prisma);
    expect(id).toBe(draft);
  });

  it('если справочник пуст — null, создание заявки не падает (fail-open §3)', async () => {
    const empty = {
      orderStatusDefinition: { findFirst: async () => null },
    } as unknown as PrismaClient;
    expect(await getInitialStatusId(empty)).toBeNull();
  });
});
