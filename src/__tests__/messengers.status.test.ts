import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { setDialogStatus } from '@/lib/services/messengers/status';

/** Закрыть / открыть снова (спека 2026-09-12 §5.2): скоуп, идемпотентность, аудит. */
const findUnique = vi.fn();
const update = vi.fn();
const prisma = { messengerDialog: { findUnique, update } } as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

describe('setDialogStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('нет диалога или чужая компания → not_found', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      setDialogStatus(prisma, session, { dialogId: 'x', status: 'closed' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    findUnique.mockResolvedValueOnce({ id: 'd1', companyId: 'other', status: 'open' });
    await expect(
      setDialogStatus(prisma, session, { dialogId: 'd1', status: 'closed' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });

  it('то же состояние → changed:false без записи и аудита', async () => {
    findUnique.mockResolvedValueOnce({ id: 'd1', companyId: 'c1', status: 'open' });
    await expect(
      setDialogStatus(prisma, session, { dialogId: 'd1', status: 'open' })
    ).resolves.toEqual({ ok: true, changed: false });
    expect(update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('закрытие и повторное открытие пишут своё событие аудита', async () => {
    findUnique.mockResolvedValueOnce({ id: 'd1', companyId: null, status: 'open' });
    await expect(
      setDialogStatus(prisma, session, { dialogId: 'd1', status: 'closed' })
    ).resolves.toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'closed' } });
    expect(recordAudit).toHaveBeenLastCalledWith(prisma, {
      action: 'messenger_dialog_closed',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'm1',
    });

    findUnique.mockResolvedValueOnce({ id: 'd1', companyId: 'c1', status: 'closed' });
    await setDialogStatus(prisma, session, { dialogId: 'd1', status: 'open' });
    expect(recordAudit).toHaveBeenLastCalledWith(
      prisma,
      expect.objectContaining({ action: 'messenger_dialog_reopened' })
    );
  });
});
