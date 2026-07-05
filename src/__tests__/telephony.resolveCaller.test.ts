import { describe, it, expect, vi } from 'vitest';
import { resolveCaller, canonicalizeRuPhone } from '@/lib/services/telephony/resolveCaller';

function db(users: any[], leads: any[] = []) {
  return {
    user: { findMany: vi.fn(async () => users) },
    lead: { findMany: vi.fn(async () => leads) },
  } as any;
}

describe('canonicalizeRuPhone', () => {
  it('RU national 8-prefixed 11-digit number → +7 E.164', () => {
    expect(canonicalizeRuPhone('88001234567')).toBe('+78001234567');
  });

  it('already-E.164 +7 number is left unchanged', () => {
    expect(canonicalizeRuPhone('+79990001122')).toBe('+79990001122');
  });
});

describe('resolveCaller', () => {
  it('exact match on User.whatsappPhone → org+company', async () => {
    const u = { id: 'u1', organization: { id: 'o1', companyId: 'c1' } };
    const r = await resolveCaller(db([u]), '+79990001122');
    expect(r).toMatchObject({ matchType: 'exact', userId: 'u1', orgId: 'o1', companyId: 'c1' });
  });

  it('RU 8→7 canonicalization: national-form caller matches E.164-stored contact', async () => {
    const u = { id: 'u1', organization: { id: 'o1', companyId: 'c1' } };
    const d = db([u]);
    const r = await resolveCaller(d, '88001234567');
    expect(r).toMatchObject({ matchType: 'exact', userId: 'u1', orgId: 'o1', companyId: 'c1' });
    expect(d.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { whatsappPhone: '+78001234567' } }));
  });

  it('ambiguous (>1 user) → unresolved (never guess)', async () => {
    const a = { id: 'u1', organization: { id: 'o1', companyId: 'c1' } };
    const b = { id: 'u2', organization: { id: 'o2', companyId: 'c2' } };
    const r = await resolveCaller(db([a, b]), '+79990001122');
    expect(r.matchType).toBe('unresolved');
  });

  it('no user match → falls back to Lead.clientContactPhone', async () => {
    const lead = { organizationId: 'o1', organization: { companyId: 'c1' } };
    const r = await resolveCaller(db([], [lead]), '+79990001122');
    expect(r).toMatchObject({ matchType: 'exact', orgId: 'o1', companyId: 'c1' });
    expect((r as any).userId).toBeUndefined();
  });

  it('ambiguous lead match (>1) → unresolved', async () => {
    const l1 = { organizationId: 'o1', organization: { companyId: 'c1' } };
    const l2 = { organizationId: 'o2', organization: { companyId: 'c2' } };
    const r = await resolveCaller(db([], [l1, l2]), '+79990001122');
    expect(r.matchType).toBe('unresolved');
  });

  it('no user, no lead → unresolved', async () => {
    const r = await resolveCaller(db([], []), '+79990001122');
    expect(r.matchType).toBe('unresolved');
  });

  it('empty/garbage phone → unresolved without querying', async () => {
    const d = db([{ id: 'u1', organization: { id: 'o1', companyId: 'c1' } }]);
    const r = await resolveCaller(d, '');
    expect(r.matchType).toBe('unresolved');
    expect(d.user.findMany).not.toHaveBeenCalled();
  });

  it('garbage (non-numeric) phone → unresolved without querying', async () => {
    const d = db([{ id: 'u1', organization: { id: 'o1', companyId: 'c1' } }]);
    const r = await resolveCaller(d, 'abc-not-a-phone');
    expect(r.matchType).toBe('unresolved');
    expect(d.user.findMany).not.toHaveBeenCalled();
  });

  it('user without organization/companyId → unresolved (no company scope)', async () => {
    const u = { id: 'u1', organization: null };
    const r = await resolveCaller(db([u]), '+79990001122');
    expect(r.matchType).toBe('unresolved');
  });
});
