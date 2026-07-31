import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
const { bindCall } = vi.hoisted(() => ({ bindCall: vi.fn() }));
const { createContact } = vi.hoisted(() => ({ createContact: vi.fn() }));
const { bindInboundMessageAction } = vi.hoisted(() => ({ bindInboundMessageAction: vi.fn() }));
const { inboundMessageFindUnique } = vi.hoisted(() => ({ inboundMessageFindUnique: vi.fn() }));
const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/telephony/bindCall', () => ({ bindCall }));
vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/server-actions/inbound', () => ({
  bindInboundMessageAction,
  CHANNEL_TO_CONTACT_TYPE: {
    telegram: 'telegram',
    max: 'max',
    whatsapp: 'whatsapp',
    email: 'email',
  },
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { inboundMessage: { findUnique: inboundMessageFindUnique } },
}));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import {
  bindCallAction,
  createContactFromCallAction,
  createContactFromInboundAction,
} from '@/server-actions/contacts';

describe('contacts server-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'c1' });
    notFoundIfDisabled.mockReturnValue(null);
  });

  it('bindCallAction returns forbidden when the contacts flag is disabled', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const r = await bindCallAction({ callId: 'call1', organizationId: 'o1' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(requireManager).not.toHaveBeenCalled();
    expect(bindCall).not.toHaveBeenCalled();
  });

  it('createContactFromCallAction returns forbidden when the contacts flag is disabled', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const r = await createContactFromCallAction({
      callId: 'call1',
      organizationId: 'o1',
      name: 'Иван',
      phone: '+79990001122',
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createContact).not.toHaveBeenCalled();
  });

  it('createContactFromCallAction surfaces a createContact failure without attempting the bind', async () => {
    createContact.mockResolvedValue({ ok: false, error: 'invalid' });
    const r = await createContactFromCallAction({
      callId: 'call1',
      organizationId: 'o1',
      name: '',
      phone: '+79990001122',
    });
    expect(r).toEqual({ ok: false, error: 'invalid' });
    expect(bindCall).not.toHaveBeenCalled();
  });

  it('bindCallAction delegates to bindCall service', async () => {
    bindCall.mockResolvedValue({ ok: true });
    const r = await bindCallAction({ callId: 'call1', organizationId: 'o1', contactId: 'k1' });
    expect(r).toEqual({ ok: true });
    expect(bindCall).toHaveBeenCalledWith(
      expect.anything(),
      { sub: 'm1', role: 'manager', companyId: 'c1' },
      { callId: 'call1', organizationId: 'o1', contactId: 'k1' }
    );
  });

  it('createContactFromCallAction creates a contact then binds the call to it', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindCall.mockResolvedValue({ ok: true });
    const r = await createContactFromCallAction({
      callId: 'call1',
      organizationId: 'o1',
      name: 'Иван',
      phone: '+79990001122',
    });
    expect(r).toEqual({ ok: true, contactId: 'k9' });
    expect(createContact).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        name: 'Иван',
        organizationId: 'o1',
        channels: [{ type: 'phone', value: '+79990001122' }],
      })
    );
    expect(bindCall).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      callId: 'call1',
      organizationId: 'o1',
      contactId: 'k9',
    });
  });

  it('createContactFromCallAction surfaces a bind failure (call not_found) even though createContact succeeded', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindCall.mockResolvedValue({ ok: false, error: 'not_found' });
    const r = await createContactFromCallAction({
      callId: 'gone',
      organizationId: 'o1',
      name: 'Иван',
      phone: '+79990001122',
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    // The contact WAS created (valid + org-scoped); only the call binding failed.
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(bindCall).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      callId: 'gone',
      organizationId: 'o1',
      contactId: 'k9',
    });
  });

  describe('createContactFromInboundAction', () => {
    beforeEach(() => {
      inboundMessageFindUnique.mockReset();
      bindInboundMessageAction.mockReset();
    });

    it('creates a contact from the sender identity then binds the inbound message to it', async () => {
      inboundMessageFindUnique.mockResolvedValue({ channel: 'telegram', senderRef: 'chat-9' });
      createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
      bindInboundMessageAction.mockResolvedValue({ ok: true });

      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });

      expect(r).toEqual({ ok: true, contactId: 'k9' });
      expect(inboundMessageFindUnique).toHaveBeenCalledWith({
        where: { id: 'im-1' },
        select: { channel: true, senderRef: true },
      });
      expect(createContact).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          name: 'Иван',
          organizationId: 'o1',
          channels: [{ type: 'telegram', value: 'chat-9' }],
        })
      );
      expect(bindInboundMessageAction).toHaveBeenCalledWith({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        contactId: 'k9',
      });
    });

    it('returns forbidden when the contacts flag is disabled', async () => {
      notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });
      expect(r).toEqual({ ok: false, error: 'forbidden' });
      expect(inboundMessageFindUnique).not.toHaveBeenCalled();
      expect(createContact).not.toHaveBeenCalled();
    });

    it('returns not_found when the inbound message does not exist', async () => {
      inboundMessageFindUnique.mockResolvedValue(null);

      const r = await createContactFromInboundAction({
        inboundMessageId: 'gone',
        organizationId: 'o1',
        name: 'Иван',
      });

      expect(r).toEqual({ ok: false, error: 'not_found' });
      expect(createContact).not.toHaveBeenCalled();
      expect(bindInboundMessageAction).not.toHaveBeenCalled();
    });

    it('createContact failure short-circuits (bind not called)', async () => {
      inboundMessageFindUnique.mockResolvedValue({ channel: 'telegram', senderRef: 'chat-9' });
      createContact.mockResolvedValue({ ok: false, error: 'forbidden' });

      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });

      expect(r).toEqual({ ok: false, error: 'forbidden' });
      expect(bindInboundMessageAction).not.toHaveBeenCalled();
    });

    it('surfaces a bind failure even though createContact succeeded', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        channel: 'whatsapp',
        senderRef: '+79990001122',
      });
      createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
      bindInboundMessageAction.mockResolvedValue({ ok: false, error: 'not_found' });

      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });

      expect(r).toEqual({ ok: false, error: 'not_found' });
      expect(createContact).toHaveBeenCalledTimes(1);
      expect(bindInboundMessageAction).toHaveBeenCalledWith({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        contactId: 'k9',
      });
    });
  });
});
