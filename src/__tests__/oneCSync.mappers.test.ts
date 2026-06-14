import { describe, expect, it } from 'vitest';
import {
  mapOrgDto,
  mapOrderDto,
  mapPaymentDto,
  mapDocumentDto
} from '@/lib/services/oneCSync/mappers';

describe('1C → Prisma mappers', () => {
  it('mapOrgDto produces Prisma upsert input shape', () => {
    const out = mapOrgDto({
      externalId: '1c-org-001',
      name: 'ООО Тест',
      legalName: 'Test LLC',
      inn: '770000',
      kpp: '770001',
      partnerExternalId: '1c-partner-001',
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('1c-org-001');
    expect(out.name).toBe('ООО Тест');
    expect(out.inn).toBe('770000');
    expect(out.updatedAt).toBeInstanceOf(Date);
  });

  it('mapOrderDto carries enums and decimals as strings/numbers', () => {
    const out = mapOrderDto({
      externalId: '1c-order-1',
      orderNumber: 'N-1',
      title: 'T',
      organizationExternalId: '1c-org-001',
      totalAmount: 100,
      paidAmount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      vatIncluded: true,
      vatRate: 0.2,
      executionStatus: 'in_progress' as const,
      financialStatus: 'partially_paid' as const,
      productMix: ['training'],
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('1c-order-1');
    expect(out.executionStatus).toBe('in_progress');
    expect(out.financialStatus).toBe('partially_paid');
    expect(out.totalAmount).toBe(100);
    expect(out.productMix).toEqual(['training']);
  });

  it('mapPaymentDto preserves orderExternalId for later resolution', () => {
    const out = mapPaymentDto({
      externalId: 'p1',
      orderExternalId: 'o1',
      amount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('p1');
    expect(out.orderExternalId).toBe('o1');
    expect(out.organizationExternalId).toBeNull();
    expect(out.amount).toBe(50);
  });

  it('mapPaymentDto maps org-level payment (no order)', () => {
    const out = mapPaymentDto({
      externalId: 'p2',
      organizationExternalId: 'org1',
      amount: 200,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('p2');
    expect(out.orderExternalId).toBeNull();
    expect(out.organizationExternalId).toBe('org1');
    expect(out.amount).toBe(200);
  });

  it('mapDocumentDto preserves type as enum-compatible string', () => {
    const out = mapDocumentDto({
      externalId: 'd1',
      orderExternalId: 'o1',
      type: 'act',
      name: 'Акт.pdf',
      mimeType: 'application/pdf',
      size: 100,
      downloadUrl: 'fake://d1',
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('d1');
    expect(out.type).toBe('act');
  });
});
