import { describe, it, expect, vi } from 'vitest';
import { matchRow } from '@/lib/services/import/oneCAccountCard/matcher';
import type { ParsedRow } from '@/lib/services/import/oneCAccountCard/types';

function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    rowIndex: 1,
    kind: 'payment',
    externalId: '0000-1',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: 14800,
    isRefund: false,
    purpose: 'Оплата',
    paymentOrderNumber: '0000-1',
    accountCandidates: [],
    counterpartyName: null,
    counterpartyInn: null,
    vatAmount: null,
    rawRow: [],
    ...over,
  };
}

function db(overrides: Record<string, unknown>) {
  return {
    order: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    ...overrides,
  } as never;
}

describe('matchRow', () => {
  it('exact by account number → order (with externalId) → dto.orderExternalId', async () => {
    const prisma = db({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'o1',
          externalId: 'EXT-1',
          organizationId: 'org1',
          organization: { inn: '7700000000' },
        }),
      },
      organization: { findFirst: vi.fn() },
    });
    const out = await matchRow(prisma, row({ accountCandidates: ['260509-1905'] }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.orderExternalId).toBe('EXT-1');
  });

  it('account matches order without externalId → falls back to org-level (organizationInn)', async () => {
    const prisma = db({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'o1',
          externalId: null,
          organizationId: 'org1',
          organization: { inn: '7700000000' },
        }),
      },
    });
    const out = await matchRow(prisma, row({ accountCandidates: ['260509-1905'] }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') {
      expect(out.dto.orderExternalId).toBeUndefined();
      expect(out.dto.organizationInn).toBe('7700000000');
    }
  });

  it('no account, exact by INN → org-level dto', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org2', inn: '9909676723' }) },
    });
    const out = await matchRow(prisma, row({ counterpartyInn: '9909676723' }));
    expect(out.route).toBe('exact');
    if (out.route === 'exact') expect(out.dto.organizationInn).toBe('9909676723');
  });

  it('no account, no INN, fuzzy name hit → queue with candidate', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org3', name: 'ХОЛДИНГ ГЕФЕСТ ООО' }),
      },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'Холдинг Гефест' }));
    expect(out.route).toBe('queue');
    if (out.route === 'queue') {
      expect(out.candidateOrgId).toBe('org3');
      expect(out.matchMethod).toBe('name_fuzzy');
    }
  });

  it('nothing matches → queue with matchMethod none', async () => {
    const prisma = db({
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      organization: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const out = await matchRow(prisma, row({ counterpartyName: 'НЕИЗВЕСТНО' }));
    expect(out.route).toBe('queue');
    if (out.route === 'queue') expect(out.matchMethod).toBe('none');
  });
});
