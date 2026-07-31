/**
 * M5 — unit-тесты canSeeEvent (спека 2026-07-17-m5-calendar §3, §7).
 * Роли, company-floor (C8), уровни охвата `session.accessProfile?.tasks`.
 */
import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeEvent } from '@/lib/services/calendar/policy';

const event = (
  over: Partial<{ companyId: string; createdById: string; attendeeUserIds: string[] }> = {}
) => ({
  companyId: 'c1',
  createdById: 'creator',
  attendeeUserIds: [] as string[],
  ...over,
});

const session = (over: Record<string, unknown>): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'c1', ...over }) as unknown as SessionPayload;

describe('canSeeEvent — роли', () => {
  it('admin видит всё (Model A), включая чужую компанию', () => {
    const admin = session({ sub: 'a1', role: 'admin', companyId: null });
    expect(canSeeEvent(admin, event())).toBe(true);
    expect(canSeeEvent(admin, event({ companyId: 'c-other' }))).toBe(true);
  });

  it('клиентские роли — deny всегда', () => {
    for (const role of ['partner', 'organization', 'student'] as const) {
      expect(canSeeEvent(session({ role, sub: 'creator' }), event())).toBe(false);
    }
  });
});

describe('canSeeEvent — company-floor (C8)', () => {
  it('менеджер чужой компании — deny', () => {
    expect(canSeeEvent(session({ companyId: 'c2' }), event())).toBe(false);
  });

  it('сессия без companyId — deny', () => {
    expect(canSeeEvent(session({ companyId: null }), event())).toBe(false);
    expect(canSeeEvent(session({ companyId: undefined }), event())).toBe(false);
  });
});

describe('canSeeEvent — уровни охвата tasks', () => {
  it('без профиля — вся компания', () => {
    expect(canSeeEvent(session({}), event())).toBe(true);
  });

  it("уровень 'all' — вся компания", () => {
    const s = session({ accessProfile: { tasks: 'all' } });
    expect(canSeeEvent(s, event())).toBe(true);
  });

  it("'own': создатель — true, участник — true, чужое — false", () => {
    const s = session({ accessProfile: { tasks: 'own' } });
    expect(canSeeEvent(s, event({ createdById: 'm1' }))).toBe(true);
    expect(canSeeEvent(s, event({ attendeeUserIds: ['x', 'm1'] }))).toBe(true);
    expect(canSeeEvent(s, event({ attendeeUserIds: ['x'] }))).toBe(false);
  });

  it("'assigned' тождественен 'own' (у события нет орг-скоупа)", () => {
    const s = session({ accessProfile: { tasks: 'assigned' } });
    expect(canSeeEvent(s, event({ createdById: 'm1' }))).toBe(true);
    expect(canSeeEvent(s, event({ attendeeUserIds: ['m1'] }))).toBe(true);
    expect(canSeeEvent(s, event())).toBe(false);
  });
});
