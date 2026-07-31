/**
 * M6 — unit-тесты where-построителей глобального поиска (спека 2026-07-18 §3).
 * Инвариант: manager-ветки тождественны scope-швам домашних списков,
 * admin — company-floor (Model A), C8 держится во всех категориях.
 */
import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { searchScopes } from '@/lib/services/search/scopes';
import { managerDocumentScope, managerOrderScope, managerOrgScope } from '@/lib/auth/managerPolicy';
import { leadWhereForLevel, taskWhereForLevel } from '@/lib/auth/accessProfile';
import { eventScopeWhere } from '@/lib/services/calendar/items';
import { conversationScopeWhere } from '@/lib/services/staffChat/conversations';

function session(over: Record<string, unknown> = {}): SessionPayload {
  return {
    sub: 'u1',
    role: 'manager',
    companyId: 'c1',
    managedOrgIds: ['org1'],
    ...over,
  } as unknown as SessionPayload;
}

const admin = session({ sub: 'a1', role: 'admin', managedOrgIds: undefined });
const manager = session();

describe('searchScopes — admin (Model A, company-floor)', () => {
  it('orders/organizations — floor компании; documents — floor + не-infected', () => {
    const s = searchScopes(admin, false);
    expect(s.orders).toEqual({ companyId: 'c1' });
    expect(s.organizations).toEqual({ companyId: 'c1' });
    expect(s.documents).toEqual({ companyId: 'c1', scanStatus: { not: 'infected' } });
  });

  it('leads — вся командная очередь (у Lead нет companyId)', () => {
    expect(searchScopes(admin, false).leads).toEqual({});
  });

  it('students — floor через организацию', () => {
    expect(searchScopes(admin, false).students).toEqual({ organization: { companyId: 'c1' } });
  });

  it('admin без companyId → sentinel-floor (deny-all, fail-safe)', () => {
    const s = searchScopes(session({ sub: 'a2', role: 'admin', companyId: null }), false);
    expect(s.orders).toEqual({ companyId: '__no_company__' });
    expect(s.students).toEqual({ organization: { companyId: '__no_company__' } });
  });
});

describe('searchScopes — manager (переиспользование швов)', () => {
  it('orders/organizations/documents тождественны manager*Scope (legacy, scoped)', () => {
    const s = searchScopes(manager, false);
    expect(s.orders).toEqual(managerOrderScope(manager, false));
    expect(s.organizations).toEqual(managerOrgScope(manager, false));
    expect(s.documents).toEqual(managerDocumentScope(manager, false));
  });

  it('teamMode=true прокидывается в швы (company-wide)', () => {
    const s = searchScopes(manager, true);
    expect(s.orders).toEqual(managerOrderScope(manager, true));
    expect(s.orders).toEqual({ companyId: 'c1' });
    expect(s.organizations).toEqual({ companyId: 'c1' });
  });

  it('leads/tasks — уровень из профиля (own), fallback all без профиля', () => {
    const profiled = session({ accessProfile: { leads: 'own', tasks: 'own' } });
    const s = searchScopes(profiled, false);
    expect(s.leads).toEqual(leadWhereForLevel(profiled, 'own'));
    expect(s.tasks).toEqual(taskWhereForLevel(profiled, 'own'));
    expect(searchScopes(manager, false).leads).toEqual(leadWhereForLevel(manager, 'all'));
    expect(searchScopes(manager, false).tasks).toEqual(taskWhereForLevel(manager, 'all'));
  });

  it('events/messages — швы M5/M4 целиком', () => {
    const s = searchScopes(manager, false);
    expect(s.events).toEqual(eventScopeWhere(manager));
    expect(s.messages).toEqual({ conversation: conversationScopeWhere(manager) });
  });

  it('students: scoped → закреплённые орги; teamMode → floor через организацию', () => {
    expect(searchScopes(manager, false).students).toEqual({ organizationId: { in: ['org1'] } });
    expect(searchScopes(manager, true).students).toEqual({ organization: { companyId: 'c1' } });
  });

  it('manager без managedOrgIds → deny-all по студентам (IN [])', () => {
    const bare = session({ managedOrgIds: undefined });
    expect(searchScopes(bare, false).students).toEqual({ organizationId: { in: [] } });
  });
});
