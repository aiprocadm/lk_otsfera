/**
 * Coverage-closure tests (Track E / E2) для домена customFields.
 *
 *   1. Default-ветка `validateFieldValue`. До этапа 1 ТЗ v0.5 функция была
 *      приватной в values.ts и доставалась только через setValues со стабом
 *      Prisma. Этап 1 вынес её в coerce.ts и экспортировал — ветка проверяется
 *      прямым вызовом, стаб больше не нужен.
 *
 *   2. `updateDefinition` с патчем, СОДЕРЖАЩИМ options (TRUE-сторона ветки):
 *      cov.customfields.test.ts закрывает только FALSE-сторону.
 *
 * Integration-уровень (`new PrismaClient()`), нужен живой Postgres.
 * Запуск: npm run test:integration -- cov2.customfields
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { CustomFieldType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createDefinition, updateDefinition } from '@/lib/services/customFields/definitions';
import { validateFieldValue } from '@/lib/services/customFields/coerce';

let prisma: PrismaClient;

const STAMP = Date.now();
// Этап 1 ТЗ v0.5: entityType — закрытый список (CUSTOM_FIELD_ENTITIES).
const ET = 'student';

let adminUserId: string;
let selectDefId: string;

function makeSession(
  userId: string,
  role: string,
  extra: Partial<SessionPayload> = {}
): SessionPayload {
  return { sub: userId, role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const admin = await prisma.user.create({
    data: {
      email: `cov2cf-admin-${STAMP}@t.local`,
      passwordHash: 'x',
      name: 'Cov2CF Admin',
      role: 'admin',
    },
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

describe('coerce — default arm of validateFieldValue', () => {
  it('validateFieldValue: тип вне enum → false (default-ветка)', () => {
    // Этап 1 ТЗ v0.5: валидация переехала из values.ts в coerce.ts и стала
    // экспортируемой — стаб Prisma для этой ветки больше не нужен. Реальная
    // строка такого fieldType не несёт (колонка — enum), поэтому зовём напрямую.
    const bogus = 'quantum' as unknown as CustomFieldType;
    expect(validateFieldValue(bogus, [], 'anything')).toBe(false);
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
