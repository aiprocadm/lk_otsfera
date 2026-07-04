/**
 * Coverage-closure tests (Track E / E2) for the customFields domain — the two
 * branches left open after cov.customfields.test.ts:
 *
 *   1. src/lib/services/customFields/values.ts @34-35
 *      `default: return false` in the field-type switch of validateFieldValue.
 *      validateFieldValue is module-private and only reachable through setValues,
 *      which reads `fieldType` off rows returned by prisma.customFieldDefinition
 *      .findMany. Against a REAL Postgres the column is an enum constrained to the
 *      5 known cases, so no genuine row can carry an out-of-enum value — which is
 *      why cov.customfields.test.ts declared this arm unreachable. Here we reach it
 *      with a *stub* Prisma (same fake-prisma pattern as the rethrow tests in that
 *      file): the stub's findMany yields a definition whose fieldType is an
 *      unsupported value (cast), driving the switch into its default arm so
 *      setValues returns invalid_value.
 *
 *   2. src/lib/services/customFields/definitions.ts @146
 *      `if (patch.options !== undefined) data.options = patch.options` — the TRUE
 *      side. cov.customfields.test.ts only exercised the FALSE side (a patch that
 *      omits options). Here we call updateDefinition with a patch that INCLUDES
 *      options on a real `select` definition and assert the new options persist.
 *
 * Integration-tier (constructs `new PrismaClient()`): branch 2 runs the REAL
 * updateDefinition service against a live Postgres. Branch 1 uses a fully-stubbed
 * Prisma and needs no DB, but lives here so the whole file is one integration
 * unit. Requires live Postgres. Run: npm run test:integration -- cov2.customfields
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { CustomFieldType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createDefinition, updateDefinition } from '@/lib/services/customFields/definitions';
import { setValues } from '@/lib/services/customFields/values';

let prisma: PrismaClient;

const STAMP = Date.now();
const ET = `cov2_cf_${STAMP}`;

let adminUserId: string;
let selectDefId: string;

function makeSession(userId: string, role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const admin = await prisma.user.create({
    data: { email: `cov2cf-admin-${STAMP}@t.local`, passwordHash: 'x', name: 'Cov2CF Admin', role: 'admin' },
  });
  adminUserId = admin.id;

  // A real select definition (branch 2 will mutate its options).
  const adminSession = makeSession(adminUserId, 'admin');
  const dSelect = await createDefinition(prisma, adminSession, {
    entityType: ET,
    key: 'priority',
    label: 'Приоритет',
    fieldType: 'select',
    options: ['low', 'medium'],
    sortOrder: 1,
  });
  if (!dSelect.ok) throw new Error('Failed to create select def');
  selectDefId = dSelect.definition.id;
});

afterAll(async () => {
  await prisma.customFieldDefinition.deleteMany({ where: { entityType: ET } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { email: { contains: 'cov2cf-' } } });
  await prisma.$disconnect();
});

// ─── values.ts @34-35 — default arm of validateFieldValue ────────────────────

describe('values service — validateFieldValue default arm (branch @34)', () => {
  it('setValues: unsupported fieldType → invalid_value (default: return false)', async () => {
    // Stub Prisma: admin scope-resolve succeeds (order.findUnique returns a row),
    // and the definition lookup yields a fieldType outside the 5 enum cases so
    // validateFieldValue falls through to `default: return false`.
    const DEF_ID = 'stub-def-unknown-type';
    const upsert = vi.fn();
    const stubPrisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'stub-order',
          managerId: null,
          organizationId: null,
          companyId: null,
        }),
      },
      customFieldDefinition: {
        findMany: vi.fn().mockResolvedValue([
          // fieldType is an out-of-enum value — cast to satisfy the signature.
          { id: DEF_ID, fieldType: 'quantum' as unknown as CustomFieldType, options: [] },
        ]),
      },
      // Not reached: invalid_value returns before any upsert/audit.
      customFieldValue: { upsert },
    } as unknown as PrismaClient;

    const adminSession = makeSession('admin-stub', 'admin');
    const res = await setValues(stubPrisma, adminSession, ET, 'stub-order', {
      // Non-null / non-empty so validation is actually invoked for this def.
      [DEF_ID]: 'anything',
    });

    expect(res).toEqual({ ok: false, error: 'invalid_value' });
    // No write happened — validation rejected before the upsert loop.
    expect(upsert).not.toHaveBeenCalled();
  });
});

// ─── definitions.ts @146 — patch.options TRUE side ───────────────────────────

describe('definitions service — updateDefinition options patch (branch @146 true)', () => {
  it('updateDefinition: patch including options persists the new options array', async () => {
    const adminSession = makeSession(adminUserId, 'admin');
    const res = await updateDefinition(prisma, adminSession, selectDefId, {
      options: ['low', 'medium', 'high', 'critical'],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.definition.options).toEqual(['low', 'medium', 'high', 'critical']);

    // Persisted in the DB, not just echoed.
    const row = await prisma.customFieldDefinition.findUnique({ where: { id: selectDefId } });
    expect(row?.options).toEqual(['low', 'medium', 'high', 'critical']);
    // Untouched fields stay put.
    expect(row?.label).toBe('Приоритет');
    expect(row?.fieldType).toBe('select');
  });
});
