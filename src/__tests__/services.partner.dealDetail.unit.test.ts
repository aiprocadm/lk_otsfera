/**
 * Unit tests for src/lib/services/partner/dealDetail.ts
 * Covers branches missed by any integration test.
 */
import { describe, it, expect, vi } from 'vitest';
import { getPartnerDealDetail } from '@/lib/services/partner/dealDetail';

vi.mock('@/lib/auth/documentChannelPolicy', () => ({
  partnerChannelWhere: vi.fn(() => ({ counterpartyType: 'partner', counterpartyId: 'p1' }))
}));

function dec(n: number) {
  return { toFixed: (d: number) => n.toFixed(d), toString: () => String(n) };
}

const baseOrder = {
  id: 'o1',
  orderNumber: 'N001',
  title: 'Заказ 1',
  totalAmount: dec(1000),
  paidAmount: dec(200),
  executionStatus: 'in_progress' as const,
  financialStatus: 'billed' as const,
  vatIncluded: true,
  vatRate: { toString: () => '20' },
  productMix: ['IT'],
  createdAt: new Date('2024-01-01'),
  deadline: null,
  contractSignedAt: null,
  completedAt: null,
  closedAt: null,
  paidAt: null,
  lastSyncedAt: null,
  organization: { id: 'org1', name: 'ООО Тест', inn: '7700000001' },
  manager: { name: 'Менеджер Иванов' },
  documents: [],
  comments: []
};

function makePrisma(order: object | null) {
  return {
    order: { findFirst: vi.fn().mockResolvedValue(order) }
  } as any;
}

describe('getPartnerDealDetail — unit', () => {
  it('returns null when order not found (no lead-linkage)', async () => {
    const prisma = makePrisma(null);
    const result = await getPartnerDealDetail(prisma, { dealId: 'x', partnerId: 'p1' });
    expect(result).toBeNull();
  });

  it('returns full deal detail with organization and manager name', async () => {
    const prisma = makePrisma(baseOrder);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('o1');
    expect(result!.organization?.name).toBe('ООО Тест'); // via org.name
    expect(result!.managerName).toBe('Менеджер Иванов');
    expect(result!.vatRate).toBe('20');
  });

  it('uses null for vatRate when vatRate field is null', async () => {
    const order = { ...baseOrder, vatRate: null };
    const prisma = makePrisma(order);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result!.vatRate).toBeNull();
  });

  it('uses null for managerName when manager is null', async () => {
    const order = { ...baseOrder, manager: null };
    const prisma = makePrisma(order);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result!.managerName).toBeNull();
  });

  it('sets organization to null when order has no organization', async () => {
    const order = { ...baseOrder, organization: null };
    const prisma = makePrisma(order);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result!.organization).toBeNull();
  });

  it('maps documents with order-level orderNumber and orderTitle', async () => {
    const order = {
      ...baseOrder,
      documents: [{
        id: 'd1', name: 'file.pdf', type: 'other', direction: 'incoming',
        signedAt: null, createdAt: new Date('2024-02-01'), size: 100, orderId: 'o1'
      }]
    };
    const prisma = makePrisma(order);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result!.documents).toHaveLength(1);
    expect(result!.documents[0]).toMatchObject({
      id: 'd1',
      orderId: 'o1',
      orderNumber: 'N001',
      orderTitle: 'Заказ 1'
    });
  });

  it('maps comments with authorName', async () => {
    const order = {
      ...baseOrder,
      comments: [{
        id: 'c1', body: 'Текст', createdAt: new Date('2024-03-01'),
        author: { name: 'Автор Петров' }
      }]
    };
    const prisma = makePrisma(order);
    const result = await getPartnerDealDetail(prisma, { dealId: 'o1', partnerId: 'p1' });
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].authorName).toBe('Автор Петров');
  });
});
