import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  orderWhereForLevel,
  leadWhereForLevel,
  canSeeLead,
  taskWhereForLevel,
  canSeeTask,
  NO_COMPANY_SENTINEL,
  type SessionAccessProfile,
} from '@/lib/auth/accessProfile';

/**
 * Coverage — RIGHT side of every `session.managedOrgIds ?? []` fallback.
 *
 * The mirror test (auth.accessProfile.unit.test.ts) always supplies
 * `managedOrgIds: []`, so it only ever hits the LEFT operand. Here every
 * session literal OMITS `managedOrgIds` entirely (genuinely `undefined`), so
 * the `?? []` right-hand default executes at src/lib/auth/accessProfile.ts
 * lines 90, 104, 121, 144, 168. Relevant scope level is always 'assigned' so
 * the `assigned` code path (which is the only one touching managedOrgIds) runs.
 */

// Manager session with NO managedOrgIds key (undefined at runtime). Kept
// separate from the mirror's mgr() builder precisely because that builder
// defaults managedOrgIds to [] and would mask the fallback.
function mgrNoOrgs(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'u1', role: 'manager', companyId: 'co-1', ...over } as unknown as SessionPayload;
}

const assignedLeadsProfile = (): SessionAccessProfile => ({
  id: 'p1',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'assigned',
  tasks: 'all',
  capabilities: [],
});

const assignedTasksProfile = (): SessionAccessProfile => ({
  id: 'p1',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'all',
  tasks: 'assigned',
  capabilities: [],
});

describe('managedOrgIds ?? [] fallback (managedOrgIds undefined)', () => {
  it('@90 orderWhereForLevel assigned → organizationId in [] (empty fallback), company floor kept', () => {
    const session = mgrNoOrgs({ companyId: 'co-1' });
    expect(session.managedOrgIds).toBeUndefined();
    expect(orderWhereForLevel(session, 'assigned')).toEqual({
      AND: [{ companyId: 'co-1' }, { organizationId: { in: [] } }],
    });
  });

  it('@90 orderWhereForLevel assigned honours null-company sentinel with empty fallback', () => {
    const session = mgrNoOrgs({ companyId: null });
    expect(orderWhereForLevel(session, 'assigned')).toEqual({
      AND: [{ companyId: NO_COMPANY_SENTINEL }, { organizationId: { in: [] } }],
    });
  });

  it('@104 leadWhereForLevel assigned → own OR organizationId in [] (empty fallback)', () => {
    const session = mgrNoOrgs({ sub: 'u7' });
    expect(session.managedOrgIds).toBeUndefined();
    expect(leadWhereForLevel(session, 'assigned')).toEqual({
      OR: [{ assignedManagerId: 'u7' }, { organizationId: { in: [] } }],
    });
  });

  it('@121 canSeeLead assigned → org branch uses empty fallback (managed set empty → deny non-own org lead)', () => {
    const session = mgrNoOrgs({ sub: 'u7', accessProfile: assignedLeadsProfile() });
    expect(session.managedOrgIds).toBeUndefined();
    // Not assigned to self AND managedOrgIds empty → org membership check is false.
    expect(canSeeLead(session, { assignedManagerId: 'someone-else', organizationId: 'o1' })).toBe(
      false
    );
    // Own lead still visible (short-circuits before the org check).
    expect(canSeeLead(session, { assignedManagerId: 'u7', organizationId: 'o1' })).toBe(true);
  });

  it('@144 taskWhereForLevel assigned → mine OR linkedOrganizationId in [] (empty fallback)', () => {
    const session = mgrNoOrgs({ sub: 'u7', companyId: 'co-1' });
    expect(session.managedOrgIds).toBeUndefined();
    expect(taskWhereForLevel(session, 'assigned')).toEqual({
      AND: [
        { companyId: 'co-1' },
        {
          OR: [
            { createdById: 'u7' },
            { assignees: { some: { userId: 'u7' } } },
            { linkedOrganizationId: { in: [] } },
          ],
        },
      ],
    });
  });

  it('@168 canSeeTask assigned → org branch uses empty fallback (managed set empty → deny non-mine org task)', () => {
    const session = mgrNoOrgs({
      sub: 'u7',
      companyId: 'co-1',
      accessProfile: assignedTasksProfile(),
    });
    expect(session.managedOrgIds).toBeUndefined();
    // Not creator, not assignee, and managedOrgIds empty → org branch false → deny.
    expect(
      canSeeTask(session, {
        companyId: 'co-1',
        createdById: 'other',
        assigneeUserIds: ['other2'],
        linkedOrganizationId: 'o1',
      })
    ).toBe(false);
    // Mine (creator) still visible, short-circuits before org check.
    expect(
      canSeeTask(session, {
        companyId: 'co-1',
        createdById: 'u7',
        assigneeUserIds: [],
        linkedOrganizationId: 'o1',
      })
    ).toBe(true);
  });
});
