/**
 * Unit-тесты сервисов архива инбокса (src/lib/services/inbound/archive.ts):
 * C8-скоуп, пин компании при архивации из общей очереди, идемпотентность,
 * CAS-запись (TOCTOU) и аудит. Валидация формы входа и revalidatePath — это
 * ответственность экшена, проверяется в server-actions.inbound.archive.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, inboundMessageFindUnique, inboundMessageUpdateMany } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  inboundMessageUpdateMany: vi.fn(),
}));

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundMessage: { findUnique: inboundMessageFindUnique, updateMany: inboundMessageUpdateMany },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { archiveInboundMessage, restoreInboundMessage } from '@/lib/services/inbound/archive';

function managerSession(opts: { sub?: string; companyId?: string | null } = {}): SessionPayload {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    companyId: opts.companyId === undefined ? 'company-a' : opts.companyId,
    managedOrgIds: ['org-a'],
  };
}

let session: SessionPayload = managerSession();

describe('archiveInboundMessage (service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = managerSession();
    inboundMessageUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('not_found: сообщение не существует', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('forbidden: bound-сообщение чужой компании (C8)', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-other', status: 'bound' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('forbidden: session.companyId=null + bound-сообщение (сентинел-инвариант)', async () => {
    session = managerSession({ companyId: null });
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'bound' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('unresolved (общая очередь, companyId=null) архивируется И закрепляется за компанией архивирующего', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true, changed: true });
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
  });

  it('unresolved с УЖЕ непустым companyId (восстановленная пиненная строка) — без повторного пина', async () => {
    // Компания B архивирует unresolved-строку, ранее пиненную за A (restore
    // сохраняет companyId): строка уходит в архив A — детерминированно и
    // восстановимо силами A, а не перезакрепляется за B.
    session = managerSession({ companyId: 'company-b' });
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'unresolved' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: true, changed: true });
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
    session = managerSession({ companyId: null });
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('bound-сообщение своей компании архивируется; companyId в update НЕ трогается', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'bound' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-2' });

    expect(result).toEqual({ ok: true, changed: true });
    expect(inboundMessageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'im-2', status: 'bound' },
      data: { status: 'archived' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'inbound_message_archived', before: { status: 'bound' } })
    );
  });

  it('уже archived → ok:true, changed:false идемпотентно; updateMany/audit НЕ вызваны', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: 'company-a', status: 'archived' });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-3' });

    expect(result).toEqual({ ok: true, changed: false });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('TOCTOU: статус ушёл из-под ног между чтением и записью (count=0) → not_found без audit', async () => {
    inboundMessageFindUnique.mockResolvedValue({ companyId: null, status: 'unresolved' });
    inboundMessageUpdateMany.mockResolvedValue({ count: 0 });

    const result = await archiveInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('restoreInboundMessage (service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = managerSession();
    inboundMessageUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('not_found: сообщение не существует', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('forbidden: archived-сообщение чужой компании (C8)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-other',
      status: 'archived',
      boundAt: new Date(),
    });

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('не-archived → not_found (нечего восстанавливать); updateMany НЕ вызван', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'bound',
      boundAt: new Date(),
    });

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(inboundMessageUpdateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('archived с boundAt → восстанавливается в bound (CAS по archived) + audit', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'archived',
      boundAt: new Date('2026-07-01T10:00:00Z'),
    });

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

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
  });

  it('archived без boundAt → восстанавливается в unresolved', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      companyId: 'company-a',
      status: 'archived',
      boundAt: null,
    });

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-2' });

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

    const result = await restoreInboundMessage(prisma, session, { inboundMessageId: 'im-1' });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
