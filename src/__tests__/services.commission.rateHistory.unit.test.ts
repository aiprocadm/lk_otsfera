/**
 * G4 — unit-тесты listOrgRateHistory (история орг-ставки комиссии) на mocked
 * prisma. Стиль зеркалит services.commission.corrections.unit.test.ts.
 * Integration-двойник (live Postgres) — в services.commission.rateHistory.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrgRateHistory } from '@/lib/services/commission/rateHistory';

const dec = (n: string) => new Prisma.Decimal(n);

function makeSession(role: SessionPayload['role']): SessionPayload {
  return { sub: 'session-sub', role } as SessionPayload;
}

function makeDb(changes: unknown[], users: unknown[] = []) {
  return {
    organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue(changes) },
    user: { findMany: vi.fn().mockResolvedValue(users) },
  } as any;
}

function changeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    oldRate: dec('0.05'),
    newRate: dec('0.10'),
    effectiveFrom: new Date('2026-03-01T00:00:00Z'),
    changedById: null,
    ...over,
  };
}

describe('listOrgRateHistory (unit)', () => {
  it('returns forbidden for manager session without touching the db', async () => {
    const db = makeDb([]);
    const result = await listOrgRateHistory(db, makeSession('manager'), 'org-1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(db.organizationCommissionRateChange.findMany).not.toHaveBeenCalled();
  });

  it('returns forbidden for partner session', async () => {
    const db = makeDb([]);
    const result = await listOrgRateHistory(db, makeSession('partner'), 'org-1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('queries by organizationId ordered by effectiveFrom desc', async () => {
    const db = makeDb([]);
    const result = await listOrgRateHistory(db, makeSession('admin'), 'org-42');
    expect(result).toEqual({ ok: true, rows: [] });
    expect(db.organizationCommissionRateChange.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-42' },
      orderBy: { effectiveFrom: 'desc' },
    });
  });

  it('converts Decimal to number and passes null through for BOTH oldRate and newRate', async () => {
    const effectiveA = new Date('2026-04-01T00:00:00Z');
    const effectiveB = new Date('2026-01-01T00:00:00Z');
    const db = makeDb([
      // «Сброс к ставке партнёра»: newRate null, oldRate задан.
      changeRow({ id: 'ch-reset', oldRate: dec('0.07'), newRate: null, effectiveFrom: effectiveA }),
      // Первичная установка: oldRate null, newRate задан.
      changeRow({ id: 'ch-init', oldRate: null, newRate: dec('0.07'), effectiveFrom: effectiveB }),
    ]);

    const result = await listOrgRateHistory(db, makeSession('admin'), 'org-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toEqual([
      {
        id: 'ch-reset',
        oldRate: 0.07,
        newRate: null,
        effectiveFrom: effectiveA,
        changedByName: null,
      },
      {
        id: 'ch-init',
        oldRate: null,
        newRate: 0.07,
        effectiveFrom: effectiveB,
        changedByName: null,
      },
    ]);
    // Все changedById = null → батч-запрос имён не выполняется вовсе.
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('batch-resolves changedByName via a single deduplicated user.findMany', async () => {
    const db = makeDb(
      [
        changeRow({ id: 'ch-3', changedById: 'u-1' }),
        changeRow({ id: 'ch-2', changedById: 'u-1' }),
        changeRow({ id: 'ch-1', changedById: 'u-2' }),
      ],
      [
        { id: 'u-1', name: 'Admin One' },
        { id: 'u-2', name: 'Admin Two' },
      ]
    );

    const result = await listOrgRateHistory(db, makeSession('admin'), 'org-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      select: { id: true, name: true },
    });
    expect(result.rows.map((r) => r.changedByName)).toEqual([
      'Admin One',
      'Admin One',
      'Admin Two',
    ]);
  });

  it('resolves changedByName=null for a dangling changedById (map miss)', async () => {
    // changedById truthy, но пользователя нет → nameById.get() undefined → ?? null.
    const db = makeDb([changeRow({ id: 'ch-ghost', changedById: 'ghost-user' })], []);
    const result = await listOrgRateHistory(db, makeSession('admin'), 'org-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].changedByName).toBeNull();
  });
});


/**
 * `У-99`: историю ставки видит и руководитель — но только по организациям
 * СВОЕЙ компании (C8). Раньше сервис отвечал `forbidden` всем, кроме админа, и
 * руководителю приходилось просить админа посмотреть за него.
 */
describe('listOrgRateHistory — руководитель (У-99, граница компании C8)', () => {
  function makeDbWithOrg(orgCompanyId: string | null, changes: unknown[] = []) {
    return {
      organization: { findUnique: vi.fn().mockResolvedValue(orgCompanyId === null ? null : { companyId: orgCompanyId }) },
      organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue(changes) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;
  }

  const leader = (companyId: string | null) =>
    ({ sub: 'leader-1', role: 'leader', companyId }) as SessionPayload;

  it('своя компания: историю отдаёт', async () => {
    const db = makeDbWithOrg('co-1', [changeRow()]);
    const result = await listOrgRateHistory(db, leader('co-1'), 'org-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });

  it('чужая компания: forbidden и историю не читает', async () => {
    const db = makeDbWithOrg('co-2', [changeRow()]);
    const result = await listOrgRateHistory(db, leader('co-1'), 'org-1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(db.organizationCommissionRateChange.findMany).not.toHaveBeenCalled();
  });

  it('организации нет: forbidden (существование чужой орг не подтверждаем)', async () => {
    const db = makeDbWithOrg(null);
    const result = await listOrgRateHistory(db, leader('co-1'), 'org-1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('руководитель без компании: forbidden, в базу не ходим', async () => {
    const db = makeDbWithOrg('co-1');
    const result = await listOrgRateHistory(db, leader(null), 'org-1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(db.organization.findUnique).not.toHaveBeenCalled();
  });
});
