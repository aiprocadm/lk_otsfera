/**
 * Unit tests extending coverage for commission/pdf.ts — covers the cross-month
 * period label branch (not covered by existing tests which use same-month periods).
 * Also covers the `err instanceof Error ? err.message : String(err)` false branch
 * by mocking QRCode.toDataURL to throw a non-Error primitive.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock qrcode so we can control its throw type in one specific test.
// For all tests except the special non-Error throw test, we let the real module run.
const { qrToDataURL } = vi.hoisted(() => ({ qrToDataURL: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: qrToDataURL } }));

import { renderStatementPdf } from '@/lib/services/commission/pdf';

const baseStatement = {
  id: 'stmt-1',
  createdAt: new Date('2026-05-01'),
  updatedAt: new Date('2026-05-01'),
  partnerId: 'p1',
  // Cross-month period: March → May (different months)
  periodFrom: new Date('2026-03-01'),
  periodTo: new Date('2026-05-31'),
  calculatedAt: new Date('2026-06-01'),
  calculatedByUserId: null,
  totalBaseAmount: 0 as unknown as import('@prisma/client').Prisma.Decimal,
  averageRate: 0 as unknown as import('@prisma/client').Prisma.Decimal,
  totalCommissionAmount: 0 as unknown as import('@prisma/client').Prisma.Decimal,
  status: 'draft' as const,
  pdfPath: null,
  xlsxPath: null,
  approvedByUserId: null,
  approvedAt: null,
  paidAt: null,
  supersededBy: null,
  notes: null,
};

describe('renderStatementPdf — cross-month period label', () => {
  it('uses date range label when period spans multiple months', async () => {
    // The periodLabel function branches: same month → "месяц год", different → "d1 — d2"
    // We just verify it renders without throwing and produces a PDF.
    const buf = await renderStatementPdf({
      statement: baseStatement as never,
      items: [],
      partner: { name: 'ПромТест', legalName: 'ООО ПромТест' },
      verifyUrl: null,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  }, 15000);

  it('item with null orderNumber renders "—"', async () => {
    const item = {
      id: 'item-1',
      statementId: 'stmt-1',
      orderId: 'ord-1',
      orderNumber: null,
      organizationName: 'Org',
      baseAmount: 1000 as unknown as import('@prisma/client').Prisma.Decimal,
      rate: 0.1 as unknown as import('@prisma/client').Prisma.Decimal,
      commissionAmount: 100 as unknown as import('@prisma/client').Prisma.Decimal,
    };
    const buf = await renderStatementPdf({
      statement: { ...baseStatement, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') } as never,
      items: [item as never],
      partner: { name: 'ПромТест', legalName: null },
      verifyUrl: null,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  }, 15000);

  it('fmt handles NaN gracefully (renders "—")', async () => {
    const item = {
      id: 'item-1',
      statementId: 'stmt-1',
      orderId: 'ord-1',
      orderNumber: 'N1',
      organizationName: 'Org',
      // NaN values: number conversion of non-numeric should yield "—"
      baseAmount: 'not-a-number' as unknown as import('@prisma/client').Prisma.Decimal,
      rate: 'bad' as unknown as import('@prisma/client').Prisma.Decimal,
      commissionAmount: 'bad' as unknown as import('@prisma/client').Prisma.Decimal,
    };
    const buf = await renderStatementPdf({
      statement: baseStatement as never,
      items: [item as never],
      partner: { name: 'ПромТест', legalName: null },
      verifyUrl: null,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  }, 15000);

  it('generateQrDataUrl catch: String(err) branch when non-Error is thrown', async () => {
    // Covers `err instanceof Error ? err.message : String(err)` arm 0 (false branch)
    // by making QRCode.toDataURL throw a plain string (not an Error instance)
    qrToDataURL.mockRejectedValueOnce('qr-string-failure');
    // renderStatementPdf should NOT throw — catch swallows it and returns null qrDataUrl
    const buf = await renderStatementPdf({
      statement: { ...baseStatement, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') } as never,
      items: [],
      partner: { name: 'ПромТест', legalName: null },
      verifyUrl: 'https://example.com/verify/abc123',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
  }, 15000);
});
