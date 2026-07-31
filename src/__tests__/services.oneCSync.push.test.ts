import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { pushLeadToOneC } from '@/lib/services/oneCSync/push';
import type { OneCAdapter } from '@/lib/services/oneCSync/adapter';

function makePrismaMock(opts: {
  lead?: {
    id: string;
    clientCompanyName: string;
    clientInn: string | null;
    clientContactName: string;
    clientContactPhone: string | null;
    clientContactEmail: string | null;
    subject: string;
    estimatedAmount: number | null;
    productType: string[];
    notes: string | null;
    partner: { slug: string | null };
    pushedToOneCAt: Date | null;
  } | null;
}): {
  prisma: PrismaClient;
  updateSpy: ReturnType<typeof vi.fn>;
  updateManySpy: ReturnType<typeof vi.fn>;
  logSpy: ReturnType<typeof vi.fn>;
} {
  const updateSpy = vi.fn().mockResolvedValue({});
  // Atomic claim default: first writer wins (count 1). Tests override with
  // count 0 to simulate losing the race / already-claimed.
  const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
  const logSpy = vi.fn().mockResolvedValue({});
  const prisma = {
    lead: {
      findUnique: vi.fn().mockResolvedValue(opts.lead ?? null),
      update: updateSpy,
      updateMany: updateManySpy
    },
    syncLog: { create: logSpy }
  } as unknown as PrismaClient;
  return { prisma, updateSpy, updateManySpy, logSpy };
}

function makeFakeAdapter(opts: {
  acceptedAt?: string;
  oneCRequestId?: string;
  shouldThrow?: boolean;
}): OneCAdapter {
  return {
    pullOrganizations: vi.fn(),
    pullOrders: vi.fn(),
    pullPayments: vi.fn(),
    pullDocuments: vi.fn(),
    pushLead: vi.fn(async () => {
      if (opts.shouldThrow) throw new Error('simulated failure');
      return {
        acceptedAt: opts.acceptedAt ?? '2026-05-22T10:00:00Z',
        oneCRequestId: opts.oneCRequestId ?? 'req-1'
      };
    })
  } as unknown as OneCAdapter;
}

describe('pushLeadToOneC', () => {
  it('returns ok=false when lead not found, writes error to SyncLog', async () => {
    const { prisma, logSpy } = makePrismaMock({ lead: null });
    const adapter = makeFakeAdapter({});
    const res = await pushLeadToOneC(prisma, 'missing-id', { adapter });
    expect(res.ok).toBe(false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].data.status).toBe('error');
  });

  it('happy path: updates lead.externalIdInOneC, writes success SyncLog', async () => {
    const { prisma, updateSpy, updateManySpy, logSpy } = makePrismaMock({
      lead: {
        id: 'lead-1',
        clientCompanyName: 'Acme',
        clientInn: '1234',
        clientContactName: 'John',
        clientContactPhone: null,
        clientContactEmail: null,
        subject: 'training',
        estimatedAmount: 1000,
        productType: ['training'],
        notes: null,
        partner: { slug: 'demo' },
        pushedToOneCAt: null
      }
    });
    const adapter = makeFakeAdapter({ oneCRequestId: 'fake-req-99' });
    const res = await pushLeadToOneC(prisma, 'lead-1', { adapter });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalIdInOneC).toBe('fake-req-99');
    // Atomic claim flips pushedToOneCAt from null (first-writer-wins).
    expect(updateManySpy).toHaveBeenCalledWith({
      where: { id: 'lead-1', pushedToOneCAt: null },
      data: { pushedToOneCAt: expect.any(Date) }
    });
    // Success update only stamps the external id — pushedToOneCAt is already
    // set by the claim above.
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { externalIdInOneC: 'fake-req-99' }
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].data.status).toBe('success');
    expect(logSpy.mock.calls[0][0].data.direction).toBe('outbound');
    expect(logSpy.mock.calls[0][0].data.entity).toBe('lead');
  });

  it('skips the adapter when the lead was already pushed (idempotent)', async () => {
    const already = new Date('2026-05-22T10:00:00Z');
    const { prisma, updateSpy, logSpy } = makePrismaMock({
      lead: {
        id: 'lead-3', clientCompanyName: 'A', clientInn: null, clientContactName: 'B',
        clientContactPhone: null, clientContactEmail: null, subject: 'S',
        estimatedAmount: null, productType: [], notes: null, partner: { slug: 'demo' },
        pushedToOneCAt: already
      }
    });
    const pushLead = vi.fn();
    const adapter = { pullOrganizations: vi.fn(), pullOrders: vi.fn(), pullPayments: vi.fn(), pullDocuments: vi.fn(), pushLead } as unknown as import('@/lib/services/oneCSync/adapter').OneCAdapter;
    const res = await pushLeadToOneC(prisma, 'lead-3', { adapter });
    expect(res.ok).toBe(true);
    expect(pushLead).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0].data.operation).toBe('skip');
    expect(logSpy.mock.calls[0][0].data.status).toBe('success');
  });

  it('failure path: writes error SyncLog, does not update lead', async () => {
    const { prisma, updateSpy, logSpy } = makePrismaMock({
      lead: {
        id: 'lead-2',
        clientCompanyName: 'X',
        clientInn: null,
        clientContactName: 'Y',
        clientContactPhone: null,
        clientContactEmail: null,
        subject: 'Z',
        estimatedAmount: null,
        productType: [],
        notes: null,
        partner: { slug: null },
        pushedToOneCAt: null
      }
    });
    const adapter = makeFakeAdapter({ shouldThrow: true });
    const res = await pushLeadToOneC(prisma, 'lead-2', { adapter });
    expect(res.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].data.status).toBe('error');
    expect(logSpy.mock.calls[0][0].data.errorMessage).toContain('simulated failure');
  });

  it('claim lost (concurrent): updateMany count 0 ⇒ skips adapter, idempotent', async () => {
    const { prisma, updateManySpy, updateSpy, logSpy } = makePrismaMock({
      lead: {
        id: 'lead-x', clientCompanyName: 'A', clientInn: null, clientContactName: 'B',
        clientContactPhone: null, clientContactEmail: null, subject: 'S',
        estimatedAmount: null, productType: [], notes: null, partner: { slug: 'demo' },
        pushedToOneCAt: null
      }
    });
    updateManySpy.mockResolvedValueOnce({ count: 0 }); // another worker won the claim
    const pushLead = vi.fn();
    const adapter = {
      pullOrganizations: vi.fn(), pullOrders: vi.fn(), pullPayments: vi.fn(),
      pullDocuments: vi.fn(), pushLead
    } as unknown as OneCAdapter;
    const res = await pushLeadToOneC(prisma, 'lead-x', { adapter });
    expect(res.ok).toBe(true);
    expect(pushLead).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0].data.operation).toBe('skip');
    expect(logSpy.mock.calls[0][0].data.status).toBe('success');
  });

  it('claim won then adapter fails ⇒ rolls back pushedToOneCAt to null (retry preserved)', async () => {
    const { prisma, updateManySpy } = makePrismaMock({
      lead: {
        id: 'lead-y', clientCompanyName: 'X', clientInn: null, clientContactName: 'Y',
        clientContactPhone: null, clientContactEmail: null, subject: 'Z',
        estimatedAmount: null, productType: [], notes: null, partner: { slug: null },
        pushedToOneCAt: null
      }
    });
    updateManySpy.mockResolvedValueOnce({ count: 1 }); // win the claim
    const adapter = makeFakeAdapter({ shouldThrow: true });
    const res = await pushLeadToOneC(prisma, 'lead-y', { adapter });
    expect(res.ok).toBe(false);
    // Rollback releases the claim so BullMQ retry can re-attempt.
    const rollback = updateManySpy.mock.calls.find((c) => c[0]?.data?.pushedToOneCAt === null);
    expect(rollback).toBeTruthy();
    expect(rollback![0].where).toEqual({ id: 'lead-y' });
  });

  it('adapter fails AND rollback fails ⇒ still returns ok:false with the adapter error (no throw)', async () => {
    const { prisma, updateManySpy } = makePrismaMock({
      lead: {
        id: 'lead-z', clientCompanyName: 'X', clientInn: null, clientContactName: 'Y',
        clientContactPhone: null, clientContactEmail: null, subject: 'Z',
        estimatedAmount: null, productType: [], notes: null, partner: { slug: null },
        pushedToOneCAt: null
      }
    });
    updateManySpy.mockResolvedValueOnce({ count: 1 }); // claim wins
    updateManySpy.mockRejectedValueOnce(new Error('db gone')); // rollback fails
    const adapter = makeFakeAdapter({ shouldThrow: true });
    const res = await pushLeadToOneC(prisma, 'lead-z', { adapter });
    // Result contract preserved: the ADAPTER error surfaces, not the rollback error.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('simulated failure');
  });
});

describe('FakeOneCAdapter.pushLead simulator', () => {
  it('throws when FAKE_ONEC_FAILURE_RATE=1', async () => {
    const prev = process.env.FAKE_ONEC_FAILURE_RATE;
    process.env.FAKE_ONEC_FAILURE_RATE = '1';
    const { FakeOneCAdapter } = await import('@/lib/services/oneCSync/adapter-fake');
    const a = new FakeOneCAdapter();
    await expect(
      a.pushLead({
        cabinetLeadId: 'l',
        clientCompanyName: 'c',
        clientContactName: 'n',
        subject: 's',
        productType: []
      })
    ).rejects.toThrow(/simulated failure/);
    process.env.FAKE_ONEC_FAILURE_RATE = prev;
  });

  it('does not throw when FAKE_ONEC_FAILURE_RATE=0', async () => {
    const prev = process.env.FAKE_ONEC_FAILURE_RATE;
    process.env.FAKE_ONEC_FAILURE_RATE = '0';
    const { FakeOneCAdapter } = await import('@/lib/services/oneCSync/adapter-fake');
    const a = new FakeOneCAdapter();
    const r = await a.pushLead({
      cabinetLeadId: 'l',
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      productType: []
    });
    expect(r.acceptedAt).toBeTruthy();
    process.env.FAKE_ONEC_FAILURE_RATE = prev;
  });
});
