/**
 * Integration tests: customFields definitions service (admin CRUD).
 * Requires live Postgres. Run: npm run test:integration -- services.customFields.definitions
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listDefinitions,
  createDefinition,
  updateDefinition,
  deactivateDefinition,
  getActiveDefinitions,
} from '@/lib/services/customFields/definitions';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;
let adminSession: SessionPayload;
let managerSession: SessionPayload;
let partnerSession: SessionPayload;

const stamp = Date.now();

function makeSession(
  userId: string,
  role: string,
  extra: Partial<SessionPayload> = {}
): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const adminUser = await prisma.user.create({
    data: {
      email: `cfd-admin-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFD Admin',
      role: 'admin',
    },
  });
  const managerUser = await prisma.user.create({
    data: {
      email: `cfd-mgr-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFD Manager',
      role: 'manager',
    },
  });
  const partnerUser = await prisma.user.create({
    data: {
      email: `cfd-partner-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'CFD Partner',
      role: 'partner',
    },
  });

  adminSession = makeSession(adminUser.id, 'admin');
  managerSession = makeSession(managerUser.id, 'manager');
  partnerSession = makeSession(partnerUser.id, 'partner');
});

afterAll(async () => {
  // Clean up test definitions (cascade deletes values)
  await prisma.customFieldDefinition.deleteMany({
    where: { entityType: ET },
  });
  // Clean up test users (and their audit logs via cascade)
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [adminSession.sub, managerSession.sub, partnerSession.sub] } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `cfd-` } },
  });
  await prisma.$disconnect();
});

// Этап 1 ТЗ v0.5: entityType — закрытый список из пяти сущностей
// (CUSTOM_FIELD_ENTITIES), синтетические строки больше не принимаются.
// Файлам тестов выданы разные сущности, чтобы они не мешали друг другу.
const ET = 'partner';

describe('definitions service — этап 1 ТЗ v0.5', () => {
  it('createDefinition: сущность вне закрытого списка → invalid_entity_type', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: 'invoice',
      key: 'some_key',
      label: 'Счёт',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_entity_type' });
  });

  it('createDefinition: ключ системного поля занят → reserved_key', async () => {
    // §11: у организации «Статус» — системное поле (колонка БД). Второе поле
    // с тем же ключом дало бы два «Статуса» из разных источников.
    const res = await createDefinition(prisma, adminSession, {
      entityType: 'organization',
      key: 'status',
      label: 'Статус (дубль)',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'reserved_key' });
  });

  it('createDefinition: тот же ключ у сущности без системных полей — разрешён', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: 'order',
      key: `status_note_${stamp}`,
      label: 'Пометка о статусе',
      fieldType: 'text',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    await prisma.customFieldDefinition.delete({ where: { id: res.definition.id } });
  });

  it('createDefinition: множественный выбор без вариантов → options_required', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: `multi_no_opts_${stamp}`,
      label: 'Множественный без вариантов',
      fieldType: 'multiselect',
    });
    expect(res).toEqual({ ok: false, error: 'options_required' });
  });

  it('updateDefinition: подсказка и роли сохраняются, мусор в ролях отбрасывается', async () => {
    const created = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: `roles_patch_${stamp}`,
      label: 'Поле с ролями',
      fieldType: 'text',
    });
    if (!created.ok) throw new Error('unexpected');

    const res = await updateDefinition(prisma, adminSession, created.definition.id, {
      helpText: 'Заполняет бухгалтерия',
      visibleToRoles: ['admin', 'organization'],
      editableByRoles: ['manager', 'root'], // 'root' — мусор, обязан отвалиться
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.helpText).toBe('Заполняет бухгалтерия');
    expect(res.definition.visibleToRoles).toEqual(['admin', 'organization']);
    expect(res.definition.editableByRoles).toEqual(['manager']);

    // Подсказку можно снять, передав null.
    const cleared = await updateDefinition(prisma, adminSession, created.definition.id, {
      helpText: null,
    });
    if (!cleared.ok) throw new Error('unexpected');
    expect(cleared.definition.helpText).toBeNull();

    await prisma.customFieldDefinition.delete({ where: { id: created.definition.id } });
  });

  it('createDefinition: руководитель тоже настраивает поля (§4 ТЗ)', async () => {
    const leaderSession = makeSession(managerSession.sub, 'manager', { managerRole: 'leader' });
    const res = await createDefinition(prisma, leaderSession, {
      entityType: ET,
      key: `by_leader_${stamp}`,
      label: 'Поле от руководителя',
      fieldType: 'text',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    await prisma.customFieldDefinition.delete({ where: { id: res.definition.id } });
  });
});

describe('definitions service', () => {
  it('admin-only: manager → forbidden on create', async () => {
    const res = await createDefinition(prisma, managerSession, {
      entityType: ET,
      key: 'some_field',
      label: 'Some',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('admin-only: partner → forbidden on create', async () => {
    const res = await createDefinition(prisma, partnerSession, {
      entityType: ET,
      key: 'some_field',
      label: 'Some',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('create happy path: text field', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'contract_ref',
      label: 'Договор',
      fieldType: 'text',
      sortOrder: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.key).toBe('contract_ref');
    expect(res.definition.fieldType).toBe('text');
    expect(res.definition.isActive).toBe(true);
  });

  it('invalid_key: key starts with digit', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: '1bad_key',
      label: 'Bad',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_key' });
  });

  it('invalid_key: key contains uppercase', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'Bad_Key',
      label: 'Bad',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_key' });
  });

  it('options_required: select without options', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'no_opts',
      label: 'Select',
      fieldType: 'select',
    });
    expect(res).toEqual({ ok: false, error: 'options_required' });
  });

  it('options_required: select with empty options array', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'no_opts2',
      label: 'Select2',
      fieldType: 'select',
      options: [],
    });
    expect(res).toEqual({ ok: false, error: 'options_required' });
  });

  it('create select field with options', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'priority',
      label: 'Приоритет',
      fieldType: 'select',
      options: ['low', 'medium', 'high'],
      sortOrder: 2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.options).toEqual(['low', 'medium', 'high']);
  });

  it('duplicate_key: same entityType+key → duplicate_key', async () => {
    const res = await createDefinition(prisma, adminSession, {
      entityType: ET,
      key: 'contract_ref', // already created above
      label: 'Dup',
      fieldType: 'text',
    });
    expect(res).toEqual({ ok: false, error: 'duplicate_key' });
  });

  it('listDefinitions: admin sees active+inactive', async () => {
    const res = await listDefinitions(prisma, adminSession, ET);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
    // ordered by sortOrder
    const sortOrders = res.rows.map((r) => r.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  it('getActiveDefinitions: no session required, returns only active', async () => {
    const rows = await getActiveDefinitions(prisma, ET);
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it('updateDefinition: changes label, sortOrder, required', async () => {
    // Get existing id
    const list = await listDefinitions(prisma, adminSession, ET);
    if (!list.ok) throw new Error('unexpected');
    const def = list.rows.find((r) => r.key === 'contract_ref');
    if (!def) throw new Error('def not found');

    const res = await updateDefinition(prisma, adminSession, def.id, {
      label: 'Номер договора',
      sortOrder: 10,
      required: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.label).toBe('Номер договора');
    expect(res.definition.sortOrder).toBe(10);
    expect(res.definition.required).toBe(true);
    // key and fieldType unchanged
    expect(res.definition.key).toBe('contract_ref');
  });

  it('updateDefinition: manager → forbidden', async () => {
    const list = await listDefinitions(prisma, adminSession, ET);
    if (!list.ok) throw new Error('unexpected');
    const def = list.rows[0]!;
    const res = await updateDefinition(prisma, managerSession, def.id, { label: 'X' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateDefinition: not_found for unknown id', async () => {
    const res = await updateDefinition(prisma, adminSession, 'nonexistent-id-xyz', { label: 'X' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('deactivateDefinition: sets isActive=false', async () => {
    const list = await listDefinitions(prisma, adminSession, ET);
    if (!list.ok) throw new Error('unexpected');
    const def = list.rows.find((r) => r.key === 'priority');
    if (!def) throw new Error('priority def not found');

    const res = await deactivateDefinition(prisma, adminSession, def.id);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.isActive).toBe(false);
  });

  it('deactivateDefinition: manager → forbidden', async () => {
    const list = await listDefinitions(prisma, adminSession, ET);
    if (!list.ok) throw new Error('unexpected');
    const def = list.rows[0]!;
    const res = await deactivateDefinition(prisma, managerSession, def.id);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('deactivateDefinition: not_found for unknown id', async () => {
    const res = await deactivateDefinition(prisma, adminSession, 'nonexistent-xyz');
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('getActiveDefinitions: deactivated def no longer appears', async () => {
    const rows = await getActiveDefinitions(prisma, ET);
    const keys = rows.map((r) => r.key);
    // 'priority' was deactivated above
    expect(keys).not.toContain('priority');
  });
});
