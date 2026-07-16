import { it, expect } from 'vitest';
import { isStaff, canSeeStaffConversation } from '@/lib/services/staffChat/policy';

const conv = (over: Partial<{ kind: 'dm' | 'general'; companyId: string }> = {}) => ({
  kind: over.kind ?? 'general',
  companyId: over.companyId ?? 'c1'
});

it('isStaff: admin/manager true; partner/organization/student false', () => {
  expect(isStaff({ role: 'admin' } as never)).toBe(true);
  expect(isStaff({ role: 'manager' } as never)).toBe(true);
  expect(isStaff({ role: 'partner' } as never)).toBe(false);
  expect(isStaff({ role: 'organization' } as never)).toBe(false);
  expect(isStaff({ role: 'student' } as never)).toBe(false);
});

it('admin sees everything (Model A)', () => {
  expect(canSeeStaffConversation({ role: 'admin', sub: 'a1', companyId: null } as never, conv(), [])).toBe(true);
  expect(canSeeStaffConversation({ role: 'admin', sub: 'a1', companyId: null } as never, conv({ kind: 'dm' }), ['x', 'y'])).toBe(true);
});

it('manager sees general only of own company; companyId=null → deny', () => {
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c1' } as never, conv(), [])).toBe(true);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c2' } as never, conv(), [])).toBe(false);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: null } as never, conv(), [])).toBe(false);
});

it('dm visible only to participants (manager)', () => {
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm1', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['m1', 'm2'])).toBe(true);
  expect(canSeeStaffConversation({ role: 'manager', sub: 'm3', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['m1', 'm2'])).toBe(false);
});

it('client roles never see anything', () => {
  expect(canSeeStaffConversation({ role: 'partner', sub: 'p1', companyId: 'c1' } as never, conv(), [])).toBe(false);
  expect(canSeeStaffConversation({ role: 'organization', sub: 'o1', companyId: 'c1' } as never, conv({ kind: 'dm' }), ['o1'])).toBe(false);
});
