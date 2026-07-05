import { describe, it, expect, vi } from 'vitest';
import { resolveInboundSender } from '@/lib/services/inbound/resolve';

function db(users: any[], leads: any[] = []) {
  return {
    user: { findMany: vi.fn(async () => users) },
    lead: { findMany: vi.fn(async () => leads) },
  } as any;
}

describe('resolveInboundSender', () => {
  it('exact telegram chatId → org+company', async () => {
    const u = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const r = await resolveInboundSender(db([u]), { channel: 'telegram', chatId: '123' });
    expect(r).toMatchObject({ matchType: 'exact', userId: 'u1', orgId: 'o1', companyId: 'c1' });
  });

  it('no match → unresolved', async () => {
    const r = await resolveInboundSender(db([]), { channel: 'telegram', chatId: 'nope' });
    expect(r.matchType).toBe('unresolved');
    expect(r.orgId).toBeUndefined();
  });

  it('ambiguous (>1 user) → unresolved (never cross-bind)', async () => {
    const a = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const b = { id: 'u2', organizationId: 'o2', organization: { id: 'o2', companyId: 'c2' } };
    const r = await resolveInboundSender(db([a, b]), { channel: 'whatsapp', phone: '+79990001122' });
    expect(r.matchType).toBe('unresolved');
  });

  it('user without organization → unresolved (no company scope)', async () => {
    const u = { id: 'u1', organizationId: null, organization: null };
    const r = await resolveInboundSender(db([u]), { channel: 'email', email: 'x@y.z' });
    expect(r.matchType).toBe('unresolved');
  });

  it('channel/identifier mismatch → unresolved WITHOUT querying (empty-where guard)', async () => {
    const d = db([{ id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } }]);
    const r = await resolveInboundSender(d, { channel: 'telegram', phone: '+79990001122' }); // telegram but no chatId
    expect(r.matchType).toBe('unresolved');
    expect(d.user.findMany).not.toHaveBeenCalled();
  });

  it('whatsapp phone is normalized before lookup', async () => {
    const u = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const d = db([u]);
    const r = await resolveInboundSender(d, { channel: 'whatsapp', phone: '+7 (999) 000-11-22' });
    expect(r).toMatchObject({ matchType: 'exact', userId: 'u1' });
    expect(d.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { whatsappPhone: '+79990001122' } }));
  });

  it('email lookup is case-insensitive (mode: insensitive), not lowercased', async () => {
    const u = { id: 'u1', organizationId: 'o1', organization: { id: 'o1', companyId: 'c1' } };
    const d = db([u]);
    await resolveInboundSender(d, { channel: 'email', email: '  John@Example.COM ' });
    expect(d.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: 'John@Example.COM', mode: 'insensitive' } } }));
  });
});
