import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  recordAudit,
  revalidatePath,
  inboundMessageFindUnique,
  inboundMessageUpdateMany,
} = vi.hoisted(() => ({
  requireManager: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  inboundMessageUpdateMany: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/inbound/reply', () => ({ replyToInbound: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers: vi.fn() }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundMessage: { findUnique: inboundMessageFindUnique, updateMany: inboundMessageUpdateMany },
  },
}));

import { archiveInboundMessageAction, restoreInboundMessageAction } from '@/server-actions/inbound';

function managerSession(opts: { sub?: string; companyId?: string | null } = {}) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    companyId: opts.companyId === undefined ? 'company-a' : opts.companyId,
    managedOrgIds: ['org-a'],
  };
}

describe('archiveInboundMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
    inboundMessageUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('validation: пустой inboundMessageId — до auth и БД дело не доходит', async () => {
    const result = await archiveInboundMessageAction({ inboundMessageId: '' });

    expect(result).toEqual({ ok: false, error: 'validation' });
    expect(requireManager).not.toHaveBeenCalled();
    expect(inboundMessageFindUnique).not.toHaveBeenCalled();
  });

  it('not_found: сообщение не существует', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('forbidden: bound-сообщение чужой компании (C8)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-other', status: 'bound' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('forbidden: session.companyId=null + bound-сообщение (сентинел-инвариант)', async () => {
    requireManager.mockResolvedValue(managerSession({ companyId: null }));
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'bound' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('unresolved (общая очередь, companyId=null) архивируется И закрепляется за компанией архивирующего', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageFindUnique).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      select: { companyId: true, status: true },
    });
    // Закрепление companyId — иначе archived+companyId=null выпадает из
    // scope ВСЕХ сессий навсегда (невидимо в списке и невосстановимо).
    // CAS по прочитанному status — TOCTOU-guard против гонки с bind.
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-1', status: 'unresolved' },
      data: { status: 'archived', companyId: 'company-a' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'inbound_message_archived',
        entity: 'order_thread',
        entityId: 'im-1',
        userId: 'u-mgr-1',
        before: { status: 'unresolved' },
        after: { status: 'archived', companyId: 'company-a' },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/inbox');
  });

  it('unresolved с УЖЕ непустым companyId (восстановленная пиненная строка) — без повторного пина', async () => {
    // Компания B архивирует unresolved-строку, ранее пиненную за A (restore
    // сохраняет companyId): строка уходит в архив A — детерминированно и
    // восстановимо силами A, а не перезакрепляется за B.
    requireManager.mockResolvedValue(managerSession({ companyId: 'company-b' }));
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'unresolved' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-1', status: 'unresolved' },
      data: { status: 'archived' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ after: { status: 'archived' } })
    );
  });

  it('forbidden: unresolved при session.companyId=null — некому закрепить обращение', async () => {
    requireManager.mockResolvedValue(managerSession({ companyId: null }));
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('bound-сообщение своей компании архивируется; companyId в update НЕ трогается', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'bound' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-2' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-2', status: 'bound' },
      data: { status: 'archived' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'inbound_message_archived', before: { status: 'bound' } })
    );
  });

  it('уже archived → ok:true идемпотентно; updateMany/audit/revalidate НЕ вызваны', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'archived' });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-3' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('TOCTOU: статус ушёл из-под ног между чтением и записью (count=0) → not_found без audit', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    inboundMessageUpdateMany.mockResolvedValue({ count: 0 });

    const result = await archiveInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('restoreInboundMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession());
    inboundMessageUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('validation: пустой inboundMessageId', async () => {
    const result = await restoreInboundMessageAction({ inboundMessageId: '' });

    expect(result).toEqual({ ok: false, error: 'validation' });
    expect(inboundMessageFindUnique).not.toHaveBeenCalled();
  });

  it('not_found: сообщение не существует', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('forbidden: archived-сообщение чужой компании (C8)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-other',
      status: 'archived',
      boundAt: new Date(),
    });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('не-archived → not_found (нечего восстанавливать); updateMany НЕ вызван', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'bound',
      boundAt: new Date(),
    });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('archived с boundAt → восстанавливается в bound (CAS по archived); audit + revalidate', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'archived',
      boundAt: new Date('2026-07-01T10:00:00Z'),
    });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageFindUnique).toHaveBeenCalledWith({
      where: { id: 'im-1' },
      select: { companyId: true, status: true, boundAt: true },
    });
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-1', status: 'archived' },
      data: { status: 'bound' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'inbound_message_restored',
        entity: 'order_thread',
        entityId: 'im-1',
        userId: 'u-mgr-1',
        before: { status: 'archived' },
        after: { status: 'bound' },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/inbox');
  });

  it('archived без boundAt → восстанавливается в unresolved', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'archived',
      boundAt: null,
    });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-2' });

    expect(result).toEqual({ ok: true });
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-2', status: 'archived' },
      data: { status: 'unresolved' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'inbound_message_restored',
        after: { status: 'unresolved' },
      })
    );
  });

  it('TOCTOU: строка ушла из archived между чтением и записью (count=0) → not_found без audit', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'archived',
      boundAt: null,
    });
    inboundMessageUpdateMany.mockResolvedValue({ count: 0 });

    const result = await restoreInboundMessageAction({ inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
