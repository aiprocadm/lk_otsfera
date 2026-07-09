import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  getCompanyTeamVisibility,
  replyToInbound,
  recordAudit,
  notifyOrgUsers,
  writeSyncLog,
  inboundMessageFindUnique,
  inboundMessageUpdate,
  organizationFindUnique,
  orderFindUnique,
  orderThreadFindUnique,
  orderThreadUpdate,
  messageCreate
} = vi.hoisted(() => ({
  requireManager: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  replyToInbound: vi.fn(),
  recordAudit: vi.fn(),
  notifyOrgUsers: vi.fn(),
  writeSyncLog: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  inboundMessageUpdate: vi.fn(),
  organizationFindUnique: vi.fn(),
  orderFindUnique: vi.fn(),
  orderThreadFindUnique: vi.fn(),
  orderThreadUpdate: vi.fn(),
  messageCreate: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/auth/managerPolicy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/managerPolicy')>('@/lib/auth/managerPolicy');
  return {
    ...actual,
    getCompanyTeamVisibility
  };
});
vi.mock('@/lib/services/inbound/reply', () => ({ replyToInbound }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundMessage: { findUnique: inboundMessageFindUnique, update: inboundMessageUpdate },
    organization: { findUnique: organizationFindUnique },
    order: { findUnique: orderFindUnique },
    orderThread: { findUnique: orderThreadFindUnique, update: orderThreadUpdate },
    message: { create: messageCreate }
  }
}));

import { bindInboundMessageAction, replyInboundAction } from '@/server-actions/inbound';

function managerSession(opts: { sub?: string; companyId?: string | null; managedOrgIds?: string[] } = {}) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    companyId: opts.companyId ?? 'company-a',
    managedOrgIds: opts.managedOrgIds ?? ['org-a']
  };
}

describe('bindInboundMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
    getCompanyTeamVisibility.mockResolvedValue(false);
  });

  it('returns not_found when the inbound message does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('returns not_found when the organization does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue(null);

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-x' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns forbidden when the org is out of the manager scoped (non-team) scope', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-b', companyId: 'company-a' });
    requireManager.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    getCompanyTeamVisibility.mockResolvedValue(false);

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-b' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdate).not.toHaveBeenCalled();
  });

  it('returns forbidden when team-mode is ON but the org belongs to another company', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-other', companyId: 'company-other' });
    getCompanyTeamVisibility.mockResolvedValue(true);

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-other' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden (C8/IDOR) when team-mode is OFF and the org IS in managedOrgIds but belongs to another company', async () => {
    // Regression: managedOrgIds is loaded without a company filter, so a
    // cross-company OrganizationManager assignment must NOT let the manager
    // bind an inbound to a foreign company's org. Company is the hard floor.
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-x', companyId: 'company-b' });
    requireManager.mockResolvedValue(managerSession({ companyId: 'company-a', managedOrgIds: ['org-x'] }));
    getCompanyTeamVisibility.mockResolvedValue(false);

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-x' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdate).not.toHaveBeenCalled();
  });

  it('succeeds and sets companyId from the organization (scoped mode, in managedOrgIds)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdate).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      data: expect.objectContaining({
        resolvedOrgId: 'org-a',
        companyId: 'company-a',
        threadId: null,
        status: 'bound',
        boundById: 'u-mgr-1'
      })
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'inbound_message_bound', entity: 'order_thread', entityId: 'im-1', userId: 'u-mgr-1' })
    );
  });

  it('succeeds under team-mode ON when org is same company (even if not in managedOrgIds)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-c', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(true);
    requireManager.mockResolvedValue(managerSession({ managedOrgIds: [] }));
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-c' });

    expect(result).toEqual({ ok: true });
  });

  it('resolves the org-side thread when a valid orderId is supplied', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a', companyId: 'company-a' });
    orderThreadFindUnique.mockResolvedValue({ id: 'thread-1' });
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessageAction({
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1'
    });

    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).toHaveBeenCalledWith({
      where: { orderId_side: { orderId: 'ord-1', side: 'org' } },
      select: { id: true }
    });
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: 'thread-1' }) })
    );
  });

  it('team-mode ON: same-company order resolves the thread; foreign-company order does not', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(true);
    inboundMessageUpdate.mockResolvedValue({});

    // Same company → in scope, thread looked up.
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a', companyId: 'company-a' });
    orderThreadFindUnique.mockResolvedValue({ id: 'thread-1' });
    let result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a', orderId: 'ord-1' });
    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).toHaveBeenCalledTimes(1);

    // Foreign company order (несмотря на совпавшую org) → thread не резолвится.
    orderThreadFindUnique.mockClear();
    orderFindUnique.mockResolvedValue({ id: 'ord-2', organizationId: 'org-a', companyId: 'company-b' });
    result = await bindInboundMessageAction({ inboundMessageId: 'im-1', organizationId: 'org-a', orderId: 'ord-2' });
    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).not.toHaveBeenCalled();
    expect(inboundMessageUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });

  it('leaves threadId null when the in-scope order has no org-side thread yet', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a', companyId: 'company-a' });
    orderThreadFindUnique.mockResolvedValue(null);
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessageAction({
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1'
    });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });

  it('leaves threadId null (best-effort) when the order does not belong to the target org', async () => {
    inboundMessageFindUnique.mockResolvedValue({ id: 'im-1' });
    organizationFindUnique.mockResolvedValue({ id: 'org-a', companyId: 'company-a' });
    getCompanyTeamVisibility.mockResolvedValue(false);
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-other', companyId: 'company-a' });
    inboundMessageUpdate.mockResolvedValue({});

    const result = await bindInboundMessageAction({
      inboundMessageId: 'im-1',
      organizationId: 'org-a',
      orderId: 'ord-1'
    });

    expect(result).toEqual({ ok: true });
    expect(orderThreadFindUnique).not.toHaveBeenCalled();
    expect(inboundMessageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
    );
  });
});

describe('replyInboundAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
  });

  it('returns not_found when the inbound message does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('returns forbidden when the message is unresolved (companyId null)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: null, threadId: null
    });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('returns forbidden when the message belongs to another company', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-other', threadId: null
    });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns invalid for empty/whitespace-only text', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-a', threadId: null
    });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: '   ' });

    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('returns email_unsupported when the channel is email and replyToInbound fails', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'email', senderRef: 'a@b.com', subject: 'Hi', companyId: 'company-a', threadId: null
    });
    replyToInbound.mockResolvedValue({ ok: false });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: false, error: 'email_unsupported' });
  });

  it('returns reply_failed when a non-email channel send fails', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'whatsapp', senderRef: '+7999', subject: null, companyId: 'company-a', threadId: null
    });
    replyToInbound.mockResolvedValue({ ok: false });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: false, error: 'reply_failed' });
  });

  it('succeeds for a non-email channel without a bound thread (no mirror attempted)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-a', threadId: null
    });
    replyToInbound.mockResolvedValue({ ok: true });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'inbound_message_replied', entityId: 'im-1', userId: 'u-mgr-1' })
    );
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'inbound', direction: 'outbound', operation: 'create', status: 'success' })
    );
  });

  it('mirrors into the thread and notifies org users when threadId is bound', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-a', threadId: 'thread-1'
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockResolvedValue({ id: 'msg-1' });
    orderThreadUpdate.mockResolvedValue({ orderId: 'ord-1' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a', orderNumber: '123', title: 'Course' });
    notifyOrgUsers.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'Reply text' });

    expect(result).toEqual({ ok: true });
    expect(messageCreate).toHaveBeenCalledWith({
      data: { threadId: 'thread-1', authorId: 'u-mgr-1', body: 'Reply text' }
    });
    expect(orderThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'thread-1' }, data: expect.objectContaining({ lastMessageAt: expect.any(Date) }) })
    );
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-a',
        type: 'manager_replied',
        payload: expect.objectContaining({ orderId: 'ord-1', orderNumber: '123', orderTitle: 'Course', commentExcerpt: 'Reply text' })
      })
    );
  });

  it('still returns ok:true when the thread mirror throws (best-effort)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-a', threadId: 'thread-1'
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockRejectedValue(new Error('db down'));

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalled();
  });

  it('mirror failure with a non-Error value is stringified in the warn log (still ok:true)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1', channel: 'telegram', senderRef: 'chat-1', subject: null, companyId: 'company-a', threadId: 'thread-1'
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockRejectedValue('string-boom');

    const result = await replyInboundAction({ inboundMessageId: 'im-1', text: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      '[inbound/replyInboundAction] thread mirror failed',
      expect.objectContaining({ error: 'string-boom' })
    );
    warn.mockRestore();
  });
});
