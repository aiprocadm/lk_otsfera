/**
 * Integration tests: customFields values service.
 * Requires live Postgres. Run: npm run test:integration -- services.customFields.values
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDefinition } from '@/lib/services/customFields/definitions';
import { getValuesForEntity, setValues } from '@/lib/services/customFields/values';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

const stamp = Date.now();

// IDs created during setup
let adminUserId: string;
let managerUserId: string;
let outOfScopeManagerUserId: string;
let orgUserId: string;
let companyId: string;
let partnerId: string;
let organizationId: string;

// Definitions
let defTextId: string;
let defNumberId: string;
let defDateId: string;
let defSelectId: string;
let defBooleanId: string;

// Orders
let orderId: string; // in scope for manager
let foreignOrderId: string; // NOT in scope for manager

const ET = 'order';

function makeSession(
  userId: string,
  role: string,
  extra: Partial<SessionPayload> = {}
): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  // Create users
  const admin = await prisma.user.create({
    data: {
      email: `cfv-admin-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFV Admin',
      role: 'admin',
    },
  });
  adminUserId = admin.id;

  const manager = await prisma.user.create({
    data: {
      email: `cfv-mgr-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFV Manager',
      role: 'manager',
    },
  });
  managerUserId = manager.id;

  const outMgr = await prisma.user.create({
    data: {
      email: `cfv-out-mgr-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFV OutMgr',
      role: 'manager',
    },
  });
  outOfScopeManagerUserId = outMgr.id;

  const orgUser = await prisma.user.create({
    data: {
      email: `cfv-org-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFV OrgUser',
      role: 'organization',
    },
  });
  orgUserId = orgUser.id;

  // Create company, partner, organization
  const company = await prisma.company.create({ data: { name: `CFV-Co-${stamp}` } });
  companyId = company.id;

  const partner = await prisma.partner.create({
    data: { name: `CFV-P-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const org = await prisma.organization.create({
    data: { name: `CFV-Org-${stamp}`, partnerId, companyId },
  });
  organizationId = org.id;

  // Link manager to organization
  await prisma.organizationManager.create({
    data: { organizationId, userId: managerUserId, isActive: true },
  });

  // Create orders
  const order = await prisma.order.create({
    data: {
      title: `CFV-Order-${stamp}`,
      orderNumber: `CFV-ON-${stamp}`,
      companyId,
      partnerId,
      organizationId,
      executionStatus: 'in_progress',
    },
  });
  orderId = order.id;

  // Foreign order — different partner + different org, no link to our manager
  const foreignPartner = await prisma.partner.create({
    data: { name: `CFV-FP-${stamp}`, commissionRate: 0.1 },
  });
  const foreignOrg = await prisma.organization.create({
    data: { name: `CFV-FOrg-${stamp}`, partnerId: foreignPartner.id, companyId },
  });
  const foreignOrder = await prisma.order.create({
    data: {
      title: `CFV-ForeignOrder-${stamp}`,
      orderNumber: `CFV-FON-${stamp}`,
      companyId,
      partnerId: foreignPartner.id,
      organizationId: foreignOrg.id,
      executionStatus: 'pending',
    },
  });
  foreignOrderId = foreignOrder.id;

  // Create custom field definitions via admin session
  const adminSession = makeSession(adminUserId, 'admin');

  const dText = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'contract_number',
    label: 'Номер договора',
    fieldType: 'text',
    sortOrder: 1,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!dText.ok) throw new Error('Failed to create text def');
  defTextId = dText.definition.id;

  const dNum = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'amount_override',
    label: 'Сумма',
    fieldType: 'number',
    sortOrder: 2,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!dNum.ok) throw new Error('Failed to create number def');
  defNumberId = dNum.definition.id;

  const dDate = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'deadline',
    label: 'Срок',
    fieldType: 'date',
    sortOrder: 3,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!dDate.ok) throw new Error('Failed to create date def');
  defDateId = dDate.definition.id;

  const dSelect = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'priority',
    label: 'Приоритет',
    fieldType: 'select',
    options: ['low', 'medium', 'high'],
    sortOrder: 4,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!dSelect.ok) throw new Error('Failed to create select def');
  defSelectId = dSelect.definition.id;

  const dBool = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'is_urgent',
    label: 'Срочно',
    fieldType: 'boolean',
    sortOrder: 5,
    editableByRoles: ['admin', 'leader', 'manager'],
  });
  if (!dBool.ok) throw new Error('Failed to create boolean def');
  defBooleanId = dBool.definition.id;
});

afterAll(async () => {
  // Delete values first (FK), then definitions, then orders and other entities
  // Use title-based filter to safely clean all CFV-* test orders
  const testOrders = await prisma.order.findMany({
    where: { title: { startsWith: 'CFV-' } },
    select: { id: true },
  });
  const testOrderIds = testOrders.map((o) => o.id);
  if (testOrderIds.length > 0) {
    await prisma.customFieldValue.deleteMany({ where: { entityId: { in: testOrderIds } } });
  }

  await prisma.customFieldDefinition.deleteMany({
    where: {
      entityType: { in: [ET, 'other_entity'] },
      key: {
        in: [
          'contract_number',
          'amount_override',
          'deadline',
          'priority',
          'is_urgent',
          'wrong_key',
        ],
      },
    },
  });
  await prisma.order.deleteMany({ where: { title: { startsWith: 'CFV-' } } });
  await prisma.organizationManager.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'CFV-' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'CFV-' } } });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [adminUserId, managerUserId, outOfScopeManagerUserId, orgUserId] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: 'cfv-' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: `CFV-Co-${stamp}` } } });
  await prisma.$disconnect();
});

describe('values service', () => {
  it('getValuesForEntity: returns all active defs with null values when none set', async () => {
    const res = await getValuesForEntity(prisma, makeSession(adminUserId, 'admin'), ET, orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    // Should have our 5 defs
    const keys = res.fields.map((f) => f.definition.key);
    expect(keys).toContain('contract_number');
    expect(keys).toContain('amount_override');
    expect(keys).toContain('deadline');
    expect(keys).toContain('priority');
    expect(keys).toContain('is_urgent');
    // All values null initially
    expect(res.fields.every((f) => f.value === null)).toBe(true);
    // Ordered by sortOrder
    const sortOrders = res.fields
      .filter((f) => keys.includes(f.definition.key))
      .map((f) => f.definition.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  it('setValues: admin can set values for any order', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {
      [defTextId]: 'Договор-001',
      [defNumberId]: '150000',
      [defDateId]: '2026-12-31',
      [defSelectId]: 'high',
      [defBooleanId]: 'true',
    });
    expect(res).toEqual({ ok: true });
  });

  it('getValuesForEntity: values appear after setValues', async () => {
    const res = await getValuesForEntity(prisma, makeSession(adminUserId, 'admin'), ET, orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    const byKey = Object.fromEntries(res.fields.map((f) => [f.definition.key, f.value]));
    expect(byKey['contract_number']).toBe('Договор-001');
    expect(byKey['amount_override']).toBe('150000');
    expect(byKey['deadline']).toBe('2026-12-31');
    expect(byKey['priority']).toBe('high');
    expect(byKey['is_urgent']).toBe('true');
  });

  it('setValues: manager in-scope can set values', async () => {
    const mgr = makeSession(managerUserId, 'manager', {
      companyId,
      managedOrgIds: [organizationId],
    });
    const res = await setValues(prisma, mgr, ET, orderId, {
      [defTextId]: 'Договор-002',
    });
    expect(res).toEqual({ ok: true });
  });

  it('setValues: manager out-of-scope → not_found or forbidden', async () => {
    // outOfScopeManager has no connection to orderId
    const outMgr = makeSession(outOfScopeManagerUserId, 'manager', {
      companyId,
      managedOrgIds: [], // no orgs
    });
    const res = await setValues(prisma, outMgr, ET, orderId, {
      [defTextId]: 'should-fail',
    });
    // Out-of-scope order is treated as not_found (same as getOrder returning null)
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(['not_found', 'forbidden']).toContain(res.error);
  });

  it('setValues: organization role → forbidden', async () => {
    const orgSession = makeSession(orgUserId, 'organization', { organizationId });
    const res = await setValues(prisma, orgSession, ET, orderId, {
      [defTextId]: 'should-fail',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('setValues: partner role → not_found (заказ не его)', async () => {
    // Create a temp partner user for this test
    const partnerUser = await prisma.user.create({
      data: {
        email: `cfv-ptr-${stamp}@t.local`,
        passwordHash: 'x',
        name: 'CFV Ptr',
        role: 'partner',
      },
    });
    const pSession = makeSession(partnerUser.id, 'partner');
    const res = await setValues(prisma, pSession, ET, orderId, {
      [defTextId]: 'should-fail',
    });
    // Этап 1 ТЗ v0.5: чужая карточка неотличима от несуществующей — не
    // раскрываем существование чужого заказа (см. resolveEntityAccess).
    expect(res).toEqual({ ok: false, error: 'not_found' });
    // Cleanup
    await prisma.user.delete({ where: { id: partnerUser.id } });
  });

  it('setValues: invalid_value — number field with non-numeric string', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {
      [defNumberId]: 'not-a-number',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_value' });
  });

  it('setValues: invalid_value — date field with invalid date string', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {
      [defDateId]: 'not-a-date',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_value' });
  });

  it('setValues: invalid_value — select field with option not in list', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {
      [defSelectId]: 'critical', // not in ['low','medium','high']
    });
    expect(res).toEqual({ ok: false, error: 'invalid_value' });
  });

  it('setValues: invalid_value — boolean field with invalid string', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {
      [defBooleanId]: 'yes', // not 'true'|'false'
    });
    expect(res).toEqual({ ok: false, error: 'invalid_value' });
  });

  it('setValues: idempotent — setting twice produces only one row', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    await setValues(prisma, adminSession, ET, orderId, { [defTextId]: 'First' });
    await setValues(prisma, adminSession, ET, orderId, { [defTextId]: 'Second' });
    const count = await prisma.customFieldValue.count({
      where: { definitionId: defTextId, entityId: orderId },
    });
    expect(count).toBe(1);
    // Latest value wins
    const val = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: defTextId, entityId: orderId } },
    });
    expect(val?.value).toBe('Second');
  });

  it('setValues: null value stores null (clears field)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    await setValues(prisma, adminSession, ET, orderId, { [defTextId]: null });
    const val = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: defTextId, entityId: orderId } },
    });
    expect(val?.value).toBeNull();
  });

  it('setValues: defId from wrong entityType is ignored', async () => {
    // Create a definition for a different entityType
    const adminSession = makeSession(adminUserId, 'admin');
    const wrongDef = await createDefinition(prisma, adminSession, {
      // Другая сущность из закрытого списка (этап 1 ТЗ v0.5).
      entityType: 'partner',
      key: 'wrong_key',
      label: 'Wrong',
      fieldType: 'text',
    });
    if (!wrongDef.ok) throw new Error('unexpected');
    const beforeCount = await prisma.customFieldValue.count({ where: { entityId: orderId } });
    await setValues(prisma, adminSession, ET, orderId, {
      [wrongDef.definition.id]: 'should-be-ignored',
    });
    const afterCount = await prisma.customFieldValue.count({ where: { entityId: orderId } });
    expect(afterCount).toBe(beforeCount);
    // Cleanup
    await prisma.customFieldDefinition.delete({ where: { id: wrongDef.definition.id } });
  });

  it('setValues: foreign order not accessible by manager → not_found', async () => {
    const mgr = makeSession(managerUserId, 'manager', {
      companyId,
      managedOrgIds: [organizationId],
    });
    const res = await setValues(prisma, mgr, ET, foreignOrderId, {
      [defTextId]: 'should-fail',
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(['not_found', 'forbidden']).toContain(res.error);
  });
});
