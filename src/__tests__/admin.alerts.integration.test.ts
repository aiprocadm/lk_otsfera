/**
 * Integration test: алерты + построчные ошибки синхронизации на /admin/health (G2).
 *
 * Verifies against a live Postgres:
 * 1. listAlertStates — admin-only, firing-first ordering (status asc,
 *    updatedAt desc), все поля модели AlertState в ответе.
 * 2. listSyncErrors — только status='error', свежие сверху, и payload
 *    НЕ покидает сервис (сырые ПДн из 1С остаются в БД).
 *
 * Auto-detected as integration (contains `new PrismaClient(`) → runs via
 * `npm run test:integration` against a live Postgres.
 *
 * Uses unique key/externalId prefixes ('G2A-') to avoid cross-test collision
 * on the shared database.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listAlertStates } from '@/lib/services/admin/alerts';
import { listSyncErrors } from '@/lib/services/syncSummary';
import type { SessionPayload } from '@/lib/auth/jwt';

const db = new PrismaClient();

const ADMIN: SessionPayload = { sub: 'g2a-admin', role: 'admin' };
const MANAGER: SessionPayload = { sub: 'g2a-not-admin', role: 'manager' };

const KEY_FIRING = 'G2A-firing-alert';
const KEY_RESOLVED = 'G2A-resolved-alert';
const EXT_ERROR = 'G2A-ERR-1';
const EXT_OK = 'G2A-OK-1';

async function cleanup() {
  await db.alertState.deleteMany({ where: { key: { startsWith: 'G2A-' } } });
  await db.syncLog.deleteMany({ where: { externalId: { startsWith: 'G2A-' } } });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe('admin alerts + sync errors (integration)', () => {
  it('listAlertStates: не-admin → forbidden', async () => {
    const res = await listAlertStates(db, MANAGER);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listAlertStates: firing раньше resolved, все поля модели в строке', async () => {
    // resolved создаём ПОЗЖЕ firing (свежее updatedAt) — проверяем, что
    // первична сортировка по статусу, а не по времени.
    await db.alertState.create({
      data: {
        key: KEY_FIRING,
        status: 'firing',
        severity: 'critical',
        message: 'G2A: DLQ переполнен',
        value: 42,
      },
    });
    await db.alertState.create({
      data: {
        key: KEY_RESOLVED,
        status: 'resolved',
        severity: 'warning',
        message: 'G2A: лаг синхронизации',
        value: null,
        resolvedAt: new Date(),
      },
    });

    const res = await listAlertStates(db, ADMIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ours = res.alerts.filter((a) => a.key.startsWith('G2A-'));
    expect(ours.map((a) => a.key)).toEqual([KEY_FIRING, KEY_RESOLVED]); // 'firing' < 'resolved'

    const firing = ours[0];
    expect(firing).toMatchObject({
      key: KEY_FIRING,
      status: 'firing',
      severity: 'critical',
      message: 'G2A: DLQ переполнен',
      value: 42,
      resolvedAt: null,
    });
    expect(firing.firstSeenAt).toBeInstanceOf(Date);
    expect(firing.lastNotifiedAt).toBeInstanceOf(Date);
    expect(firing.updatedAt).toBeInstanceOf(Date);

    const resolved = ours[1];
    expect(resolved).toMatchObject({ status: 'resolved', severity: 'warning', value: null });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it('listSyncErrors: только error-строки, свежие сверху, без payload в ответе', async () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await db.syncLog.create({
      data: {
        createdAt: older,
        entity: 'payment',
        externalId: EXT_ERROR,
        direction: 'inbound',
        operation: 'upsert',
        status: 'error',
        errorMessage: 'G2A: timeout calling 1C',
        payload: { externalId: EXT_ERROR, secret: 'raw-1c-pii' },
        durationMs: 1200,
      },
    });
    await db.syncLog.create({
      data: {
        createdAt: newer,
        entity: 'order',
        externalId: `${EXT_ERROR}-2`,
        direction: 'inbound',
        operation: 'upsert',
        status: 'error',
        errorMessage: 'G2A: parse failed',
        payload: { secret: 'raw-1c-pii' },
        durationMs: null,
      },
    });
    await db.syncLog.create({
      data: {
        entity: 'payment',
        externalId: EXT_OK,
        direction: 'inbound',
        operation: 'upsert',
        status: 'success',
        payload: { secret: 'raw-1c-pii' },
      },
    });

    const rows = await listSyncErrors(db);
    const ours = rows.filter((r) => r.externalId?.startsWith('G2A-'));

    // success-строка не попадает; свежая ошибка первой
    expect(ours.map((r) => r.externalId)).toEqual([`${EXT_ERROR}-2`, EXT_ERROR]);

    for (const row of ours) {
      expect(row).not.toHaveProperty('payload'); // сырые ПДн из 1С не покидают сервис
      expect(Object.keys(row).sort()).toEqual([
        'createdAt',
        'direction',
        'durationMs',
        'entity',
        'errorMessage',
        'externalId',
        'id',
        'operation',
      ]);
    }

    expect(ours[1]).toMatchObject({
      entity: 'payment',
      externalId: EXT_ERROR,
      direction: 'inbound',
      operation: 'upsert',
      errorMessage: 'G2A: timeout calling 1C',
      durationMs: 1200,
    });
    expect(ours[0].durationMs).toBeNull();
  });
});
