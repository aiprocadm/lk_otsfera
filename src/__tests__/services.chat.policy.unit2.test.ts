/**
 * Unit tests for src/lib/services/chat/policy.ts — additional branches.
 * Covers deriveSide for 'leader' role and canSeeThread for non-standard roles.
 */
import { describe, it, expect } from 'vitest';
import { canSeeThread, deriveSide } from '@/lib/services/chat/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

const order = { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' };
// Явное `| undefined` в типе оверрайдов — сознательно: тесты ниже проверяют
// ветки «в сессии нет partnerId / organizationMemberships», и при
// exactOptionalPropertyTypes Partial<SessionPayload> такие литералы не принимает.
type SessionOverrides = { [K in keyof SessionPayload]?: SessionPayload[K] | undefined };

const s = (over: SessionOverrides): SessionPayload =>
  ({ sub: 'u', role: 'manager', ...over }) as SessionPayload;

describe('deriveSide — additional roles', () => {
  it('manager role → null (already tested but kept for completeness)', () =>
    expect(deriveSide(s({ role: 'manager' }))).toBeNull());

  it('admin role → null (teams choose side explicitly)', () =>
    expect(deriveSide(s({ role: 'admin' }))).toBeNull());

  it('leader role → null', () => expect(deriveSide(s({ role: 'leader' as any }))).toBeNull());

  it('student role → null', () => expect(deriveSide(s({ role: 'student' as any }))).toBeNull());
});

describe('canSeeThread — fallback false for unknown roles', () => {
  it('unknown role → false', () =>
    expect(canSeeThread(s({ role: 'unknown' as any }), 'org', order)).toBe(false));

  it('student role → false', () =>
    expect(canSeeThread(s({ role: 'student' as any }), 'partner', order)).toBe(false));

  it('partner with null partnerId returns false (order.partnerId check)', () => {
    const sess = s({ role: 'partner', partnerId: undefined });
    expect(canSeeThread(sess, 'partner', order)).toBe(false);
  });

  it('org session with no organizationMemberships → false', () => {
    const sess = s({ role: 'organization', organizationMemberships: undefined });
    expect(canSeeThread(sess, 'org', order)).toBe(false);
  });

  it('org session with null organizationId in order → false', () => {
    const sess = s({
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'org1', isActive: true, roleInOrg: 'member' },
      ] as any,
    });
    expect(canSeeThread(sess, 'org', { ...order, organizationId: null })).toBe(false);
  });

  it('partner with null partnerId in order → false', () => {
    const sess = s({ role: 'partner', partnerId: 'p1' });
    expect(canSeeThread(sess, 'partner', { ...order, partnerId: null })).toBe(false);
  });
});
