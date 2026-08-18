/**
 * Unit tests for src/lib/services/manager/team.ts
 * Covers listManagersForOrg and listCompanyManagers via mock-prisma.
 * The integration test (services.manager.team.test.ts) requires live Postgres
 * and is in the integration tier; this file covers the same logic via mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import { listManagersForOrg, listCompanyManagers } from '@/lib/services/manager/team';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRow(id: string, isActive: boolean, deactivatedAt: Date | null = null) {
  return {
    id,
    organizationId: 'org-1',
    userId: `user-${id}`,
    isActive,
    deactivatedAt,
    assignedAt: new Date('2026-01-01'),
    assignedBy: null,
    user: {
      id: `user-${id}`,
      name: `User ${id}`,
      email: `${id}@t.local`,
      isActive: true,
    },
  };
}

function prismaWith(rows: ReturnType<typeof makeRow>[]) {
  return {
    organizationManager: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as never;
}

// ─── listManagersForOrg ────────────────────────────────────────────────────────

describe('listManagersForOrg', () => {
  it('returns empty buckets for an org with no assignments', async () => {
    const p = prismaWith([]);
    const result = await listManagersForOrg(p, 'org-1');
    expect(result).toEqual({ active: [], inactive: [] });
  });

  it('splits rows into active and inactive buckets', async () => {
    const p = prismaWith([
      makeRow('a', true),
      makeRow('b', false, new Date('2026-04-01')),
      makeRow('c', false, new Date('2026-01-01')),
    ]);
    const { active, inactive } = await listManagersForOrg(p, 'org-1');
    expect(active).toHaveLength(1);
    expect(active[0].isActive).toBe(true);
    expect(inactive).toHaveLength(2);
    expect(inactive.every((r) => !r.isActive)).toBe(true);
  });

  it('sorts inactive bucket by deactivatedAt desc (most recently deactivated first)', async () => {
    const older = makeRow('old', false, new Date('2026-01-15'));
    const newer = makeRow('new', false, new Date('2026-05-20'));
    const p = prismaWith([older, newer]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    expect(inactive[0].id).toBe('new');
    expect(inactive[1].id).toBe('old');
  });

  it('places rows with deactivatedAt=null last in inactive bucket (treated as epoch 0)', async () => {
    const nullDate = makeRow('null', false, null);
    const withDate = makeRow('dated', false, new Date('2025-01-01'));
    const p = prismaWith([nullDate, withDate]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    // withDate is more recent than epoch 0, so it goes first
    expect(inactive[0].id).toBe('dated');
    expect(inactive[1].id).toBe('null');
  });

  it('handles deactivatedAt=null in the comparator b-slot (dated first, null second)', async () => {
    // For a 2-element array V8 calls comparator(arr[0], arr[1]) exactly once, so
    // putting the null-date row SECOND forces it into the `b` position and covers
    // the `b.deactivatedAt?.getTime() ?? 0` branch (the `a`-slot null branch is
    // covered by the test above).
    const withDate = makeRow('dated', false, new Date('2025-06-01'));
    const nullDate = makeRow('null', false, null);
    const p = prismaWith([withDate, nullDate]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    expect(inactive[0].id).toBe('dated');
    expect(inactive[1].id).toBe('null');
  });

  it('all active rows retain the nested user payload', async () => {
    const p = prismaWith([makeRow('x', true)]);
    const { active } = await listManagersForOrg(p, 'org-1');
    expect(active[0].user.email).toBe('x@t.local');
    expect(active[0].user.name).toBe('User x');
  });
});

// ─── listCompanyManagers ───────────────────────────────────────────────────────

function companyUser(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Mgr ${id}`,
    email: `${id}@co.local`,
    isActive: true,
    // Руководитель = top-level роль 'leader' (ТЗ 2026-08-17); рядовой — 'manager'.
    role: 'manager',
    lastLoginAt: null,
    managedOrganizations: [],
    ...overrides,
  };
}

describe('listCompanyManagers', () => {
  it('returns empty array when there are no managers in the company', async () => {
    const p = {
      user: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const result = await listCompanyManagers(p, 'co-1');
    expect(result).toEqual([]);
  });

  it('maps user rows to CompanyManagerRow shape (role=leader → isLeader:true)', async () => {
    const lastLoginAt = new Date('2026-08-10T09:00:00Z');
    const p = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          companyUser('m1', {
            role: 'leader',
            lastLoginAt,
            managedOrganizations: [
              {
                id: 'assign-1',
                isActive: true,
                organization: { id: 'org-1', name: 'Org One' },
              },
            ],
          }),
        ]),
      },
    } as never;
    const [row] = await listCompanyManagers(p, 'co-1');
    expect(row).toMatchObject({
      id: 'm1',
      name: 'Mgr m1',
      email: 'm1@co.local',
      isActive: true,
      // ТЗ 2026-08-17: бейдж руководителя выводится из top-level роли 'leader'.
      isLeader: true,
      lastLoginAt,
      assignments: [
        {
          id: 'assign-1',
          organizationId: 'org-1',
          organizationName: 'Org One',
          isActive: true,
        },
      ],
    });
  });

  it('filters to company managers and passes companyId in query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { user: { findMany } } as never;
    await listCompanyManagers(p, 'co-xyz');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ['manager', 'leader'] }, companyId: 'co-xyz' },
      })
    );
  });

  it('manager with no org assignments maps to empty assignments array', async () => {
    const p = {
      user: {
        findMany: vi.fn().mockResolvedValue([companyUser('m2')]),
      },
    } as never;
    const [row] = await listCompanyManagers(p, 'co-1');
    expect(row.assignments).toEqual([]);
    // Рядовой менеджер (role='manager') бейджа руководителя не получает.
    expect(row.isLeader).toBe(false);
    expect(row.lastLoginAt).toBeNull();
  });
});

describe('listManagersForOrg — sort callback second branch (prev >= newer)', () => {
  it('reduces multiple replies per order: keeps only the most-recent one', async () => {
    // Both rows deactivatedAt set — sort comparison between two dated rows
    const older = makeRow('r1', false, new Date('2026-02-01'));
    const newer = makeRow('r2', false, new Date('2026-05-01'));
    // Push in old-first order to force the sort to exercise both comparator paths
    const p = prismaWith([older, newer]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    // newer should be first (desc order)
    expect(inactive[0].id).toBe('r2');
    expect(inactive[1].id).toBe('r1');
  });

  it('handles equal deactivatedAt (same time)', async () => {
    const ts = new Date('2026-03-15');
    const a = makeRow('same-a', false, ts);
    const b = makeRow('same-b', false, new Date(ts.getTime()));
    const p = prismaWith([a, b]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    // Both equal → relative order preserved
    expect(inactive).toHaveLength(2);
  });

  it('three-row sort forces comparator to see aT=0 branch (null-date as a)', async () => {
    // With 3 rows, sort makes multiple comparator calls; at least one will put
    // the null-date row in the `a` position, exercising a.deactivatedAt?.getTime() ?? 0
    const r1 = makeRow('s1', false, new Date('2026-04-01'));
    const r2 = makeRow('s2', false, null); // null → aT=0 when in `a` slot
    const r3 = makeRow('s3', false, new Date('2026-06-01'));
    const p = prismaWith([r2, r1, r3]);
    const { inactive } = await listManagersForOrg(p, 'org-1');
    // r3 should be first (most recent), r2 (null=epoch0) last
    expect(inactive[0].id).toBe('s3');
    expect(inactive[inactive.length - 1].id).toBe('s2');
  });
});
