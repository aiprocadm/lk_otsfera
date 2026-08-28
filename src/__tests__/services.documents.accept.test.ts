import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, setDocumentStatus, notifyManagers, warn } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  setDocumentStatus: vi.fn(),
  notifyManagers: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));
vi.mock('@/lib/notifications', () => ({ notifyManagers }));
vi.mock('@/lib/logging', () => ({ log: { warn, error: vi.fn(), info: vi.fn() } }));

import { acceptDocument } from '@/lib/services/documents/accept';

/**
 * `У-150` — заказчик принимает акт или договор.
 *
 * Проверяем прежде всего запреты: счёт вручную «принять» нельзя (его состояние
 * определяют платежи), чужой документ не принимается, сотрудник ЦО этой
 * дверью не пользуется.
 */
const orgUser = (): SessionPayload =>
  ({ sub: 'u1', role: 'organization', organizationId: 'org-1' }) as unknown as SessionPayload;

function fake(doc: Record<string, unknown> | null = {}) {
  const findUnique = vi.fn(async () =>
    doc === null
      ? null
      : {
          id: 'doc-1',
          type: 'act',
          number: 'А-2026-7',
          orderId: 'ord-1',
          companyId: null,
          counterpartyType: 'organization',
          counterpartyId: 'org-1',
          order: { id: 'ord-1', companyId: 'co-1', managerId: 'm1', orderNumber: '123' },
          ...doc,
        }
  );
  return { prisma: { document: { findUnique } } as unknown as PrismaClient, findUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
  setDocumentStatus.mockResolvedValue({ ok: true });
  notifyManagers.mockResolvedValue({});
});

describe('acceptDocument', () => {
  it('акт принимается: статус меняется через общую дверь, менеджер уведомлён', async () => {
    const f = fake();
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({ ok: true });
    expect(setDocumentStatus).toHaveBeenCalledWith(f.prisma, expect.anything(), {
      documentId: 'doc-1',
      to: 'accepted',
    });
    expect(notifyManagers).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({ type: 'document_accepted' })
    );
  });

  it('счёт вручную не принимается — его состояние определяют платежи', async () => {
    const f = fake({ type: 'invoice' });
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_acceptable',
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('сотрудник ЦО этой дверью не пользуется', async () => {
    const f = fake();
    for (const role of ['manager', 'leader', 'admin', 'partner']) {
      const res = await acceptDocument(f.prisma, { sub: 'x', role } as never, 'doc-1');
      expect(res, role).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(f.findUnique).not.toHaveBeenCalled();
  });

  it('чужой документ отвечает not_found — существование не раскрываем', async () => {
    canReadDocument.mockResolvedValue(false);
    const f = fake();
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('документа нет → not_found', async () => {
    const f = fake(null);
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-x')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('аннулированный документ принять нельзя — матрица уже сказала «нет»', async () => {
    setDocumentStatus.mockResolvedValue({
      ok: false,
      error: 'invalid_transition',
      from: 'cancelled',
      to: 'accepted',
    });
    const f = fake();
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('сбой уведомления не отменяет приёмку', async () => {
    // Документ уже принят; отказ из-за недоставленного письма заставил бы
    // заказчика нажимать «Принять» второй раз.
    notifyManagers.mockRejectedValue(new Error('smtp down'));
    const f = fake();
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
  });

  it('документ без заказа принимается, уведомлять некого', async () => {
    const f = fake({ orderId: null, order: null });
    expect(await acceptDocument(f.prisma, orgUser(), 'doc-1')).toEqual({ ok: true });
    expect(notifyManagers).not.toHaveBeenCalled();
  });
});
