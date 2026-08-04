import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
const { bindCall } = vi.hoisted(() => ({ bindCall: vi.fn() }));
const { createContact } = vi.hoisted(() => ({ createContact: vi.fn() }));
const { createContactFromInbound } = vi.hoisted(() => ({ createContactFromInbound: vi.fn() }));
const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/telephony/bindCall', () => ({ bindCall }));
vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/lib/services/inbound/createContactFromInbound', () => ({ createContactFromInbound }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
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

  // Цепочка «найти письмо → создать контакт → привязать» живёт целиком в
  // сервисе createContactFromInbound (services.inbound.createContactFromInbound
  // .test.ts); здесь — только флаг, гард и прокидка Result.
  describe('createContactFromInboundAction', () => {
    beforeEach(() => {
      createContactFromInbound.mockReset();
    });

    it('delegates to the createContactFromInbound service', async () => {
      createContactFromInbound.mockResolvedValue({ ok: true, contactId: 'k9' });

      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });

      expect(r).toEqual({ ok: true, contactId: 'k9' });
      expect(createContactFromInbound).toHaveBeenCalledWith(
        expect.anything(),
        { sub: 'm1', role: 'manager', companyId: 'c1' },
        { inboundMessageId: 'im-1', organizationId: 'o1', name: 'Иван' }
      );
    });

    it('returns forbidden when the contacts flag is disabled', async () => {
      notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
      const r = await createContactFromInboundAction({
        inboundMessageId: 'im-1',
        organizationId: 'o1',
        name: 'Иван',
      });
      expect(r).toEqual({ ok: false, error: 'forbidden' });
      expect(requireManager).not.toHaveBeenCalled();
      expect(createContactFromInbound).not.toHaveBeenCalled();
    });

    it('surfaces service failures unchanged (not_found / forbidden / invalid)', async () => {
      for (const error of ['not_found', 'forbidden', 'invalid']) {
        createContactFromInbound.mockResolvedValue({ ok: false, error });
        const r = await createContactFromInboundAction({
          inboundMessageId: 'im-1',
          organizationId: 'o1',
          name: 'Иван',
        });
        expect(r).toEqual({ ok: false, error });
      }
    });
  });
});
