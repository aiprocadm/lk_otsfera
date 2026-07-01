/**
 * Unit tests for src/lib/services/manager/orderLifecycle.ts — the OrderStatus
 * lifecycle state machine (B2 guarded completion + reopen, B3 waiting_client
 * return-with-reason). Mirrors the mock-prisma style of
 * services.manager.status.unit.test.ts. evaluateOrderCompletion is the REAL
 * import (drives the completion branch from the mocked order shape).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, canSeeOrder } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrder: vi.fn()
}));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  transitionOrderLifecycle,
  setOrderAccountingSigned
} from '@/lib/services/manager/orderLifecycle';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

/** A fully-completable training order by default; override per-case. */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    managerId: 'mgr-1',
    organizationId: 'org-1',
    companyId: 'co-1',
    status: 'in_progress',
    serviceType: 'training',
    accountingSignedAt: new Date('2026-07-01T00:00:00Z'),
    documents: [{ scanStatus: 'clean' }],
    items: [{ trainingStatus: 'certificate_issued' }],
    ...overrides
  };
}

function makePrisma(order: ReturnType<typeof makeOrder> | null) {
  const update = vi.fn().mockResolvedValue({ ...order });
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(order), update },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    } as never,
    update
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  recordAudit.mockResolvedValue(undefined);
});

describe('transitionOrderLifecycle', () => {
  it('returns not_found when the order is missing', async () => {
    const { prisma } = makePrisma(null);
    expect(await transitionOrderLifecycle(prisma, SESSION, { orderId: 'x', to: 'in_progress' })).toEqual({
      ok: false,
      error: 'not_found'
    });
  });

  it('returns forbidden when canSeeOrder is false', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma } = makePrisma(makeOrder());
    expect(await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'completed' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('no-op when already in the target status (no audit, no update)', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'in_progress' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'in_progress' });
    expect(r).toEqual({ ok: true, changed: false, status: 'in_progress' });
    expect(update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('rejects an illegal jump (new → completed)', async () => {
    const { prisma } = makePrisma(makeOrder({ status: 'new' }));
    expect(await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'completed' })).toEqual({
      ok: false,
      error: 'invalid_transition'
    });
  });

  it('advances new → in_progress and audits', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'new' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'in_progress' });
    expect(r).toEqual({ ok: true, changed: true, status: 'in_progress' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { status: 'in_progress' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_lifecycle_changed', before: { status: 'new' }, after: { status: 'in_progress' } })
    );
  });

  it('requires a reason for → waiting_client (empty/whitespace rejected)', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'in_progress' }));
    expect(await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'waiting_client', reason: '   ' })).toEqual({
      ok: false,
      error: 'reason_required'
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns to client with a stored reason', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'in_progress' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, {
      orderId: 'ord-1',
      to: 'waiting_client',
      reason: '  Выбрана не та программа  '
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'waiting_client' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { status: 'waiting_client', returnReason: 'Выбрана не та программа' }
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'Выбрана не та программа' })
    );
  });

  it('clears returnReason when leaving waiting_client', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'waiting_client' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'in_progress' });
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { status: 'in_progress', returnReason: null } });
  });

  it('blocks completion when conditions are unmet and reports them', async () => {
    const { prisma, update } = makePrisma(
      makeOrder({ status: 'in_progress', accountingSignedAt: null, documents: [], items: [] })
    );
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'completed' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toBe('completion_conditions_unmet');
    if (r.error !== 'completion_conditions_unmet') throw new Error('unreachable');
    expect(r.unmet.sort()).toEqual(['accounting_signed', 'certificates_issued', 'documents_uploaded'].sort());
    expect(update).not.toHaveBeenCalled();
  });

  it('completes when all conditions are met', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'in_progress' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'completed' });
    expect(r).toEqual({ ok: true, changed: true, status: 'completed' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { status: 'completed' } });
  });

  it('reopens completed → in_progress and audits', async () => {
    const { prisma, update } = makePrisma(makeOrder({ status: 'completed' }));
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'in_progress' });
    expect(r).toEqual({ ok: true, changed: true, status: 'in_progress' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { status: 'in_progress' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ before: { status: 'completed' }, after: { status: 'in_progress' } })
    );
  });

  it('completes a non-training order without certificates', async () => {
    const { prisma } = makePrisma(
      makeOrder({ status: 'in_progress', serviceType: 'document_development', items: [] })
    );
    const r = await transitionOrderLifecycle(prisma, SESSION, { orderId: 'ord-1', to: 'completed' });
    expect(r).toEqual({ ok: true, changed: true, status: 'completed' });
  });
});

describe('setOrderAccountingSigned', () => {
  it('returns not_found when the order is missing', async () => {
    const { prisma } = makePrisma(null);
    expect(await setOrderAccountingSigned(prisma, SESSION, { orderId: 'x', signed: true })).toEqual({
      ok: false,
      error: 'not_found'
    });
  });

  it('returns forbidden when canSeeOrder is false', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma } = makePrisma(makeOrder());
    expect(await setOrderAccountingSigned(prisma, SESSION, { orderId: 'ord-1', signed: true })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('no-op when already in the requested state', async () => {
    const { prisma, update } = makePrisma(makeOrder({ accountingSignedAt: new Date() }));
    const r = await setOrderAccountingSigned(prisma, SESSION, { orderId: 'ord-1', signed: true });
    expect(r).toEqual({ ok: true, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it('marks accounting signed', async () => {
    const { prisma, update } = makePrisma(makeOrder({ accountingSignedAt: null }));
    const r = await setOrderAccountingSigned(prisma, SESSION, { orderId: 'ord-1', signed: true });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { accountingSignedAt: expect.any(Date) }
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_accounting_signed', after: { signed: true } })
    );
  });

  it('unmarks accounting signed', async () => {
    const { prisma, update } = makePrisma(makeOrder({ accountingSignedAt: new Date() }));
    const r = await setOrderAccountingSigned(prisma, SESSION, { orderId: 'ord-1', signed: false });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { accountingSignedAt: null } });
  });
});
