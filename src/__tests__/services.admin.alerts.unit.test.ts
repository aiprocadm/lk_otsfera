/**
 * Unit tests for src/lib/services/admin/alerts.ts (G2).
 * Result-паттерн forbidden + точные параметры запроса — по образцу
 * services.admin.piiAccess.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { listAlertStates } from '@/lib/services/admin/alerts';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN: SessionPayload = { sub: 'adm', role: 'admin' };
const MANAGER: SessionPayload = { sub: 'mgr', role: 'manager' };

function alertRow(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    status: 'firing',
    severity: 'critical',
    message: 'DLQ переполнен',
    value: 12,
    firstSeenAt: new Date('2026-07-16T10:00:00Z'),
    lastNotifiedAt: new Date('2026-07-16T10:05:00Z'),
    resolvedAt: null,
    updatedAt: new Date('2026-07-16T10:05:00Z'),
    ...over
  };
}

function makePrisma(rows: ReturnType<typeof alertRow>[] = []) {
  return {
    alertState: {
      findMany: vi.fn().mockResolvedValue(rows)
    }
  } as never;
}

describe('listAlertStates', () => {
  it('не-admin → forbidden, без запроса к БД', async () => {
    const p = makePrisma();
    const res = await listAlertStates(p, MANAGER);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect((p as any).alertState.findMany).not.toHaveBeenCalled();
  });

  it('admin → ok со строками алертов как есть', async () => {
    const rows = [alertRow('dlq_depth'), alertRow('sync_lag', { status: 'resolved', severity: 'warning', resolvedAt: new Date('2026-07-16T11:00:00Z') })];
    const res = await listAlertStates(makePrisma(rows), ADMIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.alerts).toHaveLength(2);
    expect(res.alerts[0]).toMatchObject({ key: 'dlq_depth', status: 'firing', severity: 'critical', value: 12 });
    expect(res.alerts[1]).toMatchObject({ key: 'sync_lag', status: 'resolved', severity: 'warning' });
  });

  it('запрос: firing-первые (status asc), свежие сверху (updatedAt desc), cap 100', async () => {
    const p = makePrisma();
    await listAlertStates(p, ADMIN);
    expect((p as any).alertState.findMany).toHaveBeenCalledWith({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100
    });
  });
});
