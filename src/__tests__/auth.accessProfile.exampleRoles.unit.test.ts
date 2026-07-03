import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { can, type SessionAccessProfile } from '@/lib/auth/accessProfile';
import { managerOrderScope, managerOrgScope, managerDocumentScope } from '@/lib/auth/managerPolicy';

/**
 * G1.5 — целевые роли собираются через конструктор (матрица охватов + флаги) и
 * реально резолвятся в ожидаемые scope-фильтры. Это unit-доказательство поверх
 * уже зелёных резолверов/`can` (DB-раунд-трип — в integration-тесте).
 */

// Как их собрал бы руководитель в конструкторе (spec §8).
const OPERATOR: SessionAccessProfile = {
  id: 'r-op',
  name: 'Оператор заявок',
  orders: 'assigned',
  organizations: 'assigned',
  threads: 'assigned',
  documents: 'assigned',
  finance: 'own',
  leads: 'own',
  tasks: 'assigned',
  capabilities: []
};

const OHS_SPECIALIST: SessionAccessProfile = {
  id: 'r-ohs',
  name: 'Специалист по ОТ (аутсорсинг)',
  orders: 'assigned',
  organizations: 'assigned',
  threads: 'assigned',
  documents: 'assigned',
  finance: 'own',
  leads: 'own',
  tasks: 'assigned',
  capabilities: []
};

const SALES: SessionAccessProfile = {
  id: 'r-sales',
  name: 'Менеджер по продажам',
  orders: 'own',
  organizations: 'own',
  threads: 'own',
  documents: 'own',
  finance: 'own',
  leads: 'all',
  tasks: 'all',
  capabilities: []
};

function sessionWith(profile: SessionAccessProfile): SessionPayload {
  return {
    sub: 'u1',
    role: 'manager',
    companyId: 'co-1',
    managedOrgIds: ['o1', 'o2'],
    accessProfile: profile
  } as unknown as SessionPayload;
}

describe('G1.5 — «Оператор заявок»', () => {
  const s = sessionWith(OPERATOR);
  it('заявки/треды/документы = assigned (только закреплённые орги)', () => {
    const assigned = { AND: [{ companyId: 'co-1' }, { organizationId: { in: ['o1', 'o2'] } }] };
    expect(managerOrderScope(s, true)).toEqual(assigned);
    expect(managerDocumentScope(s, true).order).toEqual(assigned);
  });
  it('комиссию не видит (see_commission off)', () => {
    expect(can(s, 'see_commission')).toBe(false);
  });
});

describe('G1.5 — «Специалист по ОТ (аутсорсинг)»', () => {
  const s = sessionWith(OHS_SPECIALIST);
  it('организации = assigned (только закреплённые заказчики, company-floor)', () => {
    expect(managerOrgScope(s, true)).toEqual({
      AND: [{ companyId: 'co-1' }, { id: { in: ['o1', 'o2'] } }]
    });
  });
  it('обмен документами по закреплённым оргам; комиссия скрыта', () => {
    expect(managerDocumentScope(s, true).order).toEqual({
      AND: [{ companyId: 'co-1' }, { organizationId: { in: ['o1', 'o2'] } }]
    });
    expect(can(s, 'see_commission')).toBe(false);
  });
});

describe('G1.5 — «Менеджер по продажам»', () => {
  const s = sessionWith(SALES);
  it('leads = all хранится (полное enforcement — G2)', () => {
    expect(s.accessProfile?.leads).toBe('all');
  });
  it('операционка сужена до own', () => {
    expect(managerOrderScope(s, true)).toEqual({ AND: [{ companyId: 'co-1' }, { managerId: 'u1' }] });
    expect(can(s, 'see_commission')).toBe(false);
  });
});
