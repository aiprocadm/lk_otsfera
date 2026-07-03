import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  taskWhereForLevel,
  canSeeTask,
  NO_COMPANY_SENTINEL,
  type SessionAccessProfile
} from '@/lib/auth/accessProfile';

function mgr(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'u1', role: 'manager', companyId: 'co-1', managedOrgIds: [], ...over } as unknown as SessionPayload;
}

const profile = (over: Partial<SessionAccessProfile> = {}): SessionAccessProfile => ({
  id: 'p1',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'all',
  tasks: 'all',
  capabilities: [],
  ...over
});

const task = (over: Partial<{ companyId: string; createdById: string; assigneeUserIds: string[]; linkedOrganizationId: string | null }> = {}) => ({
  companyId: 'co-1',
  createdById: 'other',
  assigneeUserIds: [] as string[],
  linkedOrganizationId: null as string | null,
  ...over
});

describe('taskWhereForLevel() — tasks company-scoped (company floor как у orders)', () => {
  it('all → только компания', () => {
    expect(taskWhereForLevel(mgr({ companyId: 'co-1' }), 'all')).toEqual({ companyId: 'co-1' });
  });

  it('own → компания И (создатель ∨ исполнитель)', () => {
    expect(taskWhereForLevel(mgr({ companyId: 'co-1', sub: 'u1' }), 'own')).toEqual({
      AND: [{ companyId: 'co-1' }, { OR: [{ createdById: 'u1' }, { assignees: { some: { userId: 'u1' } } }] }]
    });
  });

  it('assigned → компания И (создатель ∨ исполнитель ∨ задача закреплённой орг)', () => {
    expect(taskWhereForLevel(mgr({ companyId: 'co-1', sub: 'u1', managedOrgIds: ['o1', 'o2'] }), 'assigned')).toEqual({
      AND: [
        { companyId: 'co-1' },
        {
          OR: [
            { createdById: 'u1' },
            { assignees: { some: { userId: 'u1' } } },
            { linkedOrganizationId: { in: ['o1', 'o2'] } }
          ]
        }
      ]
    });
  });

  it('null companyId → no-company sentinel (fail-safe deny)', () => {
    expect(taskWhereForLevel(mgr({ companyId: null }), 'all')).toEqual({ companyId: NO_COMPANY_SENTINEL });
  });
});

describe('canSeeTask() — строго внутренняя видимость (§4 isolation)', () => {
  it('клиентские роли не видят задачи никогда', () => {
    for (const role of ['partner', 'organization', 'student'] as const) {
      expect(canSeeTask({ ...mgr(), role } as unknown as SessionPayload, task())).toBe(false);
    }
  });

  it('admin видит всё (Model A)', () => {
    expect(canSeeTask({ sub: 'a1', role: 'admin' } as unknown as SessionPayload, task({ companyId: 'other' }))).toBe(true);
  });

  it('менеджер: своя компания без профиля → видит (company-wide)', () => {
    expect(canSeeTask(mgr(), task({ companyId: 'co-1' }))).toBe(true);
  });

  it('менеджер: чужая компания → deny (C8)', () => {
    expect(canSeeTask(mgr({ companyId: 'co-1' }), task({ companyId: 'co-2' }))).toBe(false);
  });

  it('менеджер без companyId → deny', () => {
    expect(canSeeTask(mgr({ companyId: null }), task({ companyId: 'co-1' }))).toBe(false);
  });

  it('own: видит только созданные/назначенные на себя', () => {
    const s = mgr({ sub: 'u1', accessProfile: profile({ tasks: 'own' }) });
    expect(canSeeTask(s, task({ createdById: 'u1' }))).toBe(true);
    expect(canSeeTask(s, task({ assigneeUserIds: ['u1'] }))).toBe(true);
    expect(canSeeTask(s, task({ createdById: 'other', assigneeUserIds: ['x'] }))).toBe(false);
  });

  it('assigned: own ∪ задачи закреплённых организаций', () => {
    const s = mgr({ sub: 'u1', managedOrgIds: ['o1'], accessProfile: profile({ tasks: 'assigned' }) });
    expect(canSeeTask(s, task({ linkedOrganizationId: 'o1' }))).toBe(true);
    expect(canSeeTask(s, task({ linkedOrganizationId: 'o9' }))).toBe(false);
    expect(canSeeTask(s, task({ createdById: 'u1' }))).toBe(true);
  });
});
