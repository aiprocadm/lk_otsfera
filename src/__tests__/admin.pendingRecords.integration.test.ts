/**
 * Integration test: admin viewer + requeue for 1C pending records (G1).
 *
 * Verifies against a live Postgres:
 * 1. listPendingRecords — admin-only, dead-first ordering, rows carry no dto
 *    (raw 1C PII stays server-side).
 * 2. requeueDeadRecord — dead → pending with attempts reset to 0 (the replay
 *    budget starts over) + audit trail 'one_c_pending_requeued'.
 * 3. requeue of a non-dead record → not_dead; unknown id → not_found.
 *
 * Auto-detected as integration (contains `new PrismaClient(`) → runs via
 * `npm run test:integration` against a live Postgres.
 *
 * Uses unique externalIds (prefix 'APR-') and a unique admin email to avoid
 * cross-test collision on the shared database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPendingRecords, requeueDeadRecord } from '@/lib/services/admin/pendingRecords';
import type { SessionPayload } from '@/lib/auth/jwt';

const db = new PrismaClient();

const EXT_PENDING = 'APR-PENDING-1';
const EXT_DEAD = 'APR-DEAD-1';
const ADMIN_EMAIL = 'apr-admin@test.local';

let adminUserId: string;
let ADMIN: SessionPayload;
const MANAGER: SessionPayload = { sub: 'apr-not-admin', role: 'manager' };

async function cleanupRecords() {
  await db.oneCPendingRecord.deleteMany({
    where: { externalId: { in: [EXT_PENDING, EXT_DEAD] } },
  });
}

beforeAll(async () => {
  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: { email: ADMIN_EMAIL, name: 'APR Admin', role: 'admin' },
  });
  adminUserId = admin.id;
  ADMIN = { sub: adminUserId, role: 'admin' };
});

beforeEach(async () => {
  await cleanupRecords();
  await db.auditLog.deleteMany({
    where: { userId: adminUserId, action: 'one_c_pending_requeued' },
  });
});

afterAll(async () => {
  await cleanupRecords();
  await db.auditLog.deleteMany({
    where: { userId: adminUserId, action: 'one_c_pending_requeued' },
  });
  await db.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  await db.$disconnect();
});

/** Seed one pending and one dead record; returns their ids. */
async function seedPair(): Promise<{ pendingId: string; deadId: string }> {
  const pending = await db.oneCPendingRecord.create({
    data: {
      entity: 'payment',
      externalId: EXT_PENDING,
      dto: { externalId: EXT_PENDING, secret: 'raw-1c-pii' },
      reason: 'organization_not_found',
      attempts: 2,
      status: 'pending',
    },
  });
  const dead = await db.oneCPendingRecord.create({
    data: {
      entity: 'order',
      externalId: EXT_DEAD,
      dto: { externalId: EXT_DEAD, secret: 'raw-1c-pii' },
      reason: 'organization_not_found',
      attempts: 5,
      status: 'dead',
    },
  });
  return { pendingId: pending.id, deadId: dead.id };
}

describe('admin pending records (integration)', () => {
  it('listPendingRecords: не-admin → forbidden', async () => {
    const res = await listPendingRecords(db, MANAGER);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listPendingRecords: dead-first сортировка, строки без dto', async () => {
    const { pendingId, deadId } = await seedPair();

    const res = await listPendingRecords(db, ADMIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ours = res.records.filter((r) => r.externalId.startsWith('APR-'));
    expect(ours.map((r) => r.id)).toEqual([deadId, pendingId]); // 'dead' < 'pending' лексикографически

    for (const row of ours) {
      expect(row).not.toHaveProperty('dto'); // сырые ПДн из 1С не покидают сервис
      expect(Object.keys(row).sort()).toEqual([
        'attempts',
        'entity',
        'externalId',
        'firstSeenAt',
        'id',
        'lastTriedAt',
        'reason',
        'status',
      ]);
    }

    const dead = ours[0];
    expect(dead).toMatchObject({
      entity: 'order',
      externalId: EXT_DEAD,
      reason: 'organization_not_found',
      attempts: 5,
      status: 'dead',
    });
    expect(dead.firstSeenAt).toBeInstanceOf(Date);
    expect(dead.lastTriedAt).toBeInstanceOf(Date);
  });

  it('requeueDeadRecord: dead → pending, attempts=0, аудит one_c_pending_requeued', async () => {
    const { deadId } = await seedPair();

    const res = await requeueDeadRecord(db, ADMIN, deadId);
    expect(res).toEqual({ ok: true });

    const row = await db.oneCPendingRecord.findUnique({ where: { id: deadId } });
    expect(row).toMatchObject({ status: 'pending', attempts: 0 });
    // dto остаётся нетронутым — replay воспроизведёт его verbatim
    expect(row?.dto).toMatchObject({ externalId: EXT_DEAD });

    const audit = await db.auditLog.findFirst({
      where: { userId: adminUserId, action: 'one_c_pending_requeued', entityId: deadId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entity).toBe('one_c_pending');
  });

  it('requeueDeadRecord: pending-запись → not_dead (без изменений)', async () => {
    const { pendingId } = await seedPair();

    const res = await requeueDeadRecord(db, ADMIN, pendingId);
    expect(res).toEqual({ ok: false, error: 'not_dead' });

    const row = await db.oneCPendingRecord.findUnique({ where: { id: pendingId } });
    expect(row).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it('requeueDeadRecord: несуществующий id → not_found; не-admin → forbidden', async () => {
    expect(await requeueDeadRecord(db, ADMIN, 'apr-missing-id')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await requeueDeadRecord(db, MANAGER, 'apr-missing-id')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
