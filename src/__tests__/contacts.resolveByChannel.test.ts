import { describe, it, expect, vi } from 'vitest';
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';

function db(rows: any[]) {
  return { contactChannel: { findMany: vi.fn(async () => rows) } } as any;
}
const chan = (over: any = {}) => ({ contact: { id: 'k1', organizationId: 'o1', companyId: 'c1', userId: 'u1', isArchived: false }, ...over });

describe('resolveContactByChannel', () => {
  it('exact single channel → contact + derived org/company/user', async () => {
    const r = await resolveContactByChannel(db([chan()]), { type: 'telegram', value: '123' });
    expect(r).toEqual({ contactId: 'k1', organizationId: 'o1', companyId: 'c1', userId: 'u1' });
  });
  it('no match → null', async () => {
    expect(await resolveContactByChannel(db([]), { type: 'email', value: 'x@y.z' })).toBeNull();
  });
  it('ambiguous (>1, e.g. cross-company) → null (never guess)', async () => {
    const r = await resolveContactByChannel(db([chan(), chan({ contact: { id: 'k2', organizationId: 'o2', companyId: 'c2' } })]), { type: 'phone', value: '+79990001122' });
    expect(r).toBeNull();
  });
  it('archived contact is ignored', async () => {
    const r = await resolveContactByChannel(db([chan({ contact: { id: 'k1', organizationId: 'o1', companyId: 'c1', isArchived: true } })]), { type: 'phone', value: '+7999' });
    expect(r).toBeNull();
  });
  it('call resolution searches phone-like types {phone, whatsapp}', async () => {
    const d = db([chan({ type: 'whatsapp' })]);
    await resolveContactByChannel(d, { type: 'phone', value: '+79990001122', phoneLike: true });
    expect(d.contactChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: { in: ['phone', 'whatsapp'] }, normalizedValue: '+79990001122' }) })
    );
  });
  it('a value that normalizes to empty string short-circuits to null without querying the DB', async () => {
    const d = db([]);
    const r = await resolveContactByChannel(d, { type: 'phone', value: '---' });
    expect(r).toBeNull();
    expect(d.contactChannel.findMany).not.toHaveBeenCalled();
  });
  it('resolved contact with no linked user omits `userId` from the result entirely', async () => {
    const r = await resolveContactByChannel(
      db([chan({ contact: { id: 'k1', organizationId: 'o1', companyId: 'c1', userId: null, isArchived: false } })]),
      { type: 'telegram', value: '123' }
    );
    expect(r).toEqual({ contactId: 'k1', organizationId: 'o1', companyId: 'c1' });
    expect(r).not.toHaveProperty('userId');
  });
});
