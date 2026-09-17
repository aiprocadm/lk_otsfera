import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
const { notifySubmitterClientRequestStatus } = vi.hoisted(() => ({
  notifySubmitterClientRequestStatus: vi.fn(),
}));
vi.mock('@/lib/services/clientRequests/notify', () => ({ notifySubmitterClientRequestStatus }));

import {
  replyToClientRequest,
  CLIENT_REQUEST_REPLY_MAX,
} from '@/lib/services/clientRequests/reply';

/** Ответ на обращение (`У-238`, `Р-Э6-4`): скоуп, текст, статус не трогается, аудит, письмо. */

const findFirst = vi.fn();
const update = vi.fn();
const prisma = { clientRequest: { findFirst, update } } as unknown as PrismaClient;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const PARTNER = { sub: 'p1', role: 'partner', partnerId: 'pt' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ id: 'R1', staffReply: null });
  update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'R1',
    status: 'in_triage',
    submittedByUserId: 'u1',
    ...args.data,
  }));
});

describe('replyToClientRequest', () => {
  it('партнёр и заказчик — forbidden без чтения базы', async () => {
    expect(await replyToClientRequest(prisma, PARTNER, { id: 'R1', text: 'x' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('пустой или слишком длинный текст — validation', async () => {
    expect(await replyToClientRequest(prisma, MANAGER, { id: 'R1', text: '   ' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(
      await replyToClientRequest(prisma, MANAGER, {
        id: 'R1',
        text: 'a'.repeat(CLIENT_REQUEST_REPLY_MAX + 1),
      })
    ).toEqual({ ok: false, error: 'validation' });
    expect(update).not.toHaveBeenCalled();
  });

  it('вне скоупа — not_found (ищется с clientRequestScopeWhere)', async () => {
    findFirst.mockResolvedValue(null);
    expect(await replyToClientRequest(prisma, MANAGER, { id: 'RX', text: 'ответ' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(findFirst.mock.calls[0][0].where.AND[0]).toEqual({ id: 'RX' });
  });

  it('пишет три поля, НЕ меняет статус, аудит и письмо событием reply', async () => {
    const r = await replyToClientRequest(prisma, MANAGER, {
      id: 'R1',
      text: '  Готово, отправили  ',
    });
    expect(r.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({
      staffReply: 'Готово, отправили',
      staffRepliedAt: expect.any(Date),
      staffRepliedById: 'm1',
    });
    expect(data).not.toHaveProperty('status');
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'client_request_replied',
        entityId: 'R1',
        after: { staffReply: 'Готово, отправили' },
      })
    );
    expect(notifySubmitterClientRequestStatus).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'R1', staffReply: 'Готово, отправили' }),
      { event: 'reply' }
    );
  });

  it('повторный ответ — прежний текст в before аудита', async () => {
    findFirst.mockResolvedValue({ id: 'R1', staffReply: 'старый' });
    await replyToClientRequest(prisma, MANAGER, { id: 'R1', text: 'новый' });
    expect(recordAudit.mock.calls[0][1]).toMatchObject({ before: { staffReply: 'старый' } });
  });
});
