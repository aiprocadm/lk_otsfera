import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
const { bindCall } = vi.hoisted(() => ({ bindCall: vi.fn() }));
const { createContact } = vi.hoisted(() => ({ createContact: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/telephony/bindCall', () => ({ bindCall }));
vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn(() => null) }));

import { bindCallAction, createContactFromCallAction } from '@/server-actions/contacts';

describe('contacts server-actions', () => {
  beforeEach(() => { vi.clearAllMocks(); requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'c1' }); });

  it('bindCallAction delegates to bindCall service', async () => {
    bindCall.mockResolvedValue({ ok: true });
    const r = await bindCallAction({ callId: 'call1', organizationId: 'o1', contactId: 'k1' });
    expect(r).toEqual({ ok: true });
    expect(bindCall).toHaveBeenCalledWith({}, { sub: 'm1', role: 'manager', companyId: 'c1' }, { callId: 'call1', organizationId: 'o1', contactId: 'k1' });
  });

  it('createContactFromCallAction creates a contact then binds the call to it', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindCall.mockResolvedValue({ ok: true });
    const r = await createContactFromCallAction({ callId: 'call1', organizationId: 'o1', name: 'Иван', phone: '+79990001122' });
    expect(r).toEqual({ ok: true, contactId: 'k9' });
    expect(createContact).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ name: 'Иван', organizationId: 'o1', channels: [{ type: 'phone', value: '+79990001122' }] }));
    expect(bindCall).toHaveBeenCalledWith({}, expect.anything(), { callId: 'call1', organizationId: 'o1', contactId: 'k9' });
  });
});
