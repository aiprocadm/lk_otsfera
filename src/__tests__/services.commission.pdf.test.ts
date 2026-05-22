import { describe, it, expect } from 'vitest';
import { renderStatementPdf } from '@/lib/services/commission/pdf';

const baseStatement = {
  id: 'stmt-1',
  createdAt: new Date('2026-05-01'),
  updatedAt: new Date('2026-05-01'),
  partnerId: 'p1',
  periodFrom: new Date('2026-04-01'),
  periodTo: new Date('2026-04-30'),
  calculatedAt: new Date('2026-05-01'),
  calculatedByUserId: null,
  totalBaseAmount: 200000 as unknown as import('@prisma/client').Prisma.Decimal,
  averageRate: 0.08 as unknown as import('@prisma/client').Prisma.Decimal,
  totalCommissionAmount: 16000 as unknown as import('@prisma/client').Prisma.Decimal,
  status: 'draft' as const,
  pdfPath: null,
  xlsxPath: null,
  approvedByUserId: null,
  approvedAt: null,
  paidAt: null,
  supersededBy: null,
  notes: null,
};

const baseItems = [
  {
    id: 'item-1',
    statementId: 'stmt-1',
    orderId: 'ord-1',
    orderNumber: 'ORD-2026-001',
    organizationName: 'ООО "Тест"',
    baseAmount: 100000 as unknown as import('@prisma/client').Prisma.Decimal,
    rate: 0.08 as unknown as import('@prisma/client').Prisma.Decimal,
    commissionAmount: 8000 as unknown as import('@prisma/client').Prisma.Decimal,
  },
  {
    id: 'item-2',
    statementId: 'stmt-1',
    orderId: 'ord-2',
    orderNumber: 'ORD-2026-002',
    organizationName: 'АО "Тест-2"',
    baseAmount: 100000 as unknown as import('@prisma/client').Prisma.Decimal,
    rate: 0.08 as unknown as import('@prisma/client').Prisma.Decimal,
    commissionAmount: 8000 as unknown as import('@prisma/client').Prisma.Decimal,
  }
];

const partner = { name: 'ПромТест', legalName: 'ООО ПромТест' };

describe('renderStatementPdf', () => {
  it('returns a non-empty Buffer (sanity check)', async () => {
    const buf = await renderStatementPdf({
      statement: baseStatement as any,
      items: baseItems as any,
      partner,
      verifyUrl: null,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  }, 15000);

  it('PDF starts with %PDF magic bytes', async () => {
    const buf = await renderStatementPdf({
      statement: baseStatement as any,
      items: baseItems as any,
      partner,
      verifyUrl: null,
    });
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('handles empty items list without throwing', async () => {
    const buf = await renderStatementPdf({
      statement: { ...baseStatement, totalBaseAmount: 0 as any, totalCommissionAmount: 0 as any } as any,
      items: [],
      partner: { name: 'Партнёр', legalName: null },
      verifyUrl: null,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('handles null legalName (partner without legal entity)', async () => {
    await expect(
      renderStatementPdf({
        statement: baseStatement as any,
        items: baseItems as any,
        partner: { name: 'Solo', legalName: null },
        verifyUrl: null,
      })
    ).resolves.toBeDefined();
  });
});
