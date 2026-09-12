import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  recordAudit: vi.fn(),
  captureChannel: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth/managerPolicy')>('@/lib/auth/managerPolicy')),
  getCompanyTeamVisibility: m.getCompanyTeamVisibility,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/services/manager/contacts', () => ({ captureChannel: m.captureChannel }));

import { bindDialog } from '@/lib/services/messengers/bind';

/**
 * Привязка диалога (спека 2026-09-12 §4 `bind.ts`): гейты как у
 * `bindInboundMessage`, learn-on-link, очистка очереди триажа, аудит.
 */
const dialogFindUnique = vi.fn();
const dialogUpdate = vi.fn();
const orgFindUnique = vi.fn();
const contactFindUnique = vi.fn();
const inboundUpdateMany = vi.fn();
const prisma = {
  messengerDialog: { findUnique: dialogFindUnique, update: dialogUpdate },
  organization: { findUnique: orgFindUnique },
  contact: { findUnique: contactFindUnique },
  inboundMessage: { updateMany: inboundUpdateMany },
} as unknown as PrismaClient;

function managerSession(opts: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'm1',
    role: 'manager',
    companyId: 'c1',
    managedOrgIds: ['o1'],
    ...opts,
  } as SessionPayload;
}

const dialog = { id: 'd1', channel: 'telegram', peerRef: 'chat-1', companyId: null };

describe('bindDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogFindUnique.mockResolvedValue(dialog);
    orgFindUnique.mockResolvedValue({ id: 'o1', companyId: 'c1' });
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    inboundUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('нет диалога → not_found; диалог чужой компании → forbidden', async () => {
    dialogFindUnique.mockResolvedValueOnce(null);
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'x', organizationId: 'o1' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    dialogFindUnique.mockResolvedValueOnce({ ...dialog, companyId: 'other' });
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o1' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(orgFindUnique).not.toHaveBeenCalled();
  });

  it('организация не найдена → not_found; чужой компании или сессия без компании → forbidden', async () => {
    orgFindUnique.mockResolvedValueOnce(null);
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'x' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    orgFindUnique.mockResolvedValueOnce({ id: 'o2', companyId: 'other' });
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o2' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(
      bindDialog(prisma, managerSession({ companyId: null }), {
        dialogId: 'd1',
        organizationId: 'o1',
      })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(dialogUpdate).not.toHaveBeenCalled();
  });

  it('командная видимость выключена: незакреплённая организация → forbidden, руководителю можно', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    await expect(
      bindDialog(prisma, managerSession({ managedOrgIds: ['o9'] }), {
        dialogId: 'd1',
        organizationId: 'o1',
      })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(
      bindDialog(prisma, managerSession({ role: 'leader', managedOrgIds: [] }), {
        dialogId: 'd1',
        organizationId: 'o1',
      })
    ).resolves.toEqual({ ok: true });
  });

  it('контакт: не найден / чужой компании / другой организации → forbidden', async () => {
    contactFindUnique.mockResolvedValueOnce(null);
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o1', contactId: 'k' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    contactFindUnique.mockResolvedValueOnce({ id: 'k', companyId: 'other', organizationId: null });
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o1', contactId: 'k' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    contactFindUnique.mockResolvedValueOnce({ id: 'k', companyId: 'c1', organizationId: 'o2' });
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o1', contactId: 'k' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(dialogUpdate).not.toHaveBeenCalled();
  });

  it('с контактом: привязка, learn-on-link, письма собеседника из очереди, аудит', async () => {
    contactFindUnique.mockResolvedValueOnce({ id: 'k1', companyId: 'c1', organizationId: null });
    const r = await bindDialog(prisma, managerSession(), {
      dialogId: 'd1',
      organizationId: 'o1',
      contactId: 'k1',
    });
    expect(r).toEqual({ ok: true });
    expect(dialogUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { companyId: 'c1', organizationId: 'o1', contactId: 'k1' },
    });
    expect(m.captureChannel).toHaveBeenCalledWith(prisma, {
      contactId: 'k1',
      companyId: 'c1',
      type: 'telegram',
      value: 'chat-1',
    });
    expect(inboundUpdateMany).toHaveBeenCalledWith({
      where: { channel: 'telegram', senderRef: 'chat-1', status: 'unresolved' },
      data: expect.objectContaining({
        status: 'bound',
        resolvedOrgId: 'o1',
        companyId: 'c1',
        contactId: 'k1',
        boundAt: expect.any(Date),
      }),
    });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'messenger_dialog_bound',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'm1',
      after: { organizationId: 'o1', contactId: 'k1' },
    });
  });

  it('без контакта: контакт сбрасывается, каналы не обучаются', async () => {
    await expect(
      bindDialog(prisma, managerSession(), { dialogId: 'd1', organizationId: 'o1' })
    ).resolves.toEqual({ ok: true });
    expect(dialogUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { companyId: 'c1', organizationId: 'o1', contactId: null },
    });
    expect(m.captureChannel).not.toHaveBeenCalled();
    expect(inboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: null }) })
    );
  });
});
