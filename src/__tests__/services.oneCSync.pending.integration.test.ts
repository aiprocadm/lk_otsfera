/**
 * Integration test: pending record capture + replay (store-and-replay feature)
 *
 * Verifies two end-to-end scenarios:
 * 1. Recovery — a payment that skipped due to a missing org is captured as pending
 *    and resolved (Payment created) once the org appears.
 * 2. Dead-letter — a record at the attempt cap is dead-lettered when the dependency
 *    never appears.
 *
 * Auto-detected as integration (contains `new PrismaClient(`) → runs via
 * `npm run test:integration` against a live Postgres.
 *
 * Uses unique externalIds/inns (prefix 'pit-') to avoid cross-test collision.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { upsertPaymentRecord } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

const db = new PrismaClient();

// Unique test-scope inn and externalIds so shared Postgres stays collision-free.
const INN_RECOVERY = '7799990001';
const INN_DEAD = '0000000000';
const EXT_PAY_X = 'PAY-PIT-X';
const EXT_PAY_Y = 'PAY-PIT-Y';

/** Delete all rows this test suite may have written, in FK-safe order. */
async function cleanup() {
  await db.oneCPendingRecord.deleteMany({
    where: { externalId: { in: [EXT_PAY_X, EXT_PAY_Y] } },
  });
  await db.payment.deleteMany({
    where: { externalId: { in: [EXT_PAY_X, EXT_PAY_Y] } },
  });
  // Delete any org with this inn (includes payments via cascade-free FK — payments
  // are already removed above, so FK constraint is satisfied).
  await db.organization.deleteMany({ where: { inn: INN_RECOVERY } });
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

describe('pending store-and-replay (integration)', () => {
  it('recovery — payment skipped before its org is recovered once the org appears', async () => {
    // ── Step A: process the payment — org missing → skip ──────────────────────
    const paymentDto = {
      externalId: EXT_PAY_X,
      amount: 1000,
      paidAt: '2026-06-01T00:00:00Z',
      isRefund: false,
      organizationInn: INN_RECOVERY,
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const sumA = emptySummary();
    await upsertPaymentRecord(db, paymentDto, sumA, { mode: 'live', notify: false });
    expect(sumA.skipped).toBe(1);
    expect(sumA.skips[0]?.reason).toBe('organization_not_found');

    // ── Step B: capture the transient skip as a pending record ─────────────────
    await capturePendingSkips(db, 'payment', [paymentDto], (d) => d.externalId, sumA);

    const pendingCount = await db.oneCPendingRecord.count({
      where: { entity: 'payment', status: 'pending' },
    });
    expect(pendingCount).toBe(1);

    // ── Step C: the org arrives ────────────────────────────────────────────────
    await db.organization.create({
      data: {
        name: 'ООО Recovered',
        inn: INN_RECOVERY,
        // No companyId/partnerId required for resolveOrganizationRef (INN-match path)
      },
    });

    // ── Step D: replay — the pending payment should be resolved ───────────────
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-02T00:00:00Z'),
    });

    expect(res.resolved).toBe(1);

    const payCount = await db.payment.count({ where: { externalId: EXT_PAY_X } });
    expect(payCount).toBe(1);

    const remainingPending = await db.oneCPendingRecord.count({
      where: { externalId: EXT_PAY_X },
    });
    expect(remainingPending).toBe(0);
  });

  it('dead-letter — dead-letters after the attempt cap when the dependency never appears', async () => {
    // Pre-seed a pending row already at attempts = 49 (one replay will bring it to 50).
    const dto = {
      externalId: EXT_PAY_Y,
      amount: 1,
      paidAt: '2026-06-01T00:00:00Z',
      isRefund: false,
      organizationInn: INN_DEAD,
      updatedAt: '2026-06-01T00:00:00Z',
    };

    await db.oneCPendingRecord.create({
      data: {
        entity: 'payment',
        externalId: EXT_PAY_Y,
        dto,
        reason: 'organization_not_found',
        attempts: 49,
      },
    });

    // Replay with maxAttempts=50; this attempt brings attempts to 50 → dead-letter.
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-02T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });

    expect(res.deadLettered).toBe(1);

    const row = await db.oneCPendingRecord.findUnique({
      where: { entity_externalId: { entity: 'payment', externalId: EXT_PAY_Y } },
    });
    expect(row?.status).toBe('dead');
  });
});
