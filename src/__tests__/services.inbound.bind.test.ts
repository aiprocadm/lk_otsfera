/**
 * Unit-тесты сервиса `bindInboundMessage` (src/lib/services/inbound/bind.ts):
 * C8-скоуп сообщения и организации, teamMode ON/OFF, контакт + learn-on-link,
 * best-effort резолв треда, форма запросов Prisma. Тонкий экшен-адаптер над
 * этим сервисом проверяется отдельно в server-actions.inbound.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  getCompanyTeamVisibility,
  recordAudit,
  captureChannel,
  inboundMessageFindUnique,
  inboundMessageUpdate,
  organizationFindUnique,
  orderFindUnique,
  orderThreadFindUnique,
  contactFindUnique,
} = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  recordAudit: vi.fn(),
  captureChannel: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  inboundMessageUpdate: vi.fn(),
  organizationFindUnique: vi.fn(),
  orderFindUnique: vi.fn(),
  orderThreadFindUnique: vi.fn(),
  contactFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth/managerPolicy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/managerPolicy')>(
    '@/lib/auth/managerPolicy'
  );
  return {
    ...actual,
    getCompanyTeamVisibility,
  };
});
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/manager/contacts', () => ({ captureChannel }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundMessage: { findUnique: inboundMessageFindUnique, update: inboundMessageUpdate },
    organization: { findUnique: organizationFindUnique },
    order: { findUnique: orderFindUnique },
    orderThread: { findUnique: orderThreadFindUnique },
    contact: { findUnique: contactFindUnique },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { bindInboundMessage } from '@/lib/services/inbound/bind';

function managerSession(
  opts: { sub?: string; companyId?: string | null; managedOrgIds?: string[] } = {}
): SessionPayload {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    companyId: opts.companyId ?? 'company-a',
    managedOrgIds: opts.managedOrgIds ?? ['org-a'],
  };
}

let session: SessionPayload = managerSession();

describe('bindInboundMessage (service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = managerSession();
    getCompanyTeamVisibility.mockResolvedValue(false);
  });

  it('returns not_found when the inbound message does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('returns not_found when the organization does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue(null);

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-x',
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it("returns forbidden (C8/IDOR) for another company's bound message — cross-company rebind by cuid is blocked", async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-b', status: 'bound' });

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    // Scope-гейт стоит ДО org-lookup: чужая строка не тратит запросов и не
    // зависит от того, какую org подсунул вызывающий.
    expect(organizationFindUnique).not.toHaveBeenCalled();
    expect(inboundMessageUpdate).not.toHaveBeenCalled();
  });

  it("allows re-binding the manager's OWN company's bound message (as before)", async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'bound' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
    });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'bound', companyId: 'company-a' }),
      })
    );
  });

  it('returns forbidden when the org is out of the manager scoped (non-team) scope', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-b', companyId: 'company-a' });
    session = managerSession({ managedOrgIds: ['org-a'] });
    getCompanyTeamVisibility.mockResolvedValue(false);

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-b',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdate).not.toHaveBeenCalled();
  });

  it('returns forbidden when team-mode is ON but the org belongs to another company', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-other', companyId: 'company-other' });
    getCompanyTeamVisibility.mockResolvedValue(true);

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-other',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden (C8/IDOR) when team-mode is OFF and the org IS in managedOrgIds but belongs to another company', async () => {
    // Regression: managedOrgIds is loaded without a company filter, so a
    // cross-company OrganizationManager assignment must NOT let the manager
    // bind an inbound to a foreign company's org. Company is the hard floor.
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-x', companyId: 'company-b' });
    session = managerSession({ companyId: 'company-a', managedOrgIds: ['org-x'] });
    getCompanyTeamVisibility.mockResolvedValue(false);

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-x',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdate).not.toHaveBeenCalled();
  });

  it('succeeds and sets companyId from the organization (scoped mode, in managedOrgIds)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
    });

    expect(result).toEqual({ ok: true });
    // Scope-гейт (E2) читает companyId+status; learn-on-link (Task 11) — channel+senderRef.
    expect(inboundMessageFindUnique).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      select: { id: true, channel: true, senderRef: true, companyId: true, status: true },
    });
    expect(inboundMessageUpdate).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      data: expect.objectContaining({
        resolvedOrgId: 'org-a',
        companyId: 'company-a',
        threadId: null,
        status: 'bound',
        boundById: 'u-mgr-1',
      }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'inbound_message_bound',
        entity: 'order_thread',
        entityId: 'im-1',
        userId: 'u-mgr-1',
      })
    );
  });

  it('succeeds under team-mode ON when org is same company (even if not in managedOrgIds)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-c', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(true);
    session = managerSession({ managedOrgIds: [] });
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-c',
    });

    expect(result).toEqual({ ok: true });
  });

  it('resolves the org-side thread when a valid orderId is supplied', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      companyId: 'company-a',
    });
    orderThreadFindUnique.mockResolvedValue({ id: 'thread-1' });
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
    });

    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).toHaveBeenCalledWith({
      where: { orderId_side: { orderId: 'ord-1', side: 'org' } },
      select: { id: true },
    });
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: 'thread-1' }) })
    );
  });

  it('team-mode ON: same-company order resolves the thread; foreign-company order does not', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(true);
    inboundMessageUpdate.mockResolvedValue({});

    // Same company → in scope, thread looked up.
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      companyId: 'company-a',
    });
    orderThreadFindUnique.mockResolvedValue({ id: 'thread-1' });
    let result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
    });
    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).toHaveBeenCalledTimes(1);

    // Foreign company order (несмотря на совпавшую org) → thread не резолвится.
    orderThreadFindUnique.mockClear();
    orderFindUnique.mockResolvedValue({
      id: 'ord-2',
      organizationId: 'org-a',
      companyId: 'company-b',
    });
    result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-2',
    });
    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).not.toHaveBeenCalled();
    expect(inboundMessageUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });

  it('leaves threadId null when the in-scope order has no org-side thread yet', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      companyId: 'company-a',
    });
    orderThreadFindUnique.mockResolvedValue(null);
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
    });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });

  it('leaves threadId null (best-effort) when the order does not belong to the target org', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-other',
      companyId: 'company-a',
    });
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessage(prisma, session, {
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1',
    });

    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).not.toHaveBeenCalled();
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });

  describe('contactId (Task 11 — attach + learn-on-link)', () => {
    it('binds the contact, sets contactId, and captures the sender identity as a channel', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-9',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      contactFindUnique.mockResolvedValue({
        id: 'k1',
        companyId: 'company-a',
        organizationId: null,
      });
      inboundMessageUpdate.mockResolvedValue({});

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
        contactId: 'k1',
      });

      expect(result).toEqual({ ok: true });
      expect(contactFindUnique).toHaveBeenCalledWith({
        where: { id: 'k1' },
        select: { id: true, companyId: true, organizationId: true },
      });
      expect(inboundMessageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contactId: 'k1' }) })
      );
      expect(captureChannel).toHaveBeenCalledWith(expect.anything(), {
        contactId: 'k1',
        companyId: 'company-a',
        type: 'telegram',
        value: 'chat-9',
      });
      expect(recordAudit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ after: expect.objectContaining({ contactId: 'k1' }) })
      );
    });

    it('accepts a contact already attached to the SAME target org', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'whatsapp',
        senderRef: '+79990001122',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      contactFindUnique.mockResolvedValue({
        id: 'k1',
        companyId: 'company-a',
        organizationId: 'org-a',
      });
      inboundMessageUpdate.mockResolvedValue({});

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
        contactId: 'k1',
      });

      expect(result).toEqual({ ok: true });
      expect(captureChannel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'whatsapp', value: '+79990001122' })
      );
    });

    it('returns forbidden when the contact does not exist', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-9',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      contactFindUnique.mockResolvedValue(null);

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
        contactId: 'gone',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(inboundMessageUpdate).not.toHaveBeenCalled();
      expect(captureChannel).not.toHaveBeenCalled();
    });

    it('returns forbidden (cross-company) when the contact belongs to another company', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-9',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      contactFindUnique.mockResolvedValue({
        id: 'k1',
        companyId: 'company-other',
        organizationId: null,
      });

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
        contactId: 'k1',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(inboundMessageUpdate).not.toHaveBeenCalled();
      expect(captureChannel).not.toHaveBeenCalled();
    });

    it('returns forbidden when the contact is already attached to a DIFFERENT org', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-9',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      contactFindUnique.mockResolvedValue({
        id: 'k1',
        companyId: 'company-a',
        organizationId: 'org-other',
      });

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
        contactId: 'k1',
      });

      expect(result).toEqual({ ok: false, error: 'forbidden' });
      expect(inboundMessageUpdate).not.toHaveBeenCalled();
      expect(captureChannel).not.toHaveBeenCalled();
    });

    it('без contactId: contactId=null в update, captureChannel не вызывается', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-9',
        companyId: null,
        status: 'unresolved',
      });
      organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
      getCompanyTeamVisibility.mockResolvedValue(false);
      inboundMessageUpdate.mockResolvedValue({});

      const result = await bindInboundMessage(prisma, session, {
        inboundMessageId: 'im-1',
        organizationId: 'org-a',
      });

      expect(result).toEqual({ ok: true });
      expect(contactFindUnique).not.toHaveBeenCalled();
      expect(inboundMessageUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contactId: null }) })
      );
      expect(captureChannel).not.toHaveBeenCalled();
    });
  });
});
