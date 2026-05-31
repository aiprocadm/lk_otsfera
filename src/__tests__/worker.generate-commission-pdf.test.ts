import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { GenerateCommissionPdfPayload } from '@/lib/jobs/types';

const { uploadMock, renderPdfMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  renderPdfMock: vi.fn()
}));

vi.mock('@/lib/storage/supabase', () => ({
  getServerClient: () => ({ storage: { from: () => ({ upload: uploadMock }) } }),
  documentBucket: 'documents'
}));
vi.mock('@/lib/services/commission/pdf', () => ({
  renderStatementPdf: renderPdfMock
}));

import { generateCommissionPdfProcessor } from '@/worker/processors/generate-commission-pdf';

let prisma: PrismaClient;
let partnerId: string;
let statementId: string;

function job(id: string): Job<GenerateCommissionPdfPayload> {
  return { id: 'test-pdf-' + Date.now(), data: { statementId: id } } as Job<GenerateCommissionPdfPayload>;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `PdfProcPartner-${Date.now()}`, legalName: 'ООО PdfProc', commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const stmt = await prisma.commissionStatement.create({
    data: { partnerId, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') }
  });
  statementId = stmt.id;
});

afterAll(async () => {
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  uploadMock.mockReset();
  renderPdfMock.mockReset();
  renderPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  uploadMock.mockResolvedValue({ error: null });
});

describe('generateCommissionPdfProcessor', () => {
  it('renders, uploads to the partner path, and persists pdfPath', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { pdfPath: null } });

    const result = await generateCommissionPdfProcessor(job(statementId), prisma);

    const expectedPath = `partners/${partnerId}/commission/${statementId}.pdf`;
    expect(result).toEqual({ statementId, path: expectedPath });

    expect(renderPdfMock).toHaveBeenCalledTimes(1);
    const renderArg = renderPdfMock.mock.calls[0][0];
    expect(renderArg.statement.id).toBe(statementId);
    expect(renderArg.partner).toEqual({ name: expect.any(String), legalName: 'ООО PdfProc' });
    expect(renderArg.verifyUrl).toBeNull();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [uploadPath, uploadBuf, uploadOpts] = uploadMock.mock.calls[0];
    expect(uploadPath).toBe(expectedPath);
    expect(Buffer.isBuffer(uploadBuf)).toBe(true);
    expect(uploadOpts).toMatchObject({ contentType: 'application/pdf', upsert: true });

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { pdfPath: true }
    });
    expect(reread?.pdfPath).toBe(expectedPath);
  });

  it('throws NOT_FOUND when the statement does not exist', async () => {
    await expect(generateCommissionPdfProcessor(job('does-not-exist'), prisma)).rejects.toThrow(/NOT_FOUND/);
    expect(renderPdfMock).not.toHaveBeenCalled();
  });

  it('throws STORAGE_FAILURE and does not persist pdfPath when upload errors', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { pdfPath: null } });
    uploadMock.mockResolvedValue({ error: { message: 'bucket exploded' } });

    await expect(generateCommissionPdfProcessor(job(statementId), prisma)).rejects.toThrow(/STORAGE_FAILURE/);

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { pdfPath: true }
    });
    expect(reread?.pdfPath).toBeNull();
  });
});
