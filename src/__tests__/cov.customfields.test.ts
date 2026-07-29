/**
 * Coverage-closure tests (Track E / E1) for the customFields domain.
 *
 * Targets the exact uncovered lines/branches left after later feature tracks:
 *   - src/lib/services/customFields/definitions.ts
 *       lines 122-123,171-172,205-206 ; branches @ 46,49,121,146,149,170,204
 *   - src/lib/services/customFields/values.ts
 *       lines 104-105,138-139 ; branches @ 71,90,102,137,192,218
 *       (line 35 / branch 34 — `default:` in validateFieldValue — is genuinely
 *        unreachable defensive code: fieldType is a Prisma-enum column, exhaustive
 *        over the 5 known cases, so no real DB row can carry an out-of-enum value.)
 *   - src/app/api/admin/custom-fields/[id]/route.ts   lines 9-10 ; branches @ 8,18,37
 *   - src/app/api/admin/custom-fields/route.ts        branch @ 8
 *
 * This file is integration-tier (constructs `new PrismaClient()`): it exercises the
 * REAL definitions/values services against a live Postgres, plus a handful of
 * fake-prisma rethrow tests and fully-mocked route tests (barrel + guard mocked).
 *
 * The route tests mock the *barrel* `@/lib/services/customFields`; the service
 * integration tests import from the concrete submodules
 * `@/lib/services/customFields/definitions` and `.../values`, which resolve to
 * distinct modules and therefore stay REAL.
 *
 * Requires live Postgres. Run: npm run test:integration -- cov.customfields
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// ─── Route-only mocks (affect only the route imports below) ───────────────────
// The routes import the BARREL `@/lib/services/customFields` + `@/lib/auth/guard`
// + `@/lib/db/prisma`. Mocking these does NOT touch the real submodule imports
// used by the service integration tests (different module specifiers).
const { requireSession, requireFieldsAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireFieldsAdmin: vi.fn(),
}));
const { createDefinitionMock, updateDefinitionMock, deactivateDefinitionMock } = vi.hoisted(() => ({
  createDefinitionMock: vi.fn(),
  updateDefinitionMock: vi.fn(),
  deactivateDefinitionMock: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireFieldsAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/customFields', () => ({
  createDefinition: createDefinitionMock,
  updateDefinition: updateDefinitionMock,
  deactivateDefinition: deactivateDefinitionMock,
}));

// REAL services — imported from the concrete submodules (unmocked).
import {
  listDefinitions,
  createDefinition,
  updateDefinition,
  deactivateDefinition,
} from '@/lib/services/customFields/definitions';
import { getValuesForEntity, setValues } from '@/lib/services/customFields/values';

// Route handlers under test (their service/guard/prisma imports are mocked above).
import { POST } from '@/app/api/admin/custom-fields/route';
import { PATCH, DELETE } from '@/app/api/admin/custom-fields/[id]/route';

let prisma: PrismaClient;

const STAMP = Date.now();
// Этап 1 ТЗ v0.5: entityType — закрытый список (CUSTOM_FIELD_ENTITIES).
const ET = 'order'; // entityType with definitions (entityId ниже — реальный заказ)
const ET_EMPTY = 'document'; // entityType с определениями, невидимыми для этого entityId

// Created ids
let adminUserId: string;
let managerUserId: string;
let companyId: string;
let partnerId: string;
let organizationId: string;
let orderId: string; // real, admin-writable
let defTextId: string;

function makeSession(userId: string, role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const admin = await prisma.user.create({
    data: { email: `covcf-admin-${STAMP}@t.local`, passwordHash: 'x', name: 'CovCF Admin', role: 'admin' },
  });
  adminUserId = admin.id;

  const manager = await prisma.user.create({
    data: { email: `covcf-mgr-${STAMP}@t.local`, passwordHash: 'x', name: 'CovCF Manager', role: 'manager' },
  });
  managerUserId = manager.id;

  const company = await prisma.company.create({ data: { name: `CovCF-Co-${STAMP}` } });
  companyId = company.id;

  const partner = await prisma.partner.create({ data: { name: `CovCF-P-${STAMP}`, commissionRate: 0.1 } });
  partnerId = partner.id;

  const org = await prisma.organization.create({
    data: { name: `CovCF-Org-${STAMP}`, partnerId, companyId },
  });
  organizationId = org.id;

  const order = await prisma.order.create({
    data: {
      title: `CovCF-Order-${STAMP}`,
      orderNumber: `CovCF-ON-${STAMP}`,
      companyId,
      partnerId,
      organizationId,
      executionStatus: 'in_progress',
    },
  });
  orderId = order.id;

  // One text definition on ET (used by empty-values + empty-string tests).
  const adminSession = makeSession(adminUserId, 'admin');
  const dText = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'cov_note',
    label: 'Заметка',
    fieldType: 'text',
    sortOrder: 1,
  });
  if (!dText.ok) throw new Error('Failed to create text def');
  defTextId = dText.definition.id;
});

afterAll(async () => {
  const testOrders = await prisma.order.findMany({
    where: { title: { startsWith: 'CovCF-' } },
    select: { id: true },
  });
  const testOrderIds = testOrders.map((o) => o.id);
  if (testOrderIds.length > 0) {
    await prisma.customFieldValue.deleteMany({ where: { entityId: { in: testOrderIds } } });
  }
  // Чистим только СВОИ определения: entityType теперь общий для всех тестов
  // (закрытый список из пяти сущностей), удаление по нему снесло бы чужие.
  await prisma.customFieldDefinition.deleteMany({
    where: { entityType: { in: [ET, ET_EMPTY] }, key: { startsWith: 'cov_' } }
  });
  await prisma.customFieldDefinition.deleteMany({ where: { key: { in: ['valid_key'] } } });
  await prisma.order.deleteMany({ where: { title: { startsWith: 'CovCF-' } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'CovCF-' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'CovCF-' } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminUserId, managerUserId] } } });
  await prisma.user.deleteMany({ where: { email: { contains: 'covcf-' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: `CovCF-Co-${STAMP}` } } });
  await prisma.$disconnect();
});

// ─── definitions.ts — service branches (real DB) ─────────────────────────────

describe('definitions service — coverage closure', () => {
  it('listDefinitions: non-admin → forbidden (branch @46 true)', async () => {
    const mgr = makeSession(managerUserId, 'manager');
    const res = await listDefinitions(prisma, mgr, ET);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listDefinitions: admin without entityType → where:{} lists across types (branch @49 false)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await listDefinitions(prisma, adminSession);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    // Our ET def must be present when no entityType filter is applied.
    expect(res.rows.some((r) => r.id === defTextId)).toBe(true);
  });

  it('updateDefinition: patch with only isActive (branch @146 false + @149 true)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    // Patch omits label/options/required/sortOrder → those `!== undefined` guards
    // take the false side (146 among them); isActive present → 149 true side.
    const res = await updateDefinition(prisma, adminSession, defTextId, { isActive: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.isActive).toBe(true);
    expect(res.definition.label).toBe('Заметка'); // untouched
  });
});

// ─── definitions.ts — rethrow paths (fake prisma, no DB) ─────────────────────
// Non-P2002/non-P2025 errors must propagate (they are not mapped to a Result).

describe('definitions service — non-Prisma errors rethrow', () => {
  const adminSession = makeSession('admin-fake', 'admin');

  it('createDefinition: rethrows a non-P2002 error (lines 122-123, branch @121 false)', async () => {
    const boom = new Error('connection lost');
    const fakePrisma = {
      customFieldDefinition: { create: vi.fn().mockRejectedValue(boom) },
    } as unknown as PrismaClient;

    await expect(
      createDefinition(fakePrisma, adminSession, {
        // entityType обязан быть из закрытого списка (этап 1 ТЗ v0.5), иначе
        // сервис вернёт invalid_entity_type раньше обращения к БД.
        entityType: 'order',
        key: 'valid_key',
        label: 'L',
        fieldType: 'text',
      })
    ).rejects.toThrow('connection lost');
  });

  it('updateDefinition: rethrows a non-P2025 error (lines 171-172, branch @170 false)', async () => {
    const boom = new Error('deadlock detected');
    const fakePrisma = {
      customFieldDefinition: { update: vi.fn().mockRejectedValue(boom) },
    } as unknown as PrismaClient;

    await expect(
      updateDefinition(fakePrisma, adminSession, 'some-id', { label: 'X' })
    ).rejects.toThrow('deadlock detected');
  });

  it('deactivateDefinition: rethrows a non-P2025 error (lines 205-206, branch @204 false)', async () => {
    const boom = new Error('statement timeout');
    const fakePrisma = {
      customFieldDefinition: { update: vi.fn().mockRejectedValue(boom) },
    } as unknown as PrismaClient;

    await expect(
      deactivateDefinition(fakePrisma, adminSession, 'some-id')
    ).rejects.toThrow('statement timeout');
  });
});

// ─── values.ts — service branches (real DB, except the pure forbidden path) ──

describe('values service — coverage closure', () => {
  it('getValuesForEntity: entityType with no active defs → empty fields (branch @137 true, lines 138-139)', async () => {
    const res = await getValuesForEntity(prisma, makeSession(adminUserId, 'admin'), ET_EMPTY, orderId);
    expect(res).toEqual({ ok: true, fields: [] });
  });

  it('setValues: admin + non-existent order → not_found (branch @71 true)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, 'no-such-order-id', {
      [defTextId]: 'x',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('setValues: manager + non-existent order → not_found (branch @90 true)', async () => {
    // Real companyId exercises getCompanyTeamVisibility; the order lookup misses.
    const mgr = makeSession(managerUserId, 'manager', {
      companyId,
      managedOrgIds: [organizationId],
    });
    const res = await setValues(prisma, mgr, ET, 'no-such-order-id', {
      [defTextId]: 'x',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('setValues: unexpected role → forbidden fallthrough (branch @102, lines 104-105)', async () => {
    // A role outside {admin,manager,organization,partner,student} hits the final
    // defensive `return { ok: false, error: 'forbidden' }` before any DB access.
    const weird = makeSession('weird-user', 'leader');
    const res = await setValues(prisma, weird, ET, orderId, { [defTextId]: 'x' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('setValues: empty values object → ok early return (branch @192 true)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, {});
    expect(res).toEqual({ ok: true });
  });

  it('setValues: empty-string value is stored as null (branch @218 true)', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await setValues(prisma, adminSession, ET, orderId, { [defTextId]: '' });
    expect(res).toEqual({ ok: true });
    const row = await prisma.customFieldValue.findUnique({
      where: { definitionId_entityId: { definitionId: defTextId, entityId: orderId } },
    });
    expect(row?.value).toBeNull();
  });
});

// ─── route error-mapping branches (fully mocked services + guard) ────────────

const adminSession = { sub: 'admin-1', role: 'admin' };

describe('custom-fields routes — error-mapping coverage', () => {
  // Clear the route mocks between route tests (integration tests above never call them).
  beforeEach(() => {
    requireSession.mockReset();
    requireFieldsAdmin.mockReset();
    createDefinitionMock.mockReset();
    updateDefinitionMock.mockReset();
    deactivateDefinitionMock.mockReset();
  });

  it('POST: service not_found maps to 404 (route.ts mapErr branch @8 not_found true)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireFieldsAdmin.mockReturnValue({ ok: true, value: adminSession });
    createDefinitionMock.mockResolvedValue({ ok: false, error: 'not_found' });

    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'order', key: 'k', label: 'L', fieldType: 'text' }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('PATCH: non-forbidden/non-not_found error maps to 400 ([id] mapErr lines 9-10, branch @8 false)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireFieldsAdmin.mockReturnValue({ ok: true, value: adminSession });
    // updateDefinition never returns this in prod, but the route mapper must still
    // fall through to the 400 default for any non-{forbidden,not_found} code.
    updateDefinitionMock.mockResolvedValue({ ok: false, error: 'invalid_key' });

    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: 'X' }) });
    const res = await PATCH(req as Request, { params: Promise.resolve({ id: 'cf1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_key');
  });

  it('PATCH: admin guard failure returns its response ([id] branch @18 true)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireFieldsAdmin.mockReturnValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });

    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: 'X' }) });
    const res = await PATCH(req as Request, { params: Promise.resolve({ id: 'cf1' }) });
    expect(res.status).toBe(403);
    expect(updateDefinitionMock).not.toHaveBeenCalled();
  });

  it('DELETE: admin guard failure returns its response ([id] branch @37 true)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireFieldsAdmin.mockReturnValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });

    const req = new Request('http://x', { method: 'DELETE' });
    const res = await DELETE(req as Request, { params: Promise.resolve({ id: 'cf1' }) });
    expect(res.status).toBe(403);
    expect(deactivateDefinitionMock).not.toHaveBeenCalled();
  });
});
