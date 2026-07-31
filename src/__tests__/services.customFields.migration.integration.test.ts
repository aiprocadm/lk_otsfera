/**
 * Этап 1 ТЗ v0.5 (§11) — регресс обратной совместимости миграции.
 *
 * Ловушка, которую этот файл сторожит: решение заказчика Q1 сделало дефолтом
 * «правят только администратор и руководитель». До этапа значения полей заказа
 * писал и менеджер в скоупе. Если бы новый дефолт применили к УЖЕ созданным
 * определениям, менеджеры молча потеряли бы право правки на боевых данных —
 * поэтому миграция проставила старым строкам явный ['admin','leader','manager'].
 *
 * Здесь мы моделируем обе стороны: «старое» определение (с явными ролями, как
 * после миграции) и «новое» (созданное после этапа, с дефолтом).
 *
 * Требует живой Postgres.
 * Запуск: npm run test:integration -- services.customFields.migration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createDefinition } from '@/lib/services/customFields/definitions';
import { setValues } from '@/lib/services/customFields/values';

let prisma: PrismaClient;

const S = Date.now();

let adminId: string;
let managerId: string;
let companyId: string;
let orgId: string;
let orderId: string;
let legacyDefId: string; // «старое» поле: роли проставлены миграцией
let freshDefId: string; // «новое» поле: дефолт Q1

function sess(userId: string, role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  adminId = (
    await prisma.user.create({
      data: {
        email: `cfm-admin-${S}@t.local`,
        passwordHash: 'x',
        name: 'CFM Admin',
        role: 'admin',
      },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: {
        email: `cfm-mgr-${S}@t.local`,
        passwordHash: 'x',
        name: 'CFM Manager',
        role: 'manager',
      },
    })
  ).id;

  companyId = (await prisma.company.create({ data: { name: `CFM-Co-${S}` } })).id;
  const partnerId = (
    await prisma.partner.create({
      data: { name: `CFM-P-${S}`, commissionRate: 0.1 },
    })
  ).id;
  orgId = (
    await prisma.organization.create({
      data: { name: `CFM-Org-${S}`, partnerId, companyId },
    })
  ).id;
  await prisma.organizationManager.create({
    data: { organizationId: orgId, userId: managerId, isActive: true },
  });
  orderId = (
    await prisma.order.create({
      data: {
        title: `CFM-Order-${S}`,
        orderNumber: `CFM-ON-${S}`,
        companyId,
        partnerId,
        organizationId: orgId,
        executionStatus: 'in_progress',
      },
    })
  ).id;

  const admin = sess(adminId, 'admin');

  // «Старое» поле — ровно то, что миграция сделала с существующими строками.
  const legacy = await createDefinition(prisma, admin, {
    entityType: 'order',
    key: `cfm_legacy_${S}`,
    label: 'Поле до этапа 1',
    fieldType: 'text',
    sortOrder: 1,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!legacy.ok) throw new Error(`legacy def: ${legacy.error}`);
  legacyDefId = legacy.definition.id;

  // «Новое» поле — создано после этапа, роли не заданы → дефолт Q1.
  const fresh = await createDefinition(prisma, admin, {
    entityType: 'order',
    key: `cfm_fresh_${S}`,
    label: 'Поле после этапа 1',
    fieldType: 'text',
    sortOrder: 2,
  });
  if (!fresh.ok) throw new Error(`fresh def: ${fresh.error}`);
  freshDefId = fresh.definition.id;
});

afterAll(async () => {
  await prisma.customFieldValue.deleteMany({
    where: { definitionId: { in: [legacyDefId, freshDefId] } },
  });
  await prisma.customFieldDefinition.deleteMany({
    where: { id: { in: [legacyDefId, freshDefId] } },
  });
  await prisma.order.deleteMany({ where: { title: { startsWith: 'CFM-' } } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerId } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'CFM-' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'CFM-' } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, managerId] } } });
  await prisma.user.deleteMany({ where: { email: { contains: 'cfm-' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'CFM-Co' } } });
  await prisma.$disconnect();
});

describe('миграция §11 — права менеджера до и после этапа', () => {
  it('поле, существовавшее до этапа, менеджер в скоупе по-прежнему правит', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await setValues(prisma, mgr, 'order', orderId, { [legacyDefId]: 'как раньше' });
    expect(res).toEqual({ ok: true });

    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: legacyDefId, entityId: orderId } },
    });
    expect(row?.value).toBe('как раньше');
  });

  it('поле, созданное после этапа, менеджеру на запись недоступно (дефолт Q1)', async () => {
    const mgr = sess(managerId, 'manager', { companyId, managedOrgIds: [orgId] });
    const res = await setValues(prisma, mgr, 'order', orderId, { [freshDefId]: 'нельзя' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });

    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: freshDefId, entityId: orderId } },
    });
    expect(row).toBeNull();
  });

  it('администратор правит оба поля', async () => {
    const admin = sess(adminId, 'admin');
    const res = await setValues(prisma, admin, 'order', orderId, {
      [legacyDefId]: 'от админа',
      [freshDefId]: 'тоже от админа',
    });
    expect(res).toEqual({ ok: true });
  });

  it('колонки миграции существуют и заполнены ожидаемо', async () => {
    const legacy = await prisma.customFieldDefinition.findUnique({ where: { id: legacyDefId } });
    const fresh = await prisma.customFieldDefinition.findUnique({ where: { id: freshDefId } });

    expect(legacy?.editableByRoles).toEqual(['admin', 'leader', 'manager']);
    expect(fresh?.editableByRoles).toEqual([]); // пусто = дефолт, а не «никому»
    expect(fresh?.visibleToRoles).toEqual([]);
    expect(fresh?.helpText).toBeNull();
    expect(fresh?.isSystem).toBe(false);
  });
});
