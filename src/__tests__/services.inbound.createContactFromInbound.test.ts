/**
 * Unit-тесты сервиса `createContactFromInbound`
 * (src/lib/services/inbound/createContactFromInbound.ts): опознание канала
 * отправителя, создание контакта его личностью и привязка сообщения — цельная
 * операция, порядок шагов и коды отказов не размазываются по слоям.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { createContact, bindInboundMessage, inboundMessageFindUnique } = vi.hoisted(() => ({
  createContact: vi.fn(),
  bindInboundMessage: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
}));

vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/lib/services/inbound/bind', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/inbound/bind')>(
    '@/lib/services/inbound/bind'
  );
  return { ...actual, bindInboundMessage };
});
vi.mock('@/lib/db/prisma', () => ({
  prisma: { inboundMessage: { findUnique: inboundMessageFindUnique } },
}));

import { prisma } from '@/lib/db/prisma';
import { createContactFromInbound } from '@/lib/services/inbound/createContactFromInbound';

const SESSION: SessionPayload = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createContactFromInbound', () => {
  it('creates a contact from the sender identity then binds the inbound message to it', async () => {
    inboundMessageFindUnique.mockResolvedValue({ channel: 'telegram', senderRef: 'chat-9' });
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindInboundMessage.mockResolvedValue({ ok: true });

    const r = await createContactFromInbound(prisma, SESSION, {
      inboundMessageId: 'im-1',
      organizationId: 'o1',
      name: 'Иван',
    });

    expect(r).toEqual({ ok: true, contactId: 'k9' });
    expect(inboundMessageFindUnique).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      select: { channel: true, senderRef: true },
    });
    expect(createContact).toHaveBeenCalledWith(prisma, SESSION, {
      name: 'Иван',
      organizationId: 'o1',
      channels: [{ type: 'telegram', value: 'chat-9' }],
    });
    expect(bindInboundMessage).toHaveBeenCalledWith(prisma, SESSION, {
      inboundMessageId: 'im-1',
      organizationId: 'o1',
      contactId: 'k9',
    });
  });

  it('returns not_found when the inbound message does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const r = await createContactFromInbound(prisma, SESSION, {
      inboundMessageId: 'gone',
      organizationId: 'o1',
      name: 'Иван',
    });

    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(createContact).not.toHaveBeenCalled();
    expect(bindInboundMessage).not.toHaveBeenCalled();
  });

  it('createContact failure short-circuits (bind not called)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ channel: 'telegram', senderRef: 'chat-9' });
    createContact.mockResolvedValue({ ok: false, error: 'forbidden' });

    const r = await createContactFromInbound(prisma, SESSION, {
      inboundMessageId: 'im-1',
      organizationId: 'o1',
      name: 'Иван',
    });

    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(bindInboundMessage).not.toHaveBeenCalled();
  });

  it('surfaces a bind failure even though createContact succeeded', async () => {
    inboundMessageFindUnique.mockResolvedValue({ channel: 'whatsapp', senderRef: '+79990001122' });
    createContact.mockResolvedValue({ ok: true, contactId: 'k9' });
    bindInboundMessage.mockResolvedValue({ ok: false, error: 'not_found' });

    const r = await createContactFromInbound(prisma, SESSION, {
      inboundMessageId: 'im-1',
      organizationId: 'o1',
      name: 'Иван',
    });

    expect(r).toEqual({ ok: false, error: 'not_found' });
    // Контакт создан и валиден — откат не нужен, но вызывающий обязан узнать,
    // что СООБЩЕНИЕ осталось непривязанным.
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith(
      prisma,
      SESSION,
      expect.objectContaining({ channels: [{ type: 'whatsapp', value: '+79990001122' }] })
    );
  });
});
