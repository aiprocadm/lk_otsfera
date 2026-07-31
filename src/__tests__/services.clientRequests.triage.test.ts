/**
 * Unit tests for src/lib/services/clientRequests/triage.ts (этап 5, ФТ-1.4).
 *
 * Конвейер submitted → in_triage → converted | rejected: RBAC (только staff),
 * скоуп как у списка (not_found), lifecycle-гейты, транзакция convertToLead
 * (Lead наследует принадлежность и поля заявки), уведомление подателя и аудит
 * после каждого перехода.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { notifySubmitterClientRequestStatus } = vi.hoisted(() => ({
  notifySubmitterClientRequestStatus: vi.fn(),
}));
vi.mock('@/lib/services/clientRequests/notify', () => ({
  notifySubmitterClientRequestStatus,
  notifyManagersClientRequestSubmitted: vi.fn(),
}));

import {
  takeInTriage,
  convertToLead,
  rejectClientRequest,
} from '@/lib/services/clientRequests/triage';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MANAGER: SessionPayload = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const ADMIN: SessionPayload = { sub: 'a1', role: 'admin' } as SessionPayload;

const request = (over: Record<string, unknown> = {}) => ({
  id: 'R1',
  source: 'partner_cabinet',
  status: 'submitted',
  submittedByUserId: 'p-user',
  partnerId: 'p1',
  organizationId: 'o1',
  companyName: 'ООО Ромашка',
  inn: '7712345678',
  contactName: 'Иван Иванов',
  contactPhone: '+79000000000',
  contactEmail: 'i@x.ru',
  subject: 'Обучение',
  body: 'Текст заявки',
  rejectedReason: null,
  ...over,
});

function db(found: unknown) {
  const findFirst = vi.fn().mockResolvedValue(found);
  const update = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...request(),
      ...data,
    }));
  const txLeadCreate = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'L1',
      ...data,
    }));
  const txRequestUpdate = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...request(),
      ...data,
    }));
  const tx = { lead: { create: txLeadCreate }, clientRequest: { update: txRequestUpdate } };
  const prisma = {
    clientRequest: { findFirst, update },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { prisma: prisma as never, findFirst, update, txLeadCreate, txRequestUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifySubmitterClientRequestStatus.mockResolvedValue(undefined);
});

// ─── RBAC + скоуп ─────────────────────────────────────────────────────────────

describe('триаж — RBAC и скоуп', () => {
  it('forbidden для partner/organization во всех трёх переходах (без чтения БД)', async () => {
    const { prisma, findFirst } = db(request());
    for (const role of ['partner', 'organization'] as const) {
      const session = { sub: 'x', role } as SessionPayload;
      expect(await takeInTriage(prisma, session, { id: 'R1' })).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(await convertToLead(prisma, session, { id: 'R1' })).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(await rejectClientRequest(prisma, session, { id: 'R1', reason: 'x' })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(notifySubmitterClientRequestStatus).not.toHaveBeenCalled();
  });

  it('not_found вне скоупа: заявка ищется с clientRequestScopeWhere', async () => {
    const { prisma, findFirst } = db(null);
    expect(await takeInTriage(prisma, MANAGER, { id: 'RX' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await convertToLead(prisma, MANAGER, { id: 'RX' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await rejectClientRequest(prisma, MANAGER, { id: 'RX', reason: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      AND: [
        { id: 'RX' },
        { OR: [{ organization: { companyId: 'c1' } }, { organizationId: null }] },
      ],
    });
    expect(notifySubmitterClientRequestStatus).not.toHaveBeenCalled();
  });
});

// ─── lifecycle-гейты ──────────────────────────────────────────────────────────

describe('триаж — lifecycle_violation', () => {
  it('takeInTriage только из submitted', async () => {
    for (const status of ['in_triage', 'converted', 'rejected'] as const) {
      const { prisma, update } = db(request({ status }));
      expect(await takeInTriage(prisma, MANAGER, { id: 'R1' })).toEqual({
        ok: false,
        error: 'lifecycle_violation',
      });
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('convert/reject запрещены из терминальных converted/rejected', async () => {
    for (const status of ['converted', 'rejected'] as const) {
      const { prisma } = db(request({ status }));
      expect(await convertToLead(prisma, MANAGER, { id: 'R1' })).toEqual({
        ok: false,
        error: 'lifecycle_violation',
      });
      expect(await rejectClientRequest(prisma, MANAGER, { id: 'R1', reason: 'x' })).toEqual({
        ok: false,
        error: 'lifecycle_violation',
      });
    }
    expect(recordAudit).not.toHaveBeenCalled();
    expect(notifySubmitterClientRequestStatus).not.toHaveBeenCalled();
  });
});

// ─── happy paths ──────────────────────────────────────────────────────────────

describe('takeInTriage — happy', () => {
  it('submitted → in_triage, triagedByUserId/triagedAt; аудит и уведомление подателя', async () => {
    const { prisma, update } = db(request());
    const r = await takeInTriage(prisma, MANAGER, { id: 'R1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.status).toBe('in_triage');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'R1' },
      data: { status: 'in_triage', triagedByUserId: 'm1', triagedAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm1',
      action: 'client_request_taken',
      entity: 'client_request',
      entityId: 'R1',
      after: { status: 'in_triage' },
    });
    expect(notifySubmitterClientRequestStatus).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: 'in_triage' })
    );
  });
});

describe('convertToLead — happy', () => {
  it('транзакция: Lead с source=client_request, sourceRequestId, наследованием и полями заявки; заявка → converted', async () => {
    const { prisma, txLeadCreate, txRequestUpdate } = db(request());
    const r = await convertToLead(prisma, MANAGER, { id: 'R1' });
    if (!r.ok) throw new Error('expected ok');
    expect(txLeadCreate).toHaveBeenCalledWith({
      data: {
        source: 'client_request',
        sourceRequestId: 'R1',
        partnerId: 'p1',
        organizationId: 'o1',
        createdByUserId: 'm1',
        clientCompanyName: 'ООО Ромашка',
        clientInn: '7712345678',
        clientContactName: 'Иван Иванов',
        clientContactPhone: '+79000000000',
        clientContactEmail: 'i@x.ru',
        subject: 'Обучение',
        notes: 'Текст заявки',
        status: 'new',
      },
    });
    expect(txRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'R1' },
      data: { status: 'converted', triagedByUserId: 'm1', triagedAt: expect.any(Date) },
    });
    expect(r.lead.id).toBe('L1');
    expect(r.request.status).toBe('converted');
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm1',
      action: 'client_request_converted',
      entity: 'client_request',
      entityId: 'R1',
      after: { leadId: 'L1' },
    });
    expect(notifySubmitterClientRequestStatus).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: 'converted' })
    );
  });

  it('принять можно сразу из submitted и из in_triage (admin)', async () => {
    for (const status of ['submitted', 'in_triage'] as const) {
      const { prisma } = db(request({ status }));
      const r = await convertToLead(prisma, ADMIN, { id: 'R1' });
      expect(r.ok).toBe(true);
    }
  });
});

describe('rejectClientRequest — happy', () => {
  it('reject с причиной: rejectedReason из аргумента (trim), аудит с причиной', async () => {
    const { prisma, update } = db(request({ status: 'in_triage' }));
    const r = await rejectClientRequest(prisma, MANAGER, { id: 'R1', reason: '  нет мест  ' });
    if (!r.ok) throw new Error('expected ok');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'R1' },
      data: {
        status: 'rejected',
        rejectedReason: 'нет мест',
        triagedByUserId: 'm1',
        triagedAt: expect.any(Date),
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'client_request_rejected', after: { reason: 'нет мест' } })
    );
    expect(notifySubmitterClientRequestStatus).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: 'rejected', rejectedReason: 'нет мест' })
    );
  });

  it('пустая причина → дефолт «Отклонено»', async () => {
    const { prisma, update } = db(request());
    const r = await rejectClientRequest(prisma, MANAGER, { id: 'R1', reason: '   ' });
    if (!r.ok) throw new Error('expected ok');
    expect(update.mock.calls[0][0].data.rejectedReason).toBe('Отклонено');
    expect(recordAudit.mock.calls[0][1].after).toEqual({ reason: 'Отклонено' });
  });
});
