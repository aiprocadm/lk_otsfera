import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before imports
const { writeSyncLog } = vi.hoisted(() => ({ writeSyncLog: vi.fn() }));
const { getOneCAdapter } = vi.hoisted(() => ({ getOneCAdapter: vi.fn() }));

vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/services/oneCSync/index', () => ({ getOneCAdapter }));

import { pushLeadToOneC } from '@/lib/services/oneCSync/push';

// ── helpers ───────────────────────────────────────────────────────────────────

const baseLead = {
  id: 'lead-1',
  clientCompanyName: 'Acme',
  clientInn: '770000000',
  clientContactName: 'Ivan',
  clientContactPhone: '+79001234567',
  clientContactEmail: 'ivan@acme.ru',
  subject: 'Training',
  estimatedAmount: 50000,
  productType: ['training'],
  notes: 'Some notes',
  partner: { slug: 'acme-partner' },
  pushedToOneCAt: null,
  externalIdInOneC: null,
};

function makePrisma(leadOverride: Record<string, unknown> = {}) {
  const lead = { ...baseLead, ...leadOverride };
  return {
    lead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      update: vi.fn().mockResolvedValue(lead),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as Parameters<typeof pushLeadToOneC>[0];
}

const mockAdapter = {
  pushLead: vi
    .fn()
    .mockResolvedValue({ acceptedAt: '2026-05-01T00:00:00Z', oneCRequestId: 'ext-req-123' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  writeSyncLog.mockResolvedValue(undefined);
  getOneCAdapter.mockReturnValue(mockAdapter);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('pushLeadToOneC', () => {
  it('returns ok:false and writes error log when lead not found', async () => {
    const prisma = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    } as unknown as Parameters<typeof pushLeadToOneC>[0];

    const res = await pushLeadToOneC(prisma, 'non-existent', { adapter: mockAdapter as any });
    expect(res).toEqual({ ok: false, error: 'Lead not found' });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', errorMessage: 'Lead not found', entity: 'lead' }),
      prisma
    );
    expect(mockAdapter.pushLead).not.toHaveBeenCalled();
  });

  it('returns ok:true (already_pushed) and skips adapter when pushedToOneCAt is set', async () => {
    const pushedAt = new Date('2026-04-01T10:00:00Z');
    const prisma = makePrisma({ pushedToOneCAt: pushedAt, externalIdInOneC: 'ext-123' });

    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    expect(res).toMatchObject({ ok: true, externalIdInOneC: 'ext-123' });
    expect(res.ok && res.result.acceptedAt).toBe(pushedAt.toISOString());
    expect(mockAdapter.pushLead).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'skip',
        payload: expect.objectContaining({ reason: 'already_pushed' }),
      }),
      prisma
    );
  });

  it('returns ok:true (claim_lost) and skips adapter when updateMany count=0', async () => {
    const prisma = makePrisma();
    (prisma.lead.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    expect(res).toMatchObject({ ok: true });
    expect(mockAdapter.pushLead).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'skip',
        payload: expect.objectContaining({ reason: 'claim_lost_or_already_pushed' }),
      }),
      prisma
    );
  });

  it('succeeds: pushes lead, records externalId, writes success log', async () => {
    const prisma = makePrisma();
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    expect(res).toMatchObject({ ok: true, externalIdInOneC: 'ext-req-123' });
    expect(res.ok && res.result.oneCRequestId).toBe('ext-req-123');
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { externalIdInOneC: 'ext-req-123' } })
    );
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', operation: 'create' }),
      prisma
    );
  });

  it('succeeds without lead.update when oneCRequestId is absent', async () => {
    const adapter = { pushLead: vi.fn().mockResolvedValue({ acceptedAt: '2026-05-01T00:00:00Z' }) };
    const prisma = makePrisma();
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: adapter as any });
    expect(res).toMatchObject({ ok: true, externalIdInOneC: null });
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('maps Decimal-like estimatedAmount via .toNumber()', async () => {
    const decimalLike = { toNumber: () => 9999 };
    const prisma = makePrisma({ estimatedAmount: decimalLike });
    await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    const payload = mockAdapter.pushLead.mock.calls[0][0];
    expect(payload.estimatedAmount).toBe(9999);
  });

  it('maps null estimatedAmount to undefined in payload', async () => {
    const prisma = makePrisma({ estimatedAmount: null });
    await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    const payload = mockAdapter.pushLead.mock.calls[0][0];
    expect(payload.estimatedAmount).toBeUndefined();
  });

  it('maps null partner.slug to undefined partnerSlug in payload', async () => {
    const prisma = makePrisma({ partner: { slug: null } });
    await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    const payload = mockAdapter.pushLead.mock.calls[0][0];
    expect(payload.partnerSlug).toBeUndefined();
  });

  it('returns ok:false, rolls back claim, writes error log on adapter failure', async () => {
    const failAdapter = { pushLead: vi.fn().mockRejectedValue(new Error('adapter boom')) };
    const prisma = makePrisma();
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: failAdapter as any });
    expect(res).toEqual({ ok: false, error: 'adapter boom' });
    // rollback: updateMany with pushedToOneCAt: null
    expect(prisma.lead.updateMany).toHaveBeenCalledTimes(2); // claim + rollback
    const rollbackCall = (prisma.lead.updateMany as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(rollbackCall[0].data.pushedToOneCAt).toBeNull();
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', errorMessage: 'adapter boom' }),
      prisma
    );
  });

  it('still returns ok:false when rollback itself fails (double-fault)', async () => {
    const failAdapter = { pushLead: vi.fn().mockRejectedValue(new Error('adapter err')) };
    const prisma = makePrisma();
    // First updateMany = claim (count=1), second updateMany = rollback fails
    (prisma.lead.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('rollback failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: failAdapter as any });
    consoleSpy.mockRestore();

    expect(res).toEqual({ ok: false, error: 'adapter err' });
    expect(writeSyncLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }), prisma);
  });

  it('falls back to getOneCAdapter when no adapter option provided', async () => {
    const prisma = makePrisma();
    await pushLeadToOneC(prisma, 'lead-1');
    expect(getOneCAdapter).toHaveBeenCalled();
    expect(mockAdapter.pushLead).toHaveBeenCalled();
  });

  it('passes non-Error rejection as string message', async () => {
    const failAdapter = { pushLead: vi.fn().mockRejectedValue('plain string error') };
    const prisma = makePrisma();
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: failAdapter as any });
    expect(res).toEqual({ ok: false, error: 'plain string error' });
  });

  it('null optional lead fields map to undefined in payload', async () => {
    const prisma = makePrisma({
      clientInn: null,
      clientContactPhone: null,
      clientContactEmail: null,
      notes: null,
    });
    await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    const payload = mockAdapter.pushLead.mock.calls[0][0];
    expect(payload.clientInn).toBeUndefined();
    expect(payload.clientContactPhone).toBeUndefined();
    expect(payload.clientContactEmail).toBeUndefined();
    expect(payload.notes).toBeUndefined();
  });

  it('already_pushed: uses undefined as externalId in sync log when externalIdInOneC is null', async () => {
    const pushedAt = new Date('2026-04-01T10:00:00Z');
    const prisma = makePrisma({ pushedToOneCAt: pushedAt, externalIdInOneC: null });
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    expect(res).toMatchObject({ ok: true, externalIdInOneC: null });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'skip',
        externalId: undefined, // null ?? undefined = undefined
      }),
      prisma
    );
  });

  it('claim_lost: uses undefined as externalId in sync log when externalIdInOneC is null', async () => {
    const prisma = makePrisma({ externalIdInOneC: null });
    (prisma.lead.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: mockAdapter as any });
    expect(res).toMatchObject({ ok: true });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'skip', externalId: undefined }),
      prisma
    );
  });

  it('rollback throws a non-Error: stringifies it in console.error', async () => {
    const failAdapter = { pushLead: vi.fn().mockRejectedValue(new Error('adapter err')) };
    const prisma = makePrisma();
    // First updateMany = claim (count=1), second updateMany = rollback throws non-Error
    (prisma.lead.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce('non-error rollback fail'); // string, not Error

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await pushLeadToOneC(prisma, 'lead-1', { adapter: failAdapter as any });
      // The error arg in console.error has rollbackError = String('non-error rollback fail')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('claim rollback failed'),
        expect.objectContaining({ rollbackError: 'non-error rollback fail' })
      );
      expect(res).toEqual({ ok: false, error: 'adapter err' });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
